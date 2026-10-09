import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { z } from "../../packages/core/node_modules/zod";
import {
  OpenRouterProvider,
  ProviderError,
  type ProviderSettings,
  providerSettingsSchema,
  type StructuredInput,
} from "../../packages/core/src/aip";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import {
  assertMigrationCumulativeBudget,
  assertMigrationDispatchAllowed,
  MigrationControlInterruption,
  migrationControls,
  migrationLedgerRound,
  migrationReportedModelMatches,
  migrationRoundStateSchema,
  migrationUnexpectedTransport,
  readMigrationRecordedJson,
  withMigrationLedger,
} from "./haiku55-migration-guards";
import {
  comparisonSettings,
  schemaDecodingCandidates,
  zdrEndpointMaximumRates,
} from "./model-comparison-candidates";

// This explicit CLI is never invoked by CI/Vitest with a real network and never touches learner data.
export const schemaProbeVersion = "gemini-schema-enforcement-probe-1";
export const schemaProbeFixtureSet = "gemini-schema-enforcement-probe";
export const schemaProbeCandidateId = "gemini-3.8-flash-medium-schema";
/** Only the physical output cap differs from the candidate, so the reserve fits the probe cap. */
export const schemaProbeMaxOutputTokens = 6000;
export const schemaProbeSchemaName = "schema_enforcement_probe";
/** Tiny and strict: a one-value enum and a discriminated union that must hold at least one item. */
export const schemaProbeSchema = z.strictObject({
  verdict: z.enum(["alpha"]),
  items: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("x"), label: z.string() }),
        z.strictObject({ kind: z.literal("y"), flag: z.boolean() }),
      ]),
    )
    .min(1),
});
// The instruction contradicts the grammar on purpose: only an enforced schema can yield "alpha".
export const schemaProbeSystem =
  'Reply with exactly this JSON object and nothing else: {"answer":"beta"}. Never write the word "alpha" anywhere in your reply.';
export const schemaProbeInput = "Reply now.";
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
// Headers that carry no secret; Authorization and the per-call operation key are never printed.
const printableHeaders = ["Content-Type", "X-Title", "X-OpenRouter-Cache"];

/** The schema candidate's exact route: model, effort, strict json_schema, ZDR, no temperature. */
export function schemaProbeSettings(production: ProviderSettings): ProviderSettings {
  const candidate = schemaDecodingCandidates[schemaProbeCandidateId];
  assert.ok(candidate?.structuredOutputMode === "json_schema", "Probe candidate must use schema");
  return providerSettingsSchema.parse(
    comparisonSettings(production, `${schemaProbeCandidateId}-probe`, {
      ...candidate,
      maxOutputTokens: schemaProbeMaxOutputTokens,
    }),
  );
}

const probeInput = (settings: ProviderSettings, operationKey: string) =>
  ({
    operationKey,
    model: settings.llmModel,
    schema: schemaProbeSchema,
    schemaName: schemaProbeSchemaName,
    system: schemaProbeSystem,
    input: schemaProbeInput,
  }) satisfies StructuredInput<z.infer<typeof schemaProbeSchema>>;

/**
 * Builds the request the production adapter would send, through a local fetch that never reaches
 * the network. The placeholder credential exists only to construct the adapter.
 */
export async function schemaProbeRequest(settings: ProviderSettings) {
  let captured: { url: string; serialized: string; headers: Headers } | undefined;
  const provider = new OpenRouterProvider("dry-run-placeholder", settings, async (url, init) => {
    captured = {
      url: String(url),
      serialized: String(init?.body),
      headers: new Headers(init?.headers),
    };
    throw new MigrationControlInterruption("dry_run_request_captured");
  });
  await provider.structured(probeInput(settings, "dry-run")).catch(() => undefined);
  assert.ok(captured, "The adapter refused the probe request before dispatch");
  const body = z
    .object({
      model: z.string(),
      max_tokens: z.number().int().positive(),
      response_format: z.object({ type: z.string() }).passthrough(),
    })
    .passthrough()
    .parse(JSON.parse(captured.serialized));
  return {
    url: captured.url,
    headers: Object.fromEntries(
      printableHeaders.flatMap((name) => {
        const value = captured?.headers.get(name);
        return value === null || value === undefined ? [] : [[name, value]];
      }),
    ),
    body,
    serialized: captured.serialized,
  };
}

/** Request bytes bound input tokens; the reserve uses the most expensive ZDR endpoint price. */
export function schemaProbeReserve(
  serialized: string,
  maxOutputTokens: number,
  rates: { promptRate: number; outputRate: number },
) {
  const inputTokenCeiling = Buffer.byteLength(serialized, "utf8");
  const reserveUsd = inputTokenCeiling * rates.promptRate + maxOutputTokens * rates.outputRate;
  if (!Number.isFinite(reserveUsd) || reserveUsd > migrationControls.enforcementProbe.hardUsd)
    throw new Error("probe_reserve_exceeds_hard_cap");
  return { reserveUsd, inputTokenCeiling, ...rates };
}

export type SchemaProbeOutcome =
  | "schema_valid"
  | "schema_invalid"
  | "truncated"
  | "fallback_blocked"
  | "dispatch_refused"
  | "http_rejected"
  | "reported_model_mismatch"
  | "outcome_unknown";

/**
 * Pass only when the visible output validates against the strict schema. Output that follows the
 * prompt instead shows that OpenRouter passed the schema as a hint, not as an enforced grammar.
 */
export function classifySchemaProbe(observed: {
  valid: boolean;
  errorCode?: string;
  uncertain?: boolean;
  /** A local control that stopped the call before it was dispatched. */
  blocked?: string;
  reportedModelMatches?: boolean;
  visibleContent?: string;
}): { outcome: SchemaProbeOutcome; grammarEnforced: boolean | null; followedPrompt: boolean } {
  let parsed: unknown;
  try {
    parsed =
      observed.visibleContent === undefined ? undefined : JSON.parse(observed.visibleContent);
  } catch {
    parsed = undefined;
  }
  const followedPrompt =
    !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && "answer" in parsed;
  const outcome: SchemaProbeOutcome =
    observed.blocked === "unexpected_transport_blocked"
      ? "fallback_blocked"
      : observed.blocked !== undefined
        ? "dispatch_refused"
        : observed.uncertain
          ? "outcome_unknown"
          : observed.reportedModelMatches === false
            ? "reported_model_mismatch"
            : observed.valid
              ? "schema_valid"
              : observed.errorCode === "provider_schema_invalid"
                ? "schema_invalid"
                : observed.errorCode === "provider_output_truncated"
                  ? "truncated"
                  : observed.errorCode?.startsWith("provider_http_") ||
                      observed.errorCode === "provider_request_schema_too_complex"
                    ? "http_rejected"
                    : "outcome_unknown";
  return {
    outcome,
    grammarEnforced:
      outcome === "schema_valid" ? true : outcome === "schema_invalid" ? false : null,
    followedPrompt,
  };
}

export type SchemaProbeOptions = {
  out: string;
  catalogPath?: string;
  zdrEndpointPath?: string;
  runLive: boolean;
  envFile?: string;
  approvedFreeze?: string;
  ledgerPath: string;
  configPath: string;
};

export function parseSchemaProbeOptions(argv: string[]): SchemaProbeOptions {
  const option = (name: string) => {
    const index = argv.indexOf(name);
    const value = index < 0 ? undefined : argv[index + 1];
    if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`Missing ${name} value`);
    return value;
  };
  return {
    out: resolve(option("--out") ?? "artifacts/verification/gemini-schema-probe"),
    catalogPath: option("--catalog-file"),
    zdrEndpointPath: option("--zdr-endpoint-file"),
    runLive: argv.includes("--run-live"),
    envFile: option("--env-file"),
    approvedFreeze: option("--approved-freeze"),
    ledgerPath: resolve("artifacts/verification/haiku55-evaluation-ledger.json"),
    configPath: resolve("config/openrouter-defaults.json"),
  };
}

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const save = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
};

/**
 * One strict json_schema request, dry run by default. Live, it needs --run-live, the approved
 * freeze and an explicit credential file, reserves at the most expensive ZDR price inside the
 * shared ledger and never dispatches a second request or the json_object fallback.
 */
export async function runSchemaProbe(
  options: SchemaProbeOptions,
  dependencies: { fetch: typeof fetch; write: (line: string) => void; today: () => string },
): Promise<number> {
  assert.ok(
    options.catalogPath && options.zdrEndpointPath,
    "The probe needs the captured model catalog and ZDR endpoint list",
  );
  const production = providerSettingsSchema.parse(
    JSON.parse(await readFile(options.configPath, "utf8")),
  );
  const settings = schemaProbeSettings(production);
  const overrides = settings.structuredModelOverrides?.[settings.llmModel];
  assert.equal(overrides?.structuredOutputMode, "json_schema");
  const request = await schemaProbeRequest(settings);
  assert.equal(request.url, endpoint);
  assert.equal(request.body.model, settings.llmModel);
  assert.equal(request.body.response_format.type, "json_schema", "The probe must send a schema");
  assert.equal(request.body.max_tokens, schemaProbeMaxOutputTokens);
  const catalog = await json(resolve(options.catalogPath));
  const zdrEndpoints = await json(resolve(options.zdrEndpointPath));
  const reserve = schemaProbeReserve(
    request.serialized,
    request.body.max_tokens,
    zdrEndpointMaximumRates(zdrEndpoints, settings.llmModel, catalog),
  );
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const paths = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "packages/core/src/aip",
    "packages/core/src/plt",
  ])
    .split(/\r?\n/)
    .filter((path) => path && !/\.(int\.)?test\.ts$/.test(path));
  for (const path of [
    "tools/eval/gemini-schema-probe.ts",
    "tools/eval/haiku55-migration-guards.ts",
    "tools/eval/model-comparison-candidates.ts",
    "config/openrouter-defaults.json",
    "pnpm-lock.yaml",
  ])
    if (!paths.includes(path)) paths.push(path);
  const pipelineHashes = await Promise.all(
    paths.sort().map(async (path) => ({ path, sha256: sha256Hex(await readFile(path)) })),
  );
  const statePath = resolve(options.out, "state.json");
  const priorState = await readMigrationRecordedJson(statePath);
  // The plan binds the run date; a recorded probe keeps the date it was frozen with.
  const date =
    priorState === undefined
      ? dependencies.today()
      : z.object({ date: z.string() }).parse(await json(resolve(options.out, "dry-run-plan.json")))
          .date;
  const plan = {
    version: schemaProbeVersion,
    syntheticOnly: true,
    date,
    candidateId: schemaProbeCandidateId,
    model: settings.llmModel,
    settings,
    structuredOutputMode: overrides?.structuredOutputMode,
    schemaName: schemaProbeSchemaName,
    schema: z.toJSONSchema(schemaProbeSchema),
    system: schemaProbeSystem,
    input: schemaProbeInput,
    request: { url: request.url, headers: request.headers, body: request.body },
    requestBodyHash: sha256Hex(request.serialized),
    reserve,
    passCriterion:
      "The visible output validates against the strict schema (verdict alpha, at least one x|y item); output following the prompt means the grammar is not enforced.",
    jsonObjectFallbackDispatched: false,
    controls: {
      ...migrationControls.enforcementProbe,
      cumulativeHardUsd: migrationControls.cumulativeHardUsd,
    },
    catalogHash: sha256Hex(canonicalJson(catalog)),
    zdrEndpointHash: sha256Hex(canonicalJson(zdrEndpoints)),
    pipelineHashes,
  };
  const freeze = sha256Hex(canonicalJson(plan));
  if (priorState !== undefined)
    assert.equal(
      z.object({ freeze: z.string() }).parse(priorState).freeze,
      freeze,
      "Preserve an earlier probe; choose a fresh output directory",
    );
  await save(resolve(options.out, "dry-run-plan.json"), { ...plan, freeze, paidCalls: 0 });
  if (!options.runLive) {
    dependencies.write(
      `${JSON.stringify({ dryRun: true, freeze, paidCalls: 0, reserveUsd: reserve.reserveUsd, hardUsd: migrationControls.enforcementProbe.hardUsd, request: plan.request })}\n`,
    );
    return 0;
  }
  assert.equal(options.approvedFreeze, freeze, "Root must approve this exact probe freeze");
  assert.ok(
    options.envFile,
    "Pass an existing credential file explicitly; do not copy its settings into the worktree",
  );
  // The credential stays in memory: never in process.env, a file, a log or an error.
  const key = parseEnv(await readFile(options.envFile, "utf8")).OPENROUTER_API_KEY ?? "";
  assert.ok(key.trim(), "Existing API credential unavailable");
  const redact = (value: unknown) =>
    JSON.parse(JSON.stringify(value).replaceAll(key, "[redacted]")) as unknown;
  const state = migrationRoundStateSchema.parse(
    priorState ?? { freeze, spentUsd: 0, stopped: false, requests: [], results: [] },
  );
  assert.equal(state.freeze, freeze);
  assert.ok(
    state.requests.length === 0 && state.results.length === 0,
    "The probe dispatches once; read its recorded outcome or recover offline, never retry",
  );
  const relativeDirectory = options.out.replace(resolve("."), "").replace(/^[\\/]+/, "");
  // Pre-flight under the lock: a probe that cannot fit the shared cap leaves no ledger entry.
  const roundSpent = await withMigrationLedger(options.ledgerPath, (ledger) => {
    const round = migrationLedgerRound(ledger, freeze, relativeDirectory, schemaProbeFixtureSet);
    assertMigrationCumulativeBudget(ledger, reserve.reserveUsd);
    return round.spentUsd;
  });
  assert.equal(roundSpent, state.spentUsd, "Ledger and probe state disagree; recover offline");
  assertMigrationDispatchAllowed(
    state.requests,
    state.spentUsd,
    reserve.reserveUsd,
    1,
    undefined,
    "enforcement-probe",
  );
  const persist = async () => {
    await save(statePath, state);
    await withMigrationLedger(options.ledgerPath, (ledger) => {
      const entry = ledger.rounds.find((value) => value.freeze === freeze);
      assert.ok(entry, "Ledger round disappeared");
      entry.spentUsd = state.spentUsd;
      entry.status = state.stopped
        ? "stopped"
        : state.results.length === 1
          ? "completed"
          : "running";
      // A started or uncertain dispatch keeps its reserve counted against the shared cap.
      entry.inFlightUsd = state.requests
        .filter((value) => value.state === "started" || value.state === "uncertain")
        .reduce((total, value) => total + value.reserveUsd, 0);
    });
  };
  let blocked: string | undefined,
    dispatches = 0,
    reportedModelMatches: boolean | undefined,
    visibleContent: string | undefined,
    receipt: Record<string, unknown> | undefined,
    paidOverBound = false;
  const provider = new OpenRouterProvider(key, settings, async (url, init) => {
    assert.equal(String(url), endpoint);
    dispatches += 1;
    const serialized = String(init?.body);
    const body = z
      .object({ max_tokens: z.number(), response_format: z.object({ type: z.string() }) })
      .passthrough()
      .parse(JSON.parse(serialized));
    // Only the frozen schema request is ever paid; the json_object fallback is never dispatched.
    if (
      dispatches > 1 ||
      migrationUnexpectedTransport(
        "json_schema",
        body.response_format.type,
        new Headers(init?.headers).get("Idempotency-Key") ?? "",
      )
    ) {
      blocked = "unexpected_transport_blocked";
      throw new MigrationControlInterruption(blocked);
    }
    if (sha256Hex(serialized) !== plan.requestBodyHash) {
      blocked = "request_differs_from_freeze";
      throw new MigrationControlInterruption(blocked);
    }
    try {
      assertMigrationDispatchAllowed(
        state.requests,
        state.spentUsd,
        reserve.reserveUsd,
        1,
        undefined,
        "enforcement-probe",
      );
      await withMigrationLedger(options.ledgerPath, (ledger) => {
        assertMigrationCumulativeBudget(ledger, reserve.reserveUsd);
        const entry = ledger.rounds.find((value) => value.freeze === freeze);
        assert.ok(entry, "Ledger round disappeared");
        entry.inFlightUsd = reserve.reserveUsd;
      });
    } catch (error) {
      blocked = error instanceof Error ? error.message : "dispatch_refused";
      throw new MigrationControlInterruption(blocked);
    }
    const started = {
      id: randomUUID(),
      caseId: "probe",
      stage: "probe",
      state: "started" as const,
      reserveUsd: reserve.reserveUsd,
    };
    state.requests.push(started);
    await persist();
    const began = Date.now();
    try {
      const response = await dependencies.fetch(url, init);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > migrationControls.responseBytes) {
            await reader.cancel();
            throw new Error("response_size_limit");
          }
          chunks.push(chunk.value);
        }
      const rawText = Buffer.concat(chunks).toString("utf8");
      const raw: unknown = JSON.parse(rawText);
      // The exact provider body, including any upstream 400 text, is kept for diagnosis.
      await save(
        resolve(options.out, "response.json"),
        redact({ syntheticOnly: true, status: response.status, body: raw }),
      );
      const metadata = z
        .object({
          id: z.string().optional(),
          model: z.string().optional(),
          provider: z.string().optional(),
          choices: z
            .array(
              z.object({
                finish_reason: z.string().nullable().optional(),
                message: z.object({ content: z.unknown().optional() }).optional(),
              }),
            )
            .optional(),
          usage: z
            .object({
              cost: z.number().nonnegative().optional(),
              prompt_tokens: z.number().optional(),
              completion_tokens: z.number().optional(),
              completion_tokens_details: z
                .object({ reasoning_tokens: z.number().optional() })
                .optional(),
              cost_details: z.unknown().optional(),
            })
            .optional(),
        })
        .parse(raw);
      if (response.status >= 500) throw new Error("provider_5xx_unknown_outcome");
      if (response.ok && metadata.usage?.cost === undefined)
        throw new Error("paid_cost_receipt_missing");
      receipt = {
        status: response.status,
        elapsedMs: Date.now() - began,
        requestId: metadata.id,
        model: metadata.model,
        provider: metadata.provider,
        finishReason: metadata.choices?.[0]?.finish_reason,
        inputTokens: metadata.usage?.prompt_tokens,
        outputTokens: metadata.usage?.completion_tokens,
        reasoningTokens: metadata.usage?.completion_tokens_details?.reasoning_tokens,
        usdCost: metadata.usage?.cost,
        costDetails: metadata.usage?.cost_details,
        reserveUsd: reserve.reserveUsd,
      };
      state.requests[0] = {
        ...started,
        state: response.ok ? "completed" : "known_rejection",
        ...(response.ok ? { costUsd: metadata.usage?.cost } : {}),
      };
      if (response.ok) state.spentUsd += metadata.usage?.cost ?? 0;
      paidOverBound =
        response.ok &&
        ((metadata.usage?.cost ?? 0) > reserve.reserveUsd ||
          (metadata.usage?.completion_tokens ?? 0) > body.max_tokens);
      await persist();
      await save(resolve(options.out, "receipt.json"), redact(receipt));
      if (response.ok)
        reportedModelMatches = migrationReportedModelMatches(metadata.model, settings.llmModel);
      const content = metadata.choices?.[0]?.message?.content;
      if (typeof content === "string") visibleContent = content;
      return new Response(rawText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (state.requests[0]?.state === "started")
        state.requests[0] = { ...started, state: "uncertain" };
      state.stopped = true;
      state.stopReason = error instanceof Error ? error.message : "probe_failure";
      await persist();
      throw error;
    }
  });
  let valid = false,
    errorCode: string | undefined,
    diagnostic: string | undefined,
    uncertain = false;
  try {
    await provider.structured(probeInput(settings, randomUUID()));
    valid = true;
  } catch (error) {
    errorCode = error instanceof ProviderError ? error.code : "probe_failure";
    diagnostic = error instanceof ProviderError ? error.diagnostic : undefined;
    uncertain = state.requests.some((value) => value.state === "uncertain");
  }
  const classified = classifySchemaProbe({
    valid,
    ...(errorCode ? { errorCode } : {}),
    uncertain,
    ...(blocked === undefined ? {} : { blocked }),
    ...(reportedModelMatches === undefined ? {} : { reportedModelMatches }),
    ...(visibleContent === undefined ? {} : { visibleContent }),
  });
  const result = {
    ...classified,
    schemaValid: valid,
    errorCode,
    diagnostic,
    blocked,
    visibleContent,
    paidReceiptExceedsReserveOrTokenCap: paidOverBound,
    httpRequests: state.requests.length,
  };
  state.results.push(redact(result) as Record<string, unknown>);
  if (
    classified.outcome === "outcome_unknown" ||
    classified.outcome === "dispatch_refused" ||
    paidOverBound
  ) {
    state.stopped = true;
    state.stopReason ??= paidOverBound
      ? "paid_receipt_exceeds_reserve_or_token_cap"
      : (blocked ?? errorCode);
  }
  await persist();
  const summary = {
    freeze,
    syntheticOnly: true,
    candidateId: schemaProbeCandidateId,
    model: settings.llmModel,
    ...result,
    receipt,
    spentUsd: state.spentUsd,
    stopped: state.stopped,
    stopReason: state.stopReason,
    unresolved: state.requests.filter(
      (value) => value.state === "started" || value.state === "uncertain",
    ),
    cumulativeMigrationQaUsd: await withMigrationLedger(
      options.ledgerPath,
      (ledger) =>
        ledger.priorUnledgeredUsd +
        ledger.rounds.reduce((total, entry) => total + entry.spentUsd, 0),
    ),
  };
  await save(resolve(options.out, "summary.json"), redact(summary));
  dependencies.write(`${JSON.stringify(redact({ ...summary, visibleContent: undefined }))}\n`);
  return classified.outcome === "schema_valid" ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSchemaProbe(parseSchemaProbeOptions(process.argv), {
    fetch,
    write: (line) => process.stdout.write(line),
    today: () => new Date().toISOString().slice(0, 10),
  });
