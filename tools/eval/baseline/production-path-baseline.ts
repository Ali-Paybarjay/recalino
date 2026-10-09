import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { getAccountState, listTeachingPreferences } from "../../../packages/core/src/acc";
import { OpenRouterProvider, providerSettingsSchema } from "../../../packages/core/src/aip";
import { createDatabase, type Database } from "../../../packages/core/src/db";
import { getLatestVersion } from "../../../packages/core/src/lkm";
import { getCourse, getSession } from "../../../packages/core/src/org";
import {
  canonicalJson,
  type LearnerContext,
  MemoryObjectStore,
  readPltSettings,
  sha256Hex,
} from "../../../packages/core/src/plt";
import {
  cancelRun,
  createProcessingRun,
  getProcessingRunSnapshot,
  getRun,
  processingJob,
} from "../../../packages/core/src/proc";
import { buildKnowledgeInput } from "../../../packages/core/src/proc/knowledge-input";
import { snapshotLearnerTeachingContext } from "../../../packages/core/src/proc/learner-context";
import { runFixtureProcessingStep } from "../../../packages/core/test/processing-jobs";
import {
  type BaselineCase,
  configureBaselineCostPolicy,
  createBaselineCase,
  isolatedDatabaseUrl,
} from "./baseline-db";
import {
  type BaselineTask,
  baselineFixtureSetId,
  baselineIdMap,
  baselineProductionCommit,
  baselineSchedule,
  baselineSourceFixtureSetId,
  compareSnapshotToFixture,
  expectedKnowledgeInput,
  holdout5FixturesHash,
  type KnowledgeInputCheck,
  knowledgeInputInspector,
  mapIds,
  mapIdsInText,
  workerMissingSourceIds,
} from "./baseline-fixtures";
import {
  caseOutcome,
  type DispatchRecord,
  providerAttemptsFromDispatches,
  roundSummary,
  saveJson,
  validationDossierSchema,
  writePublishedCase,
} from "./baseline-outputs";
import {
  assertLedgerDispatchAllowed,
  baselineControls,
  type DispatchBody,
  DispatchRefused,
  guardedFetch,
  roundInFlightUsd,
  zdrEndpointMaximumRates,
} from "./cost-guard";
import type { MigrationFixture } from "./haiku55-migration-fixtures";
import {
  assertMigrationLedgerAvailable,
  type MigrationLedger,
  migrationLedgerRound,
  migrationRoundStateSchema,
  readMigrationRecordedJson,
  withMigrationLedger,
} from "./ledger";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";

/*
 * Evaluation only, never discovered by Vitest: measures the deployed production worker (Haiku
 * 4.5, config/openrouter-defaults.json) on the multilingual holdout-5 lessons, end to end through
 * createProcessingRun and processingJob, against the isolated local database.
 *   dry run (default)  writes and prints the frozen plan; --setup-check also builds every lesson
 *                      in the database and checks the run inputs, without any provider request
 *   --mock-fetch       one case (--case S06-6) whose every request gets HTTP 400, at zero cost
 *   --run-live         the 14-case round; needs --approved-freeze, --env-file, --zdr-endpoint-file
 * Every mode needs --out and --zdr-endpoint-file.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sharedLedgerPath =
  "C:/Users/Ali-PC/.codex/worktrees/haiku55-migration/Recalino/artifacts/verification/haiku55-evaluation-ledger.json";
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`Missing ${name} value`);
  return value;
};
const live = process.argv.includes("--run-live");
const mockFetch = process.argv.includes("--mock-fetch");
const setupCheck = process.argv.includes("--setup-check");
assert.ok(!(live && mockFetch), "Choose --run-live or --mock-fetch, not both");
const outOption = option("--out");
assert.ok(outOption, "Pass --out <round directory>");
const directory = resolve(outOption);
const zdrPath = option("--zdr-endpoint-file");
assert.ok(zdrPath, "Pass --zdr-endpoint-file <captured OpenRouter zero-retention endpoint list>");

// ---- Frozen plan -------------------------------------------------------------------------------
const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const productionPaths = [
  "packages",
  "apps",
  "config",
  "supabase",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
];
const productionCodeChanges = (commit: string) =>
  [
    ...git(["diff", "--name-only", commit, "--", ...productionPaths]).split(/\r?\n/),
    ...git(["ls-files", "--others", "--exclude-standard", "--", ...productionPaths]).split(/\r?\n/),
  ].filter(Boolean);
const head = git(["rev-parse", "HEAD"]);
const productionCommit = git(["rev-parse", `${baselineProductionCommit}^{commit}`]);
let headDescendsFromProductionCommit = true;
try {
  git(["merge-base", "--is-ancestor", productionCommit, head]);
} catch {
  headDescendsFromProductionCommit = false;
}
const changedAtStart = productionCodeChanges(productionCommit);
const configBytes = await readFile(resolve(root, "config/openrouter-defaults.json"));
// The production Haiku 4.5 configuration of this commit, unchanged.
const settings = providerSettingsSchema.parse(JSON.parse(configBytes.toString("utf8")));
const zdrBytes = await readFile(resolve(zdrPath));
const zdrEndpoints: unknown = JSON.parse(zdrBytes.toString("utf8"));
const zdrRates = Object.fromEntries(
  [...new Set([settings.llmModel, settings.visionModel])].map((model) => [
    model,
    zdrEndpointMaximumRates(zdrEndpoints, model),
  ]),
);
const fixtures = holdout5MigrationFixtures();
const fixturesHash = sha256Hex(canonicalJson(fixtures));
assert.equal(fixturesHash, holdout5FixturesHash, "Holdout-5 lessons differ from the Gemini round");
const schedule = baselineSchedule(fixtures);
const toolDirectory = resolve(root, "tools/eval/baseline");
const toolHashes = await Promise.all(
  (await readdir(toolDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map(async (path) => ({
      path: relative(root, path).replaceAll("\\", "/"),
      sha256: sha256Hex(await readFile(path)),
    })),
);
const plan = {
  version: baselineControls.version,
  syntheticOnly: true,
  actualProductionPipeline: true,
  fixtureSet: baselineFixtureSetId,
  sourceFixtureSet: baselineSourceFixtureSetId,
  expectedCases: schedule.length,
  nodeVersion: process.version,
  expectedKeysNeverSent: true,
  model: settings.llmModel,
  productionCommit,
  head,
  headDescendsFromProductionCommit,
  productionCodeUnchanged: changedAtStart.length === 0,
  productionCodeChanges: changedAtStart,
  configPath: "config/openrouter-defaults.json",
  configHash: sha256Hex(configBytes),
  settings,
  pltSettings: readPltSettings(),
  fixturesHash,
  zdrEndpointHash: sha256Hex(zdrBytes),
  zdrEndpointMaximumRates: zdrRates,
  toolHashes,
  controls: baselineControls,
  pipeline: {
    entry: "createProcessingRun + processingJob driven by runFixtureProcessingStep",
    sources:
      "production upload APIs into a memory object store: text and PDF verified by DefaultSourceVerifier, class audio declared on the device; then the fixture units and blocks appended as a machine-extraction content version",
    voiceAnalysis:
      "production wiring; a fresh learner has no voice enrollment and no original audio exists",
    learner: "fresh synthetic learner and class per case; profile gives the fixture context",
  },
  schedule: schedule.map(({ caseId, fixture, repeat }) => ({
    caseId,
    fixtureId: fixture.id,
    repeat,
  })),
};
const freeze = sha256Hex(canonicalJson(plan));
const statePath = resolve(directory, "state.json");
const priorState = await readMigrationRecordedJson(statePath);
if (priorState !== undefined)
  assert.equal(
    migrationRoundStateSchema.parse(priorState).freeze,
    freeze,
    "Preserve an earlier round; choose a fresh output directory",
  );
await saveJson(resolve(directory, "dry-run-plan.json"), { ...plan, freeze, paidCalls: 0 });
await saveJson(resolve(directory, "fixtures-and-ground-truth.json"), {
  syntheticOnly: true,
  cases: fixtures,
});

// ---- Database helpers --------------------------------------------------------------------------
/**
 * The run's frozen source snapshot and the learner context it was created with, and the input the
 * worker assembles from them, against the fixture. Read only through production APIs: the
 * snapshot as stored on the run, the profile and preference createProcessingRun turns into run
 * settings, and the class date and course. The dispatched request is checked again before payment.
 */
async function verifyRunInputs(
  db: Database,
  created: BaselineCase,
  fixture: MigrationFixture,
  runId: string,
) {
  const snapshot = await getProcessingRunSnapshot(db, created.ctx, runId);
  const map = baselineIdMap(created.sources);
  const account = await getAccountState(db, created.ctx.userId);
  assert.ok(account, "baseline_account_missing");
  // The rule createProcessingRun applies when it freezes the run settings (proc/runs.ts).
  const explanationLanguage =
    account.profile.explanationLanguage === "english" ? "en" : account.profile.firstLanguage;
  const learnerContext = snapshotLearnerTeachingContext(account.profile);
  const teachingPreferences = {
    shorterExamples: (await listTeachingPreferences(db, created.ctx)).some(
      (preference) =>
        preference.key === "shorter_examples" &&
        preference.origin === "explicit" &&
        preference.value === true,
    ),
  };
  const lesson = await getSession(db, created.ctx, created.sessionId);
  const course = await getCourse(db, created.ctx, lesson.courseId);
  const lessonContext = {
    date: lesson.classDate,
    ...(course.isDefault ? {} : { course: course.name }),
  };
  // Assembled as proc/worker.ts does for sources that already hold a content version.
  const workerInput = buildKnowledgeInput(
    {
      explanationLanguage: explanationLanguage ?? "",
      teachingPreferences,
      learnerContext,
      sources: snapshot.sources,
      missingSourceIds: workerMissingSourceIds(snapshot.sources),
      lessonContext,
    },
    settings.maxInputCharacters,
  );
  const expected = expectedKnowledgeInput(fixture, settings.maxInputCharacters);
  const check = (name: string, equal: boolean) => (equal ? [] : [name]);
  const differences = [
    ...compareSnapshotToFixture(snapshot, fixture, map),
    ...check("explanation_language", explanationLanguage === fixture.explanationLanguage),
    ...check(
      "learner_context",
      canonicalJson(learnerContext) ===
        canonicalJson(
          snapshotLearnerTeachingContext({ level: fixture.declaredLevel, goal: fixture.goal }),
        ),
    ),
    ...check(
      "teaching_preferences",
      canonicalJson(teachingPreferences) === canonicalJson(fixture.teachingPreferences),
    ),
    ...check(
      "lesson_context",
      canonicalJson(lessonContext) === canonicalJson(fixture.lessonContext),
    ),
    ...check("knowledge_input", mapIdsInText(workerInput.input, map) === expected),
  ];
  return {
    matches: differences.length === 0,
    differences,
    explanationLanguage: explanationLanguage ?? "",
    learnerContext,
    roles: snapshot.sources.map((source) => source.role),
    pageCounts: snapshot.sources.map((source) => source.pageCount),
    missingSourceIds: mapIds(workerMissingSourceIds(snapshot.sources), map),
    inputFormat: workerInput.format,
    inputCharacters: Array.from(workerInput.input).length,
  };
}

// ---- Dry run -----------------------------------------------------------------------------------
if (!live && !mockFetch) {
  let setup: Record<string, unknown> | undefined;
  if (setupCheck) {
    // Creates each distinct lesson's synthetic learner, class and sources and a queued run, checks
    // the run's frozen inputs against the fixture, then cancels the run before any job executes.
    const db = createDatabase(isolatedDatabaseUrl(), { maxConnections: 4 });
    try {
      await configureBaselineCostPolicy(db);
      const provider = new OpenRouterProvider("setup-check-no-network", settings, async () => {
        throw new DispatchRefused("setup_check_never_dispatches");
      });
      const store = new MemoryObjectStore();
      const job = processingJob({ provider, store });
      const checks = [];
      for (const fixture of fixtures) {
        const created = await createBaselineCase(db, store, fixture);
        const run = await createProcessingRun(
          db,
          created.ctx,
          { sessionId: created.sessionId, operationKey: randomUUID() },
          { provider, job },
        );
        const verified = await verifyRunInputs(db, created, fixture, run.id);
        const cancelled = await cancelRun(db, created.ctx, run.id);
        checks.push({
          fixtureId: fixture.id,
          userId: created.ctx.userId,
          sessionId: created.sessionId,
          runId: run.id,
          runState: cancelled.state,
          sources: created.sources,
          ...verified,
        });
      }
      setup = {
        lessons: checks.length,
        matching: checks.filter((entry) => entry.matches).length,
        differences: checks.flatMap((entry) =>
          entry.differences.map((difference) => `${entry.fixtureId}:${difference}`),
        ),
      };
      await saveJson(resolve(directory, "setup-check.json"), { syntheticOnly: true, checks });
    } finally {
      await db.destroy();
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      dryRun: true,
      freeze,
      scheduledCases: schedule.length,
      paidCalls: 0,
      model: settings.llmModel,
      productionCommit,
      head,
      productionCodeUnchanged: plan.productionCodeUnchanged,
      fixturesHash,
      zdrEndpointHash: plan.zdrEndpointHash,
      controls: baselineControls,
      ...(setup ? { setupCheck: setup } : {}),
    })}\n`,
  );
  process.exit(setup && setup.matching !== fixtures.length ? 1 : 0);
}

// ---- Live or mock round ------------------------------------------------------------------------
const mode = live ? ("live" as const) : ("mock-fetch" as const);
let key: string;
if (live) {
  assert.equal(
    option("--approved-freeze"),
    freeze,
    "Approve this exact code/config/fixture/endpoint freeze from the dry run",
  );
  assert.ok(
    plan.productionCodeUnchanged && headDescendsFromProductionCommit,
    "Production code differs from the deployed commit; measure only the deployed code",
  );
  const envFile = option("--env-file");
  assert.ok(envFile, "Pass --env-file <existing file holding OPENROUTER_API_KEY>");
  // The key stays in memory: never logged, never written; responses are redacted before saving.
  key = parseEnv(await readFile(resolve(envFile), "utf8")).OPENROUTER_API_KEY ?? "";
  assert.ok(key.trim(), "OPENROUTER_API_KEY is missing from --env-file");
} else key = "mock-fetch-no-network";
const redact = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replaceAll(key, "[redacted]")) as T;
// A mock round keeps its own ledger, so the shared one only ever records real spend.
const ledgerPath = live
  ? resolve(option("--ledger-file") ?? sharedLedgerPath)
  : resolve(directory, "mock-ledger.json");
if (live) {
  await assertMigrationLedgerAvailable(ledgerPath, false);
  assert.equal(
    await readMigrationRecordedJson(resolve(directory, "mock-ledger.json")),
    undefined,
    "This directory holds a mock round; choose a fresh output directory",
  );
}
const caseOption = option("--case");
assert.ok(!(live && caseOption), "A live round runs the whole frozen schedule");
const tasks: BaselineTask[] = live
  ? schedule
  : schedule.filter((task) => task.caseId === (caseOption ?? schedule[0]?.caseId));
assert.equal(tasks.length, live ? 14 : 1, "Unknown --case; use a scheduled case id such as S06-6");
const state = migrationRoundStateSchema.parse(
  priorState ?? { freeze, spentUsd: 0, stopped: false, requests: [], results: [] },
);
assert.ok(!state.stopped, `Round stopped: ${state.stopReason}`);
assert.ok(
  !state.requests.some((request) => request.state === "started"),
  "An unresolved dispatch must be recovered offline, never repeated",
);
const thisRound = (ledger: MigrationLedger) => {
  const entry = ledger.rounds.find((round) => round.freeze === freeze);
  assert.ok(entry, "Ledger round disappeared");
  return entry;
};
const roundSpent = await withMigrationLedger(
  ledgerPath,
  (ledger) => migrationLedgerRound(ledger, freeze, directory, baselineFixtureSetId).spentUsd,
);
assert.equal(roundSpent, state.spentUsd, "Ledger and round state disagree; recover offline");
const persist = async () => {
  await saveJson(statePath, state);
  await withMigrationLedger(ledgerPath, (ledger) => {
    const entry = thisRound(ledger);
    entry.spentUsd = state.spentUsd;
    // A dispatch still in flight keeps its reserve counted against the shared cap.
    entry.inFlightUsd = roundInFlightUsd(state.requests);
    entry.status = state.stopped ? "stopped" : "running";
  });
};
const db = createDatabase(isolatedDatabaseUrl(), { maxConnections: 4 });
let current:
  | {
      caseId: string;
      dossier: string;
      receipts: Record<string, unknown>[];
      dispatches: DispatchRecord[];
      inspect: (dispatch: { stage: string; body: DispatchBody }) => void;
    }
  | undefined;
const store = new MemoryObjectStore();
// The mock answers every request with HTTP 400, shaped like the refusal production Haiku 4.5
// receives for its strict json_schema request, so the worker also takes its one json_object
// fallback (also refused) and the run fails fast at zero cost.
const transport: typeof fetch = live
  ? (url, init) => fetch(url, init)
  : async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Provider returned error",
            code: 400,
            metadata: {
              raw: JSON.stringify({
                type: "error",
                error: {
                  type: "invalid_request_error",
                  message:
                    "Synthetic mock: the compiled grammar is too large; nothing was sent to a provider.",
                },
              }),
            },
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
const provider = new OpenRouterProvider(
  key,
  settings,
  guardedFetch({
    zdrEndpoints,
    transport,
    state,
    caseId: () => current?.caseId ?? "none",
    reserveInLedger: (reserveUsd) =>
      withMigrationLedger(ledgerPath, (ledger) => {
        assertLedgerDispatchAllowed(ledger, reserveUsd);
        const entry = thisRound(ledger);
        entry.inFlightUsd = roundInFlightUsd(state.requests) + reserveUsd;
        entry.status = "running";
      }),
    persist,
    inspect: (dispatch) => {
      if (!current) throw new DispatchRefused("no_active_case");
      current.inspect(dispatch);
    },
    onRequest: async ({ index, caseId, stage, reserve, serialized }) => {
      const dossier = resolve(directory, "dossiers", caseId);
      const { body } = reserve;
      await saveJson(
        resolve(dossier, `request-${index + 1}.json`),
        redact({
          syntheticOnly: true,
          caseId,
          stage,
          controls: {
            model: body.model,
            maxOutputTokens: body.max_tokens,
            temperature: body.temperature,
            provider: body.provider,
            responseFormat: (body.response_format as { type?: string } | undefined)?.type,
          },
          reserveUsd: reserve.reserveUsd,
          requestBytes: reserve.requestBytes,
          promptRate: reserve.promptRate,
          outputRate: reserve.outputRate,
          requestBodyHash: sha256Hex(serialized),
        }),
      );
      await saveJson(
        resolve(dossier, `request-${index + 1}-body.json`),
        redact({ syntheticOnly: true, body: JSON.parse(serialized) }),
      );
    },
    onOutcome: async (outcome) => {
      const dossier = resolve(directory, "dossiers", outcome.caseId);
      await saveJson(
        resolve(
          dossier,
          `${outcome.stage.replaceAll(":", "-")}-${outcome.index + 1}-response.json`,
        ),
        redact({
          syntheticOnly: true,
          outcome: outcome.outcome,
          status: outcome.status ?? null,
          ...(outcome.errorName ? { errorName: outcome.errorName } : {}),
          body: outcome.body ?? null,
        }),
      );
      if (current?.caseId === outcome.caseId) {
        current.dispatches.push({
          operationKey: outcome.operationKey,
          status: outcome.status ?? null,
          outcome: outcome.outcome,
        });
        current.receipts.push(redact(outcome.receipt));
        await saveJson(resolve(dossier, "receipts.json"), current.receipts);
      }
    },
    onRefused: (refusal) => {
      if (current?.caseId === refusal.caseId)
        current.dispatches.push({
          operationKey: refusal.operationKey,
          status: null,
          outcome: "refused",
        });
    },
  }),
);
const job = processingJob({
  provider,
  store,
  // Production wires voice analysis. A fresh learner has no voice enrollment, so it changes
  // nothing, but it keeps production's checkpoint between knowledge generation and publication.
  diarizeVoice: async () => {
    throw new Error("original_audio_unavailable");
  },
});

async function driveRun(runId: string, ctx: LearnerContext) {
  let steps = 0;
  let stepLimitReached = false;
  let stalled = false;
  let waitedMs = 0;
  for (;;) {
    const run = await getRun(db, ctx, runId);
    if (!["queued", "processing"].includes(run.state)) break;
    if (steps >= baselineControls.maximumJobStepsPerCase) {
      stepLimitReached = true;
      break;
    }
    if (await runFixtureProcessingStep(db, job, { runId, userId: ctx.userId })) {
      steps += 1;
      continue;
    }
    // Not due: the worker's own job policy scheduled a later retry; wait for it, boundedly.
    if (waitedMs >= baselineControls.maximumRetryWaitMs) {
      stalled = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 5000));
    waitedMs += 5000;
  }
  return { jobSteps: steps, stepLimitReached, stalled, retryWaitMs: waitedMs };
}

async function runCase(task: BaselineTask): Promise<Record<string, unknown>> {
  const dossier = resolve(directory, "dossiers", task.caseId);
  await mkdir(dossier, { recursive: true });
  const started = Date.now();
  await configureBaselineCostPolicy(db);
  const created = await createBaselineCase(db, store, task.fixture);
  const map = baselineIdMap(created.sources);
  const inputChecks: KnowledgeInputCheck[] = [];
  const active = {
    caseId: task.caseId,
    dossier,
    receipts: [] as Record<string, unknown>[],
    dispatches: [] as DispatchRecord[],
    inspect: knowledgeInputInspector({
      expected: expectedKnowledgeInput(task.fixture, settings.maxInputCharacters),
      map: () => map,
      record: (check) => inputChecks.push(check),
    }),
  };
  current = active;
  await saveJson(resolve(dossier, "source-id-map.json"), {
    syntheticOnly: true,
    userId: created.ctx.userId,
    sessionId: created.sessionId,
    sources: created.sources,
  });
  const run = await createProcessingRun(
    db,
    created.ctx,
    { sessionId: created.sessionId, operationKey: randomUUID() },
    { provider, job },
  );
  const inputCheck = await verifyRunInputs(db, created, task.fixture, run.id);
  await saveJson(resolve(dossier, "run-input-check.json"), { runId: run.id, ...inputCheck });
  let drive = { jobSteps: 0, stepLimitReached: false, stalled: false, retryWaitMs: 0 };
  let toolError: string | undefined;
  try {
    if (inputCheck.matches) drive = await driveRun(run.id, created.ctx);
    else {
      // Never pay to measure a lesson the worker would not see exactly as the fixture.
      await cancelRun(db, created.ctx, run.id);
      state.stopped = true;
      state.stopReason = "fixture_setup_mismatch";
    }
  } catch (error) {
    // Recorded with the case, never retried: a paid dispatch keeps its result.
    toolError = error instanceof Error ? error.message : "evaluation_failure";
  }
  const final = await getRun(db, created.ctx, run.id);
  const attempts = providerAttemptsFromDispatches(active.dispatches);
  const requests = state.requests.filter((request) => request.caseId === task.caseId);
  const outcome = caseOutcome(
    { state: final.state, lastError: final.lastError, outputVersionId: final.outputVersionId },
    attempts,
    // Knowledge-family responses that carried a generation; rejections generated nothing.
    requests.filter(
      (request) => request.stage.startsWith("knowledge") && request.state === "completed",
    ).length,
  );
  let published = false;
  let outputError: string | undefined;
  if (outcome.finalLocalPass) {
    try {
      const version = await getLatestVersion(db, created.ctx, created.sessionId);
      assert.ok(version, "published_version_missing");
      assert.equal(version.id, final.outputVersionId, "published_version_is_not_run_output");
      await writePublishedCase(dossier, {
        publishedModel: version.model,
        // Renamed to the fixture identifiers the answer key and the Gemini outputs use.
        finalModel: mapIds(version.model, map),
        explanationLanguage: inputCheck.explanationLanguage,
      });
      published = true;
    } catch (error) {
      outputError = error instanceof Error ? error.message : "output_write_failed";
    }
  }
  const result = validationDossierSchema.parse({
    caseId: task.caseId,
    fixtureId: task.fixture.id,
    repeat: task.repeat,
    ...outcome,
    finalLocalPass: outcome.finalLocalPass && published,
    firstGenerationPass: outcome.firstGenerationPass && published,
    runId: run.id,
    attempts,
    httpRequests: requests.length,
    knowledgeHttpRequests: requests.filter((request) => request.stage.startsWith("knowledge"))
      .length,
    knowledgeInputChecks: inputChecks,
    knowledgeInputMatchesFixture:
      inputChecks.length > 0 && inputChecks.every((check) => check.semanticMatch),
    runInputMatchesFixture: inputCheck.matches,
    runInputDifferences: inputCheck.differences,
    ...drive,
    ...(toolError ? { toolError } : {}),
    ...(outputError ? { outputError } : {}),
    ...(state.stopped ? { roundStopReason: state.stopReason } : {}),
    costFallbacks: active.receipts.filter((receipt) => receipt.costFallback === true).length,
    usdCost: requests.reduce((total, request) => total + (request.costUsd ?? 0), 0),
    durationMs: Date.now() - started,
  });
  current = undefined;
  return result;
}

const stopRequested = () =>
  readFile(resolve(directory, "STOP_REQUESTED"), "utf8")
    .then(() => true)
    .catch(() => false);
try {
  for (const task of tasks) {
    if (state.results.some((result) => result.caseId === task.caseId)) continue;
    assert.ok(
      !state.requests.some((request) => request.caseId === task.caseId),
      "A dispatched case without a result requires offline recovery, never a repeat",
    );
    if (state.stopped || (await stopRequested())) {
      state.stopped = true;
      state.stopReason ??= "operator_requested";
      await persist();
      break;
    }
    const result = await runCase(task);
    state.results.push(result);
    await persist();
    await saveJson(resolve(directory, "dossiers", task.caseId, "validation-dossier.json"), result);
    process.stdout.write(
      `${JSON.stringify({
        caseId: result.caseId,
        runState: result.runState,
        lastError: result.lastError,
        finalLocalPass: result.finalLocalPass,
        firstGenerationPass: result.firstGenerationPass,
        knowledgeInputMatchesFixture: result.knowledgeInputMatchesFixture,
        httpRequests: result.httpRequests,
        usdCost: result.usdCost,
        spentUsd: state.spentUsd,
      })}\n`,
    );
    if (state.stopped) break;
  }
} finally {
  await db.destroy();
}
const changedAtEnd = productionCodeChanges(productionCommit);
const completed = tasks.every((task) =>
  state.results.some((result) => result.caseId === task.caseId),
);
const cumulativeEvaluationUsd = await withMigrationLedger(ledgerPath, (ledger) => {
  const entry = thisRound(ledger);
  entry.inFlightUsd = roundInFlightUsd(state.requests);
  entry.status = state.stopped ? "stopped" : completed ? "completed" : "running";
  return (
    ledger.priorUnledgeredUsd + ledger.rounds.reduce((total, round) => total + round.spentUsd, 0)
  );
});
const summary = {
  ...roundSummary({
    freeze,
    model: settings.llmModel,
    mode,
    state,
    expectedCases: tasks.length,
    cumulativeEvaluationUsd,
  }),
  productionCommit,
  productionCodeChangedDuringRound: canonicalJson(changedAtEnd) !== canonicalJson(changedAtStart),
  ledgerPath,
};
await saveJson(resolve(directory, "summary.json"), summary);
const mockWiringProven =
  mode === "mock-fetch" &&
  completed &&
  state.results.every(
    (result) =>
      result.runState === "failed" &&
      result.lastError === "provider_request_schema_too_complex" &&
      result.httpRequests === 2 &&
      canonicalJson(result.knowledgeInputChecks) ===
        canonicalJson(
          ["knowledge", "knowledge:json"].map((stage) => ({
            stage,
            semanticMatch: true,
            stringIdentical: true,
          })),
        ) &&
      result.runInputMatchesFixture === true &&
      result.usdCost === 0,
  );
process.stdout.write(
  `${JSON.stringify({
    mode,
    freeze,
    completedCases: summary.completedCases,
    expectedCases: summary.expectedCases,
    finalLocalPasses: summary.finalLocalPasses,
    firstGenerationPasses: summary.firstGenerationPasses,
    spentUsd: state.spentUsd,
    httpRequests: state.requests.length,
    paidCalls: live
      ? state.requests.filter((request) => request.state !== "known_rejection").length
      : 0,
    stopped: state.stopped,
    stopReason: state.stopReason,
    ...(mode === "mock-fetch" ? { mockWiringProven } : {}),
  })}\n`,
);
if (mode === "mock-fetch") process.exitCode = mockWiringProven ? 0 : 1;
else if (state.stopped || !completed || summary.productionCodeChangedDuringRound)
  process.exitCode = 1;
