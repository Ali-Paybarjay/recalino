import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseEnv } from "node:util";
import {
  effectiveStructuredMaxOutputTokens,
  maximumProviderCost,
  OpenRouterProvider,
  ProviderError,
  type ProviderSettings,
  providerSettingsSchema,
} from "../../packages/core/src/aip";
import {
  buildLessonReviewInput,
  LESSON_REVIEW_RUBRIC_VERSION,
  LESSON_REVIEW_SYSTEM_PROMPT,
} from "../../packages/core/src/eval";
import { benchmarkCases, type LessonReviewBenchmarkCase } from "./lesson-review-benchmark-fixtures";
import {
  type BenchmarkRecord,
  renderLessonReviewBenchmarkReport,
  scoreLessonReviewBenchmark,
} from "./lesson-review-benchmark-score";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const VERSION = "lesson-review-benchmark-1";
type Suite = "smoke" | "development" | "holdout" | "all";
export interface BenchmarkOptions {
  suite: Suite;
  repeats: number;
  live: boolean;
  budgetMicros?: number;
  envFile?: string;
  out?: string;
  replayFrom?: string;
}

export function parseBenchmarkArgs(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>();
  let live = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--run-live") {
      if (live) throw new Error("duplicate_flag");
      live = true;
      continue;
    }
    if (
      !flag ||
      !["--suite", "--repeats", "--budget-usd", "--env-file", "--out", "--replay-from"].includes(
        flag,
      )
    )
      throw new Error("unknown_flag");
    const value = args[++index];
    if (!value || value.startsWith("--") || values.has(flag)) throw new Error("invalid_flag_value");
    values.set(flag, value);
  }
  const suite = values.get("--suite") ?? "smoke";
  if (!["smoke", "development", "holdout", "all"].includes(suite)) throw new Error("invalid_suite");
  const repeatText = values.get("--repeats") ?? "1";
  if (!/^[1-3]$/.test(repeatText)) throw new Error("invalid_repeats");
  const budgetText = values.get("--budget-usd");
  if (budgetText !== undefined && !/^\d+(?:\.\d{1,6})?$/.test(budgetText))
    throw new Error("invalid_budget");
  const budgetMicros =
    budgetText === undefined ? undefined : Math.round(Number(budgetText) * 1_000_000);
  if (budgetMicros !== undefined && (!Number.isSafeInteger(budgetMicros) || budgetMicros <= 0))
    throw new Error("invalid_budget");
  const replayFrom = values.get("--replay-from");
  if (live && !budgetMicros) throw new Error("live_budget_required");
  if (
    replayFrom &&
    (live ||
      values.has("--suite") ||
      values.has("--repeats") ||
      budgetText ||
      values.has("--env-file") ||
      values.has("--out"))
  )
    throw new Error("replay_uses_frozen_manifest_only");
  if (!live && !replayFrom && (budgetText || values.has("--env-file")))
    throw new Error("live_option_without_run_live");
  return {
    suite: suite as Suite,
    repeats: Number(repeatText),
    live,
    budgetMicros,
    envFile: values.get("--env-file"),
    out: values.get("--out"),
    replayFrom,
  };
}

export function selectBenchmarkCases(suite: Suite): LessonReviewBenchmarkCase[] {
  return benchmarkCases
    .filter((item) => suite === "all" || (suite === "smoke" ? item.smoke : item.split === suite))
    .sort(
      (a, b) =>
        Number(b.smoke) - Number(a.smoke) ||
        (a.split === b.split ? 0 : a.split === "development" ? -1 : 1) ||
        a.id.localeCompare(b.id, "en"),
    );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, json(value), { flag: "wx" });
  await rename(temporary, path);
}

export interface PreparedCase {
  fixture: LessonReviewBenchmarkCase;
  input: ReturnType<typeof buildLessonReviewInput>;
  requestBody: string;
}
/** Build the real adapter's initial wire request without network access or a credential. */
export async function prepareBenchmarkCase(
  fixture: LessonReviewBenchmarkCase,
  settings: ProviderSettings,
): Promise<PreparedCase> {
  const input = buildLessonReviewInput({
    ...fixture.input,
    maxInputCharacters: settings.maxInputCharacters,
  });
  let requestBody: string | undefined;
  const provider = new OpenRouterProvider("offline-placeholder", settings, async (url, init) => {
    if (String(url) !== ENDPOINT || typeof init?.body !== "string" || requestBody !== undefined)
      throw new Error("unexpected_plan_transport");
    requestBody = init.body;
    throw new Error("plan_network_disabled");
  });
  try {
    await provider.structured({
      operationKey: "offline-plan",
      model: settings.llmModel,
      schema: input.schema,
      schemaName: "lesson_quality_review",
      system: LESSON_REVIEW_SYSTEM_PROMPT,
      input: input.input,
    });
  } catch (error) {
    if (
      !(error instanceof ProviderError) ||
      error.code !== "provider_outcome_unknown" ||
      requestBody === undefined
    )
      throw error;
  }
  if (requestBody === undefined) throw new Error("plan_request_missing");
  return { fixture, input, requestBody };
}

// Freeze the request builders and validation/scoring definitions, not a mutable Git branch name.
const frozenCodePaths = [
  "packages/core/src/aip/openrouter.ts",
  "packages/core/src/aip/contracts.ts",
  "packages/core/src/aip/structured-schema.ts",
  "packages/core/src/aip/provider-http-error.ts",
  "packages/core/src/eval/lesson-review.ts",
  "packages/core/src/lkm/schema.ts",
  "tools/eval/lesson-review-benchmark.ts",
  "tools/eval/lesson-review-benchmark-fixtures.ts",
  "tools/eval/lesson-review-benchmark-score.ts",
];
export async function benchmarkFreeze(
  prepared: PreparedCase[],
  settings: ProviderSettings,
  repeats: number,
  budgetMicros: number | null = null,
) {
  return {
    version: VERSION,
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
    settingsHash: hash(json(settings)),
    promptHash: hash(LESSON_REVIEW_SYSTEM_PROMPT),
    code: Object.fromEntries(
      await Promise.all(
        frozenCodePaths.map(async (path) => [
          path,
          hash(await readFile(resolve(ROOT, path), "utf8")),
        ]),
      ),
    ),
    repeats,
    budgetMicros,
    cases: prepared.map(({ fixture, input, requestBody }) => ({
      id: fixture.id,
      familyId: fixture.familyId,
      split: fixture.split,
      smoke: fixture.smoke,
      explanationLanguage: fixture.explanationLanguage,
      inputHash: hash(input.input),
      referenceHash: hash(json(fixture.expected)),
      fixtureHash: hash(json(fixture)),
      requestHash: hash(requestBody),
    })),
  };
}

export interface BudgetAttempt {
  caseId: string;
  repeat: number;
  status: "started" | "received" | "uncertain";
  reservedMicros: number;
  actualMicros: number | null;
  httpStatus?: number;
  responseFile?: string;
  responseHash?: string;
  returnedModel?: string;
  requestId?: string;
  requestHash: string;
}
export function accountedMicros(attempts: readonly BudgetAttempt[]): number {
  return attempts.reduce(
    (sum, attempt) =>
      sum +
      (attempt.status === "received"
        ? (attempt.actualMicros ?? attempt.reservedMicros)
        : Math.max(attempt.reservedMicros, attempt.actualMicros ?? 0)),
    0,
  );
}
export function canReserve(
  attempts: readonly BudgetAttempt[],
  reserve: number,
  limit: number,
): boolean {
  if (![reserve, limit].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("invalid_cost_bound");
  return accountedMicros(attempts) + reserve <= limit;
}

interface State {
  version: typeof VERSION;
  freezeHash: string;
  budgetMicros: number;
  attempts: BudgetAttempt[];
  records: BenchmarkRecord[];
  completed: boolean;
}
interface Manifest {
  version: typeof VERSION;
  mode: "plan" | "live";
  createdAt: string;
  suite: Suite;
  repeats: number;
  budgetMicros: number | null;
  model: string;
  settings: ProviderSettings;
  freeze: Awaited<ReturnType<typeof benchmarkFreeze>>;
  freezeHash: string;
  labelStatus: "ai_authored_pending_human_review";
  transportPolicy: "one_http_attempt_per_trial_no_fallback";
}

/** Verify the configured hold against current text pricing before any paid request. */
export function verifyPriceBound(
  pricing: Record<string, unknown>,
  settings: ProviderSettings,
  maxRequestBytes: number,
) {
  const read = (key: string, optional = false) => {
    const raw = pricing[key];
    if (optional && raw === undefined) return 0;
    if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "")
      throw new Error("price_unavailable");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error("price_unavailable");
    return value;
  };
  const prompt = read("prompt");
  const completion = Math.max(read("completion"), read("internal_reasoning", true));
  // A deliberately loose text-token bound with framing headroom, using the full serialized body.
  // No images, audio, tools, search or cache writes are requested by this benchmark.
  const conservativeMicros = Math.ceil(
    ((maxRequestBytes + 4096) * prompt +
      effectiveStructuredMaxOutputTokens(settings, settings.llmModel) * completion +
      read("request", true)) *
      1_000_000,
  );
  const reservedMicros = maximumProviderCost(settings, settings.llmModel);
  if (conservativeMicros > reservedMicros)
    throw new Error("configured_reservation_below_current_price_bound");
  return {
    promptUsdPerToken: prompt,
    outputUsdPerToken: completion,
    conservativeMicros,
    reservedMicros,
    qualification: "text_byte_upper_estimate_plus_framing_headroom_not_provider_hard_spend_limit",
  };
}

function costFromBody(body: string): number | null {
  try {
    const value = JSON.parse(body)?.usage?.cost;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    const micros = Math.ceil(value * 1_000_000);
    return Number.isSafeInteger(micros) ? micros : null;
  } catch {
    return null;
  }
}
function responseIdentity(body: string): { returnedModel?: string; requestId?: string } {
  try {
    const value = JSON.parse(body);
    return {
      ...(typeof value?.model === "string" ? { returnedModel: value.model } : {}),
      ...(typeof value?.id === "string" ? { requestId: value.id } : {}),
    };
  } catch {
    return {};
  }
}
function safeError(error: unknown): string {
  return error instanceof ProviderError ? error.code : "benchmark_trial_failed";
}

/** Exact initial request only: no repair, fallback, or hidden paid retry. */
export async function executeBenchmarkTrial(options: {
  prepared: PreparedCase;
  settings: ProviderSettings;
  credential: string;
  repeat: number;
  attempts: BudgetAttempt[];
  budgetMicros: number;
  persist: () => Promise<void>;
  capture: (file: string, body: string) => Promise<void>;
  request: typeof fetch;
}): Promise<BenchmarkRecord> {
  const { prepared, settings, repeat } = options;
  const base = { caseId: prepared.fixture.id, repeat };
  const reserve = maximumProviderCost(settings, settings.llmModel);
  if (!canReserve(options.attempts, reserve, options.budgetMicros))
    return { ...base, outcome: "not_run", reason: "budget_limit" };
  let dispatched = false;
  let transportGuard = false;
  let persistenceFailed = false;
  let attempt: BudgetAttempt | undefined;
  const persist = async () => {
    try {
      await options.persist();
    } catch {
      persistenceFailed = true;
      throw new Error("benchmark_persistence_failed");
    }
  };
  const started = performance.now();
  const provider = new OpenRouterProvider(options.credential, settings, async (url, init) => {
    if (
      dispatched ||
      String(url) !== ENDPOINT ||
      init?.method !== "POST" ||
      typeof init.body !== "string" ||
      hash(init.body) !== hash(prepared.requestBody)
    ) {
      transportGuard = true;
      throw new Error("benchmark_transport_guard");
    }
    dispatched = true;
    attempt = {
      ...base,
      status: "started",
      reservedMicros: reserve,
      actualMicros: null,
      requestHash: hash(init.body),
    };
    options.attempts.push(attempt);
    // If persistence fails, no network is dispatched. The conservative reservation remains.
    await persist();
    try {
      const response = await options.request(url, init);
      const body = (await response.text()).replaceAll(options.credential, "[redacted]");
      const responseFile = `${prepared.fixture.id}.${repeat}.response.json`;
      await options.capture(responseFile, body);
      attempt.actualMicros = costFromBody(body);
      attempt.httpStatus = response.status;
      attempt.responseFile = responseFile;
      attempt.responseHash = hash(body);
      Object.assign(attempt, responseIdentity(body));
      attempt.status =
        response.status >= 500 || attempt.actualMicros === null ? "uncertain" : "received";
      await persist();
      return new Response(body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      attempt.status = "uncertain";
      await persist();
      throw error;
    }
  });
  try {
    const result = await provider.structured({
      operationKey: randomUUID(),
      model: settings.llmModel,
      schema: prepared.input.schema,
      schemaName: "lesson_quality_review",
      system: LESSON_REVIEW_SYSTEM_PROMPT,
      input: prepared.input.input,
    });
    if (result.model !== settings.llmModel)
      throw new ProviderError("provider_model_mismatch", false, false);
    return {
      ...base,
      outcome: "response",
      response: result.output,
      latencyMs: Math.round(performance.now() - started),
      ...(attempt?.actualMicros === null || attempt?.actualMicros === undefined
        ? {}
        : { costMicros: attempt.actualMicros }),
    };
  } catch (error) {
    // A broken ledger cannot safely produce a scored round or permit further dispatches.
    if (persistenceFailed) throw new Error("benchmark_persistence_failed");
    if (attempt && error instanceof ProviderError && error.uncertain && !transportGuard) {
      attempt.status = "uncertain";
      await persist();
    }
    if (transportGuard && !attempt)
      return { ...base, outcome: "not_run", reason: "transport_guard" };
    return {
      ...base,
      outcome: "failure",
      failureCode: transportGuard ? "benchmark_fallback_blocked" : safeError(error),
      latencyMs: Math.round(performance.now() - started),
      ...(attempt?.actualMicros === null || attempt?.actualMicros === undefined
        ? {}
        : { costMicros: attempt.actualMicros }),
    };
  }
}

function humanPacket(prepared: PreparedCase, record: BenchmarkRecord, label: string) {
  return {
    packetId: label,
    instructions:
      "Human review required. Independently inspect the lesson and selected evidence before reading the reviewer response. Assess whether each finding is true, whether its proposed correction is correct and actionable, and whether explanations use the requested explanation language. Do not infer correctness from schema validity. No gold labels or provider identity are supplied.",
    lessonInput: JSON.parse(prepared.input.input),
    reviewerResponse: record.outcome === "response" ? record.response : null,
    humanAssessment: {
      reviewerFindings: null,
      suggestions: null,
      explanationLanguage: null,
      notes: null,
      reviewedBy: null,
    },
  };
}

async function writeSummary(
  directory: string,
  prepared: PreparedCase[],
  records: BenchmarkRecord[],
  repeats: number,
  state: State,
) {
  const summary = scoreLessonReviewBenchmark(
    prepared.map((item) => item.fixture),
    records,
    { expectedRepeats: repeats },
  );
  const accounting = {
    budgetMicros: state.budgetMicros,
    accountedMicros: accountedMicros(state.attempts),
    knownActualMicros: state.attempts.reduce((sum, item) => sum + (item.actualMicros ?? 0), 0),
    unknownCostAttempts: state.attempts.filter((item) => item.actualMicros === null).length,
    unresolvedAttempts: state.attempts.filter((item) => item.status !== "received").length,
    completed: state.completed,
  };
  await atomicJson(resolve(directory, "report.json"), { summary, accounting });
  await writeFile(
    resolve(directory, "report.md"),
    `${renderLessonReviewBenchmarkReport(summary)}\n\nAccounting (USD micros):\n\n\`\`\`json\n${json(accounting)}\n\`\`\`\n`,
  );
}

export async function runBenchmark(options: BenchmarkOptions) {
  if (options.replayFrom) return replayBenchmark(resolve(options.replayFrom));
  const settings = providerSettingsSchema.parse(
    JSON.parse(await readFile(resolve(ROOT, "config/openrouter-defaults.json"), "utf8")),
  );
  const selected = selectBenchmarkCases(options.suite);
  if (!selected.length) throw new Error("empty_benchmark");
  const prepared = await Promise.all(
    selected.map((fixture) => prepareBenchmarkCase(fixture, settings)),
  );
  const freeze = await benchmarkFreeze(
    prepared,
    settings,
    options.repeats,
    options.budgetMicros ?? null,
  );
  const directory = resolve(
    options.out ??
      resolve(
        ROOT,
        "artifacts/verification/lesson-review-benchmark",
        new Date().toISOString().replace(/[:.]/g, "-"),
      ),
  );
  await mkdir(dirname(directory), { recursive: true });
  // An existing directory, even an interrupted one, is never reused for a paid execution.
  await mkdir(directory);
  const manifest: Manifest = {
    version: VERSION,
    mode: options.live ? "live" : "plan",
    createdAt: new Date().toISOString(),
    suite: options.suite,
    repeats: options.repeats,
    budgetMicros: options.budgetMicros ?? null,
    model: settings.llmModel,
    settings,
    freeze,
    freezeHash: hash(json(freeze)),
    labelStatus: "ai_authored_pending_human_review",
    transportPolicy: "one_http_attempt_per_trial_no_fallback",
  };
  await writeFile(resolve(directory, "manifest.json"), json(manifest), { flag: "wx" });
  await writeFile(
    resolve(directory, "reference-labels.json"),
    json(selected.map(({ id, expected, provenance }) => ({ id, expected, provenance }))),
    { flag: "wx" },
  );
  await mkdir(resolve(directory, "inputs"));
  for (const item of prepared)
    await writeFile(resolve(directory, "inputs", `${item.fixture.id}.json`), item.input.input, {
      flag: "wx",
    });
  const plan = {
    directory,
    mode: manifest.mode,
    cases: selected.length,
    independentFamilies: new Set(selected.map((item) => item.familyId)).size,
    languages: [...new Set(selected.map((item) => item.explanationLanguage))],
    model: settings.llmModel,
    plannedTrials: selected.length * options.repeats,
    reservationPerTrialMicros: maximumProviderCost(settings, settings.llmModel),
    budgetMicros: options.budgetMicros ?? null,
    humanReview: "required",
  };
  process.stdout.write(`${json(plan)}\n`);
  if (!options.live) return plan;
  if (!options.budgetMicros) throw new Error("live_budget_required");
  // Only the explicitly chosen existing file (or process env) supplies the provider credential.
  const credential =
    process.env.OPENROUTER_API_KEY ||
    (options.envFile
      ? parseEnv(await readFile(resolve(options.envFile), "utf8")).OPENROUTER_API_KEY
      : undefined);
  if (!credential) throw new Error("provider_credential_unavailable_use_existing_env_file");
  const modelResponse = await fetch(MODELS_ENDPOINT, { signal: AbortSignal.timeout(30_000) });
  if (!modelResponse.ok) throw new Error("current_model_prices_unavailable");
  const modelData = (await modelResponse.json()) as {
    data?: { id: string; pricing: Record<string, unknown> }[];
  };
  const model = modelData.data?.find((entry) => entry.id === settings.llmModel);
  if (!model) throw new Error("configured_model_unavailable");
  const priceCheck = verifyPriceBound(
    model.pricing,
    settings,
    Math.max(...prepared.map((item) => Buffer.byteLength(item.requestBody, "utf8"))),
  );
  await writeFile(
    resolve(directory, "price-check.json"),
    json({
      checkedAt: new Date().toISOString(),
      model: model.id,
      pricing: model.pricing,
      ...priceCheck,
    }),
    { flag: "wx" },
  );
  const state: State = {
    version: VERSION,
    freezeHash: manifest.freezeHash,
    budgetMicros: options.budgetMicros,
    attempts: [],
    records: [],
    completed: false,
  };
  const persist = () => atomicJson(resolve(directory, "state.json"), state);
  await persist();
  await mkdir(resolve(directory, "responses"));
  await mkdir(resolve(directory, "human-review"));
  let packet = 0;
  let stoppedReason: "previous_unknown_outcome" | "transport_guard" | undefined;
  const packetManifest: { packet: string; caseId: string; repeat: number; sha256: string }[] = [];
  // First pass starts with all 12 smoke cases; repetitions never inflate independent cases.
  for (let repeat = 0; repeat < options.repeats; repeat++) {
    for (const item of prepared) {
      const record: BenchmarkRecord = stoppedReason
        ? {
            caseId: item.fixture.id,
            repeat,
            outcome: "not_run",
            reason: stoppedReason,
          }
        : await executeBenchmarkTrial({
            prepared: item,
            settings,
            credential,
            repeat,
            attempts: state.attempts,
            budgetMicros: state.budgetMicros,
            persist,
            capture: (file, body) =>
              writeFile(resolve(directory, "responses", file), body, { flag: "wx" }),
            request: fetch,
          });
      state.records.push(record);
      if (
        state.attempts.some(
          (attempt) =>
            attempt.status === "started" ||
            attempt.status === "uncertain" ||
            (attempt.actualMicros !== null && attempt.actualMicros > attempt.reservedMicros),
        )
      )
        stoppedReason = "previous_unknown_outcome";
      if (record.outcome === "failure" && record.failureCode === "provider_model_mismatch")
        stoppedReason = "transport_guard";
      await persist();
      if (record.outcome === "response") {
        const label = `packet-${String(++packet).padStart(3, "0")}`;
        const body = json(humanPacket(item, record, label));
        await writeFile(resolve(directory, "human-review", `${label}.json`), body, { flag: "wx" });
        packetManifest.push({ packet: label, caseId: item.fixture.id, repeat, sha256: hash(body) });
      }
      process.stdout.write(
        `${json({ caseId: item.fixture.id, repeat, outcome: record.outcome, accountedMicros: accountedMicros(state.attempts), budgetMicros: state.budgetMicros })}\n`,
      );
    }
    await writeSummary(directory, prepared, state.records, options.repeats, state);
  }
  state.completed = true;
  await persist();
  await writeFile(resolve(directory, "human-review-manifest.json"), json(packetManifest), {
    flag: "wx",
  });
  await writeSummary(directory, prepared, state.records, options.repeats, state);
  return {
    ...plan,
    accountedMicros: accountedMicros(state.attempts),
    report: resolve(directory, "report.md"),
  };
}

/** No credentials, no fetch: frozen captures pass through the same production decoder again. */
export async function replayBenchmark(directory: string) {
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  ) as Manifest;
  if (
    manifest.version !== VERSION ||
    manifest.mode !== "live" ||
    !["smoke", "development", "holdout", "all"].includes(manifest.suite) ||
    !Number.isInteger(manifest.repeats) ||
    manifest.repeats < 1 ||
    manifest.repeats > 3
  )
    throw new Error("invalid_replay_manifest");
  const settings = providerSettingsSchema.parse(manifest.settings);
  const prepared = await Promise.all(
    selectBenchmarkCases(manifest.suite).map((fixture) => prepareBenchmarkCase(fixture, settings)),
  );
  const freeze = await benchmarkFreeze(prepared, settings, manifest.repeats, manifest.budgetMicros);
  if (
    hash(json(freeze)) !== manifest.freezeHash ||
    hash(json(manifest.freeze)) !== manifest.freezeHash
  )
    throw new Error("replay_freeze_mismatch");
  const state = JSON.parse(await readFile(resolve(directory, "state.json"), "utf8")) as State;
  if (
    state.version !== VERSION ||
    state.freezeHash !== manifest.freezeHash ||
    state.budgetMicros !== manifest.budgetMicros ||
    !state.completed ||
    !Array.isArray(state.attempts) ||
    !Array.isArray(state.records)
  )
    throw new Error("replay_state_incomplete");
  if (!Number.isSafeInteger(state.budgetMicros) || state.budgetMicros <= 0)
    throw new Error("replay_budget_invalid");
  const reference = await readFile(resolve(directory, "reference-labels.json"), "utf8");
  if (
    reference !==
    json(
      prepared.map(({ fixture: { id, expected, provenance } }) => ({ id, expected, provenance })),
    )
  )
    throw new Error("replay_reference_tampered");
  for (const item of prepared) {
    if (
      (await readFile(resolve(directory, "inputs", `${item.fixture.id}.json`), "utf8")) !==
      item.input.input
    )
      throw new Error("replay_input_tampered");
  }
  for (const attempt of state.attempts) {
    const item = prepared.find((entry) => entry.fixture.id === attempt.caseId);
    if (
      !item ||
      !Number.isInteger(attempt.repeat) ||
      attempt.repeat < 0 ||
      attempt.repeat >= manifest.repeats ||
      !["received", "uncertain"].includes(attempt.status) ||
      attempt.reservedMicros !== maximumProviderCost(settings, settings.llmModel) ||
      (attempt.actualMicros !== null &&
        (!Number.isSafeInteger(attempt.actualMicros) || attempt.actualMicros < 0)) ||
      attempt.requestHash !== hash(item.requestBody)
    )
      throw new Error("replay_attempt_invalid");
  }
  const replayed: BenchmarkRecord[] = [];
  const replayLedger: BudgetAttempt[] = [];
  let replayStoppedReason: "previous_unknown_outcome" | "transport_guard" | undefined;
  for (let repeat = 0; repeat < manifest.repeats; repeat++) {
    for (const item of prepared) {
      const captures = state.attempts.filter(
        (attempt) => attempt.caseId === item.fixture.id && attempt.repeat === repeat,
      );
      if (captures.length > 1) throw new Error("duplicate_replay_attempt");
      const capture = captures[0];
      const previous = state.records.filter(
        (record) => record.caseId === item.fixture.id && record.repeat === repeat,
      );
      if (previous.length !== 1) throw new Error("replay_record_missing_or_duplicated");
      if (capture) {
        if (
          state.attempts[replayLedger.length] !== capture ||
          replayStoppedReason ||
          !canReserve(replayLedger, capture.reservedMicros, state.budgetMicros)
        )
          throw new Error("replay_dispatch_not_admitted");
        replayLedger.push(capture);
      } else {
        const expectedReason =
          replayStoppedReason ??
          (!canReserve(
            replayLedger,
            maximumProviderCost(settings, settings.llmModel),
            state.budgetMicros,
          )
            ? "budget_limit"
            : undefined);
        if (previous[0]?.outcome !== "not_run" || previous[0].reason !== expectedReason)
          throw new Error("replay_non_dispatch_not_justified");
      }
      if (!capture?.responseFile) {
        if (
          previous[0]?.outcome === "response" ||
          (!capture && previous[0]?.outcome !== "not_run") ||
          (capture &&
            (capture.status !== "uncertain" ||
              capture.actualMicros !== null ||
              previous[0]?.outcome !== "failure"))
        )
          throw new Error("replay_capture_missing");
        replayed.push(previous[0] as BenchmarkRecord);
        if (capture) replayStoppedReason = "previous_unknown_outcome";
        continue;
      }
      if (
        capture.responseFile !== `${item.fixture.id}.${repeat}.response.json` ||
        capture.requestHash !== hash(item.requestBody)
      )
        throw new Error("replay_request_mismatch");
      const body = await readFile(resolve(directory, "responses", capture.responseFile), "utf8");
      if (hash(body) !== capture.responseHash || !capture.httpStatus)
        throw new Error("replay_response_tampered");
      if (costFromBody(body) !== capture.actualMicros) throw new Error("replay_cost_tampered");
      const identity = responseIdentity(body);
      if (
        identity.returnedModel !== capture.returnedModel ||
        identity.requestId !== capture.requestId
      )
        throw new Error("replay_identity_tampered");
      let expectedStatus =
        capture.httpStatus >= 500 || capture.actualMicros === null ? "uncertain" : "received";
      let calls = 0;
      let blockedFallback = false;
      const provider = new OpenRouterProvider(
        "replay-no-credential",
        settings,
        async (url, init) => {
          if (++calls !== 1) {
            blockedFallback = true;
            throw new Error("replay_fallback_blocked");
          }
          if (
            String(url) !== ENDPOINT ||
            typeof init?.body !== "string" ||
            hash(init.body) !== capture.requestHash
          )
            throw new Error("replay_request_mismatch");
          return new Response(body, {
            status: capture.httpStatus,
            headers: { "content-type": "application/json" },
          });
        },
      );
      const base = {
        caseId: item.fixture.id,
        repeat,
        ...(previous[0]?.latencyMs === undefined ? {} : { latencyMs: previous[0].latencyMs }),
        ...(capture.actualMicros === null ? {} : { costMicros: capture.actualMicros }),
      };
      try {
        const result = await provider.structured({
          operationKey: "offline-replay",
          model: settings.llmModel,
          schema: item.input.schema,
          schemaName: "lesson_quality_review",
          system: LESSON_REVIEW_SYSTEM_PROMPT,
          input: item.input.input,
        });
        if (result.model !== settings.llmModel)
          throw new ProviderError("provider_model_mismatch", false, false);
        replayed.push({ ...base, outcome: "response", response: result.output });
      } catch (error) {
        if (error instanceof ProviderError && error.uncertain && !blockedFallback)
          expectedStatus = "uncertain";
        replayed.push({
          ...base,
          outcome: "failure",
          failureCode: blockedFallback ? "benchmark_fallback_blocked" : safeError(error),
        });
      }
      if (capture.status !== expectedStatus) throw new Error("replay_attempt_status_mismatch");
      if (
        capture.status === "uncertain" ||
        (capture.actualMicros !== null && capture.actualMicros > capture.reservedMicros)
      )
        replayStoppedReason = "previous_unknown_outcome";
      const last = replayed.at(-1);
      if (last?.outcome === "failure" && last.failureCode === "provider_model_mismatch")
        replayStoppedReason = "transport_guard";
    }
  }
  if (!isDeepStrictEqual(replayed, state.records)) throw new Error("replay_record_mismatch");
  const summary = scoreLessonReviewBenchmark(
    prepared.map((item) => item.fixture),
    replayed,
    { expectedRepeats: manifest.repeats },
  );
  const result = {
    networkCalls: 0,
    verified: true,
    records: replayed.length,
    accountedMicros: accountedMicros(state.attempts),
    summary,
  };
  await atomicJson(resolve(directory, "replay-report.json"), result);
  process.stdout.write(
    `${json({ replay: "verified", networkCalls: 0, records: replayed.length, directory })}\n`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBenchmark(parseBenchmarkArgs(process.argv.slice(2))).catch((error: unknown) => {
    // Never print provider bodies, environment values, or the credential on failure.
    const message =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "benchmark_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
