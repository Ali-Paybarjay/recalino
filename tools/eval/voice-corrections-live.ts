import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  type AiProvider,
  OpenRouterProvider,
  ProviderError,
  type ProviderResult,
} from "../../packages/core/src/aip";
import type { Database } from "../../packages/core/src/db";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import {
  correctVoiceCandidates,
  type VoiceCorrectionExecutor,
  validateVoiceCorrections,
} from "../../packages/core/src/proc/voice-processing";
import {
  assertWithinHardBudget,
  evidenceDiagnostics,
  flattenSuggestions,
  type VoiceEvalCandidate,
  voiceEvalCandidates,
  voiceEvalControls,
  voiceEvalSettings,
  voiceRequestReserveUsd,
  zdrMaximumRates,
} from "./voice-corrections-eval";
import {
  type BuiltVoiceCase,
  buildVoiceCase,
  syntheticUuid,
  voiceCorrectionFixtures,
} from "./voice-corrections-fixtures";

/**
 * Usage (offline plan, no network):
 *   pnpm exec tsx tools/eval/voice-corrections-live.ts --zdr-endpoint-file <zdr.json>
 * Paid run (owner approval of the printed freeze and a hard cap first):
 *   pnpm exec tsx tools/eval/voice-corrections-live.ts --run-live --approved-freeze <hash>
 *     --hard-usd <cap> --env-file <existing env file> --zdr-endpoint-file <zdr.json>
 * The credential is read into memory only; it is never printed, copied or written.
 */
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const live = args.includes("--run-live");
const root = resolve("artifacts/verification/voice-corrections-eval");
const zdrPath = option("--zdr-endpoint-file");
assert.ok(zdrPath, "Pass the captured ZDR endpoint list with --zdr-endpoint-file");
const zdrEndpoints = JSON.parse(await readFile(resolve(zdrPath), "utf8"));
const caseFilter = option("--cases")?.split(",");
const candidateFilter = option("--candidates")?.split(",");

const pipelineFiles = [
  "packages/core/src/proc/voice-processing.ts",
  "packages/core/src/aip/openrouter.ts",
  "packages/core/src/aip/structured-schema.ts",
  "packages/core/src/aip/contracts.ts",
  "packages/core/src/aip/provider-http-error.ts",
  "packages/core/src/voc/spoken-evidence.ts",
  "packages/core/src/voc/contracts.ts",
  "packages/core/src/lkm/schema.ts",
  "tools/eval/voice-corrections-eval.ts",
  "tools/eval/voice-corrections-fixtures.ts",
  "tools/eval/voice-corrections-live.ts",
  "pnpm-lock.yaml",
  "package.json",
];
const pipelineHashes = await Promise.all(
  pipelineFiles.map(async (path) => ({ path, sha256: sha256Hex(await readFile(path)) })),
);
const rates = Object.fromEntries(
  voiceEvalCandidates.map((candidate) => [
    candidate.id,
    zdrMaximumRates(zdrEndpoints, candidate.model),
  ]),
);
// Every case and candidate is part of the freeze; a filtered run executes a subset of it.
const freeze = sha256Hex(
  canonicalJson({
    controls: voiceEvalControls,
    candidates: voiceEvalCandidates.map((candidate) => ({
      ...candidate,
      settings: voiceEvalSettings(candidate.model),
    })),
    fixtures: voiceCorrectionFixtures,
    pipelineHashes,
    node: process.version,
    zdr: sha256Hex(canonicalJson(zdrEndpoints)),
  }),
);
const cases = voiceCorrectionFixtures
  .filter((fixture) => !caseFilter || caseFilter.includes(fixture.id))
  .map(buildVoiceCase);
const candidates = voiceEvalCandidates.filter(
  (candidate) => !candidateFilter || candidateFilter.includes(candidate.id),
);
assert.ok(cases.length && candidates.length, "Nothing selected");

const noDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error("database_access_not_expected");
    },
  },
) as Database;
const ctx = { userId: syntheticUuid("user"), requestId: syntheticUuid("request") };
const now = () => new Date("2026-10-10T12:00:00.000Z");

interface HttpRecord {
  operationKey: string;
  responseFormat: string;
  bodyHash: string;
  bodyBytes: number;
  maxTokens: number;
  reasoning: unknown;
  temperature: unknown;
  reserveUsd: number;
  state: "started" | "completed" | "known_rejection" | "uncertain";
  httpStatus?: number;
  latencyMs?: number;
  costUsd?: number;
  usage?: unknown;
  endpointProvider?: string;
  reportedModel?: string;
  finishReason?: string | null;
  responseText?: string;
}
interface AttemptRecord {
  attempt: number;
  outcome: string;
  /** A local stop before dispatch; the provider would otherwise report it as an unknown outcome. */
  localStop?: string;
  uncertain: boolean;
  http: HttpRecord[];
  rawOutput?: unknown;
  rawSuggestions: ReturnType<typeof flattenSuggestions>;
  shown?: Record<string, unknown[]>;
  diagnostics: string[];
  elapsedMs: number;
}

async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

/** Runs the production correction request once, through the given transport. */
async function runAttempt(
  built: BuiltVoiceCase,
  candidate: VoiceEvalCandidate,
  attempt: number,
  key: string,
  transport: (record: AttemptRecord) => typeof fetch,
): Promise<AttemptRecord> {
  const record: AttemptRecord = {
    attempt,
    outcome: "pending",
    uncertain: false,
    http: [],
    rawSuggestions: [],
    diagnostics: [],
    elapsedMs: 0,
  };
  const provider = new OpenRouterProvider(
    key,
    voiceEvalSettings(candidate.model),
    transport(record),
  );
  let captured: ProviderResult<unknown> | undefined;
  const recording: AiProvider = {
    name: provider.name,
    mode: provider.mode,
    settings: provider.settings,
    structured: async (input) => {
      const result = await provider.structured(input);
      captured = result as ProviderResult<unknown>;
      return result;
    },
    transcribe: (input) => provider.transcribe(input),
    speech: (input) => provider.speech(input),
  };
  const operationKey = `voice-eval:${freeze.slice(0, 12)}:${built.fixture.id}:${candidate.id}:${attempt}`;
  const execute: VoiceCorrectionExecutor = async (request) => {
    assert.equal(request.model, candidate.model, "The step must dispatch the voice model");
    const result = await request.effect(operationKey);
    return request.schema.parse(result.output);
  };
  const started = performance.now();
  try {
    await correctVoiceCandidates({
      db: noDatabase,
      ctx,
      analysis: built.analysis,
      provider: recording,
      execute,
      now,
      referenceTexts: built.fixture.referenceTexts,
      explanationLanguage: built.fixture.language,
    });
    record.outcome = "valid";
  } catch (error) {
    record.outcome =
      error instanceof ProviderError
        ? error.code
        : error instanceof Error
          ? error.message
          : "error";
    record.uncertain = error instanceof ProviderError && error.uncertain;
  }
  if (record.localStop) {
    record.outcome = record.localStop;
    record.uncertain = false;
  }
  record.elapsedMs = Math.round(performance.now() - started);
  const output =
    captured?.output ??
    (() => {
      // A response the strict schema rejected is kept for diagnosis only; nothing is shown.
      const text = record.http.at(-1)?.responseText;
      try {
        const content = JSON.parse(text ?? "null")?.choices?.[0]?.message?.content;
        return typeof content === "string" ? JSON.parse(content) : undefined;
      } catch {
        return undefined;
      }
    })();
  record.rawOutput = output;
  record.rawSuggestions = flattenSuggestions(output);
  if (record.outcome === "valid" && captured)
    record.shown = validateVoiceCorrections(
      built.analysis,
      captured.output,
      built.fixture.referenceTexts,
      built.fixture.language,
    );
  if (record.outcome === "voice_correction_evidence_invalid")
    record.diagnostics = evidenceDiagnostics(built, output, built.fixture.language);
  return record;
}

const dryResponse = (model: string) =>
  new Response(
    JSON.stringify({
      id: "dry-run",
      model,
      choices: [{ finish_reason: "stop", message: { content: '{"candidates":[]}' } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
const describeBody = (serialized: string) => {
  const body = JSON.parse(serialized);
  return {
    model: String(body.model),
    responseFormat: String(body.response_format?.type),
    maxTokens: Number(body.max_tokens),
    reasoning: body.reasoning ?? null,
    temperature: body.temperature ?? null,
    provider: body.provider,
  };
};

if (!live) {
  const plan: {
    caseId: string;
    language: string;
    candidateId: string;
    model: string;
    responseFormat: string;
    maxTokens: number;
    reasoning: unknown;
    temperature: unknown;
    provider: unknown;
    bodyBytes: number;
    bodySha256: string;
    eligibleUtterances: number;
    reserveUsd: number;
  }[] = [];
  for (const built of cases)
    for (const candidate of candidates) {
      let body = "";
      const record = await runAttempt(
        built,
        candidate,
        1,
        "dry-run-no-key",
        () => async (url, init) => {
          assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
          body = String(init?.body);
          return dryResponse(candidate.model);
        },
      );
      assert.equal(
        record.outcome,
        "valid",
        `${built.fixture.id}/${candidate.id}: ${record.outcome}`,
      );
      const described = describeBody(body);
      plan.push({
        caseId: built.fixture.id,
        language: built.fixture.language,
        candidateId: candidate.id,
        ...described,
        bodyBytes: Buffer.byteLength(body, "utf8"),
        bodySha256: sha256Hex(body),
        eligibleUtterances: built.analysis.utterances.filter((item) => item.eligible).length,
        reserveUsd: voiceRequestReserveUsd(rates[candidate.id] as never, body, described.maxTokens),
      });
    }
  const perCandidate = Object.fromEntries(
    candidates.map((candidate) => {
      const rows = plan.filter((row) => row.candidateId === candidate.id);
      return [
        candidate.id,
        {
          requests: rows.length,
          maxReserveUsd: Math.max(...rows.map((row) => row.reserveUsd)),
          sumFirstAttemptReserveUsd: rows.reduce((total, row) => total + row.reserveUsd, 0),
          zdrMaximumRates: rates[candidate.id],
        },
      ];
    }),
  );
  await save(resolve(root, "dry-run-plan.json"), {
    syntheticOnly: true,
    freeze,
    pipelineHashes,
    perCandidate,
    plan,
  });
  // The production comparison script rebuilds each request on the c50c018 checkout from this.
  await save(
    resolve(root, "prepared-cases.json"),
    cases.map((built) => ({
      caseId: built.fixture.id,
      language: built.fixture.language,
      referenceTexts: built.fixture.referenceTexts,
      analysis: built.analysis,
    })),
  );
  process.stdout.write(
    `${JSON.stringify({ live: false, freeze, cases: cases.length, candidates: candidates.map((item) => item.id), perCandidate }, null, 2)}\n`,
  );
  process.exit(0);
}

const approved = option("--approved-freeze");
assert.equal(approved, freeze, "The approved freeze does not match this code and fixture set");
const hardUsd = Number(option("--hard-usd"));
assert.ok(
  Number.isFinite(hardUsd) && hardUsd > 0 && hardUsd <= 5,
  "Pass the approved --hard-usd cap",
);
const envFile = option("--env-file");
assert.ok(envFile, "Pass an existing credential file with --env-file; it is read into memory only");
const credential = parseEnv(await readFile(envFile, "utf8")).OPENROUTER_API_KEY;
if (!credential?.trim()) throw new Error("Existing API credential unavailable");
const key: string = credential;

const directory = resolve(root, freeze.slice(0, 16));
const statePath = resolve(directory, "state.json");
const ledgerPath = resolve(root, "ledger.json");
type State = {
  freeze: string;
  hardUsd: number;
  spentUsd: number;
  uncertainUsd: number;
  inFlightUsd: number;
  stopped: boolean;
  stopReason?: string;
  pairs: Record<string, { status: "running" | "done"; attempts: AttemptRecord[] }>;
};
const prior = await readFile(statePath, "utf8")
  .then((text) => JSON.parse(text) as State)
  .catch(() => undefined);
const state: State = prior ?? {
  freeze,
  hardUsd,
  spentUsd: 0,
  uncertainUsd: 0,
  inFlightUsd: 0,
  stopped: false,
  pairs: {},
};
assert.equal(state.freeze, freeze, "State belongs to another freeze");
assert.ok(hardUsd <= state.hardUsd, "A resumed round never raises its approved cap");
assert.ok(!state.stopped, `Round stopped: ${state.stopReason}`);
assert.equal(
  state.inFlightUsd,
  0,
  "An interrupted dispatch must be recovered offline, never retried",
);
assert.ok(
  !Object.values(state.pairs).some((pair) => pair.status === "running"),
  "An interrupted pair must be recovered offline, never retried",
);
let writes = Promise.resolve();
const persist = () => {
  writes = writes.then(async () => {
    await save(statePath, state);
    const ledger = await readFile(ledgerPath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => ({ rounds: [] }));
    const entry = ledger.rounds.find((round: { freeze: string }) => round.freeze === freeze);
    const summary = {
      freeze,
      hardUsd: state.hardUsd,
      spentUsd: state.spentUsd,
      uncertainUsd: state.uncertainUsd,
      pairsDone: Object.values(state.pairs).filter((pair) => pair.status === "done").length,
      stopped: state.stopped,
    };
    if (entry) Object.assign(entry, summary);
    else ledger.rounds.push(summary);
    await save(ledgerPath, ledger);
  });
  return writes;
};

const guarded =
  (candidate: VoiceEvalCandidate) =>
  (record: AttemptRecord): typeof fetch =>
  async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    const serialized = String(init?.body);
    const described = describeBody(serialized);
    assert.equal(described.model, candidate.model, "Only the evaluated model may be dispatched");
    const reserveUsd = voiceRequestReserveUsd(
      rates[candidate.id] as never,
      serialized,
      described.maxTokens,
    );
    const stopFile = await readFile(resolve(directory, "STOP_REQUESTED"), "utf8").catch(() => null);
    if (stopFile !== null) {
      record.localStop = "stop_requested";
      throw new Error(record.localStop);
    }
    try {
      assertWithinHardBudget({
        spentUsd: state.spentUsd,
        uncertainUsd: state.uncertainUsd,
        inFlightUsd: state.inFlightUsd,
        reserveUsd,
        hardUsd,
      });
    } catch (error) {
      record.localStop = error instanceof Error ? error.message : "hard_budget_before_dispatch";
      throw error;
    }
    const http: HttpRecord = {
      operationKey: new Headers(init?.headers).get("Idempotency-Key") ?? "",
      responseFormat: described.responseFormat,
      bodyHash: sha256Hex(serialized),
      bodyBytes: Buffer.byteLength(serialized, "utf8"),
      maxTokens: described.maxTokens,
      reasoning: described.reasoning,
      temperature: described.temperature,
      reserveUsd,
      state: "started",
    };
    record.http.push(http);
    state.inFlightUsd += reserveUsd;
    await persist();
    const started = performance.now();
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, init);
      text = await response.text();
    } catch (error) {
      http.state = "uncertain";
      http.latencyMs = Math.round(performance.now() - started);
      state.inFlightUsd -= reserveUsd;
      // Cost unknown: the whole reserve stays counted against the cap.
      state.uncertainUsd += reserveUsd;
      await persist();
      throw error;
    }
    http.latencyMs = Math.round(performance.now() - started);
    http.httpStatus = response.status;
    http.responseText = text;
    state.inFlightUsd -= reserveUsd;
    if (response.ok) {
      try {
        const body = JSON.parse(text);
        const cost = Number(body?.usage?.cost);
        http.costUsd = Number.isFinite(cost) ? cost : undefined;
        http.usage = body?.usage;
        http.endpointProvider = typeof body?.provider === "string" ? body.provider : undefined;
        http.reportedModel = typeof body?.model === "string" ? body.model : undefined;
        http.finishReason = body?.choices?.[0]?.finish_reason ?? null;
      } catch {
        http.costUsd = undefined;
      }
      http.state = "completed";
      if (http.costUsd === undefined) state.uncertainUsd += reserveUsd;
      else state.spentUsd += http.costUsd;
    } else {
      // A refused HTTP request generated nothing and is not billed.
      http.state = "known_rejection";
      http.costUsd = 0;
    }
    await persist();
    return new Response(text, { status: response.status, headers: response.headers });
  };

const pairs = cases.flatMap((built, index) =>
  // Alternate which model goes first so neither always meets a warmer endpoint.
  (index % 2 === 0 ? candidates : [...candidates].reverse()).map((candidate) => ({
    built,
    candidate,
  })),
);
const pending = pairs.filter(
  ({ built, candidate }) => state.pairs[`${built.fixture.id}:${candidate.id}`]?.status !== "done",
);
let stop: string | undefined;
async function runPair(built: BuiltVoiceCase, candidate: VoiceEvalCandidate) {
  const id = `${built.fixture.id}:${candidate.id}`;
  const entry = state.pairs[id] ?? { status: "running", attempts: [] };
  state.pairs[id] = entry;
  entry.status = "running";
  for (
    let attempt = entry.attempts.length + 1;
    attempt <= voiceEvalControls.maximumAttemptsPerCase;
  ) {
    if (stop) return;
    let record: AttemptRecord | undefined;
    for (let rate = 0; rate <= voiceEvalControls.rateLimitRetries; rate += 1) {
      record = await runAttempt(built, candidate, attempt, key, guarded(candidate));
      if (record.outcome !== "provider_http_429") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 15000 * (rate + 1)));
    }
    assert.ok(record);
    entry.attempts.push(record);
    await persist();
    const budget = ["hard_budget_before_dispatch", "stop_requested"].includes(record.outcome);
    if (budget) {
      stop = record.outcome;
      return;
    }
    // A valid answer ends the case; an unknown outcome is never repeated.
    if (record.outcome === "valid" || record.uncertain) break;
    attempt += 1;
  }
  entry.status = "done";
  await persist();
}
const queue = [...pending];
await Promise.all(
  Array.from({ length: voiceEvalControls.concurrency }, async () => {
    for (let next = queue.shift(); next && !stop; next = queue.shift())
      await runPair(next.built, next.candidate);
  }),
);
if (stop) {
  state.stopped = true;
  state.stopReason = stop;
}
await persist();
await writes;
process.stdout.write(
  `${JSON.stringify(
    {
      freeze,
      spentUsd: Number(state.spentUsd.toFixed(7)),
      uncertainUsd: Number(state.uncertainUsd.toFixed(7)),
      pairsDone: Object.values(state.pairs).filter((pair) => pair.status === "done").length,
      stopped: state.stopped,
      stopReason: state.stopReason,
    },
    null,
    2,
  )}\n`,
);
