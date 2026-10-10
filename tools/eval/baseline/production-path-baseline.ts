import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { getAccountState, listTeachingPreferences } from "../../../packages/core/src/acc";
import {
  type AiProvider,
  effectiveProviderTimeoutMs,
  effectiveStructuredMaxOutputTokens,
  effectiveVoiceCorrectionModel,
  OpenRouterProvider,
  providerSettingsSchema,
} from "../../../packages/core/src/aip";
import { createDatabase, type Database } from "../../../packages/core/src/db";
import { getLatestVersion } from "../../../packages/core/src/lkm";
import { getCourse, getSession } from "../../../packages/core/src/org";
import {
  canonicalJson,
  type JobDefinition,
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
import { runSettingsSchema } from "../../../packages/core/src/proc/contracts";
import { usesContentKnowledgeContract } from "../../../packages/core/src/proc/knowledge-contract";
import { buildKnowledgeGenerationInput } from "../../../packages/core/src/proc/knowledge-generation";
import {
  modelTeachingContext,
  selectPracticeFocus,
  snapshotLearnerTeachingContext,
} from "../../../packages/core/src/proc/learner-context";
import { ownedRun } from "../../../packages/core/src/proc/runs";
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
  baselineSchedule,
  baselineSourceFixtureSetId,
  compareSnapshotToFixture,
  contentKnowledgeInputDifferences,
  evaluationToolPath,
  expectedKnowledgeInput,
  holdout5FixturesHash,
  type KnowledgeInputCheck,
  knowledgeInputInspector,
  mapIds,
  mapIdsInText,
  releaseBranch,
  releaseCandidateCommit,
  workerMissingSourceIds,
} from "./baseline-fixtures";
import {
  caseOutcome,
  contentKnowledgeDispatch,
  contentKnowledgeSteps,
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
  zeroCostAccountingRule,
} from "./cost-guard";
import type { MigrationFixture } from "./haiku55-migration-fixtures";
import {
  assertMigrationLedgerAvailable,
  type MigrationLedger,
  migrationLedgerRound,
  migrationLedgerSchema,
  migrationRoundStateSchema,
  readMigrationRecordedJson,
  withMigrationLedger,
} from "./ledger";
import {
  grammarRejectionResponse,
  providerDeadline,
  syntheticLessonResponse,
} from "./mock-provider";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";
import { acquireRoundLock, assertRoundUnlocked } from "./round-lock";

/*
 * Evaluation only, never discovered by Vitest: measures the Gemini release candidate (the merge
 * base of this branch with codex/gemini-release, config/openrouter-defaults.json unchanged) on
 * the multilingual holdout-5 lessons, end to end through createProcessingRun and processingJob,
 * against the isolated local database.
 *   dry run (default)  writes and prints the frozen plan; --setup-check also builds every lesson
 *                      in the database and checks the run inputs, without any provider request
 *   --mock-fetch       two cases without any network request: --success-case (default S12-12)
 *                      gets a code-written, schema-valid content-contract lesson (usage.cost 0);
 *                      --failure-case (default S06-6) gets the HTTP 400 grammar refusal on its
 *                      strict json_schema request and the provider deadline on its json_object
 *                      fallback. Its own mock ledger accounts both of those reserves.
 *   --run-live         the 14-case round; needs --approved-freeze, --env-file, --zdr-endpoint-file
 * Every mode needs --out and --zdr-endpoint-file. A live round records only in the shared ledger
 * named in the plan; a mock round keeps its own ledger in --out. One process per --out directory.
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
// The frozen plan names the one ledger a live round may record in; no option may replace it.
assert.ok(
  !process.argv.includes("--ledger-file"),
  "--ledger-file is not accepted: a live round records only in the shared evaluation ledger",
);
assert.ok(
  !process.argv.includes("--case"),
  "--case is not accepted: a mock round names --success-case and --failure-case",
);
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
const head = git(["rev-parse", "HEAD"]);
const candidateCommit = git(["rev-parse", `${releaseCandidateCommit}^{commit}`]);
const releaseBranchHead = git(["rev-parse", `${releaseBranch}^{commit}`]);
// The code under test is this branch's merge base with the release branch.
const mergeBase = git(["merge-base", "HEAD", releaseBranch]);
/** Every tracked or untracked (not ignored) path that differs from the candidate, except the tool. */
const changesOutsideTool = () =>
  [
    ...git([
      "diff",
      "--name-only",
      candidateCommit,
      "--",
      ".",
      `:(exclude)${evaluationToolPath}`,
    ]).split(/\r?\n/),
    ...git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ".",
      `:(exclude)${evaluationToolPath}`,
    ]).split(/\r?\n/),
  ].filter(Boolean);
const changedAtStart = changesOutsideTool();
const configBytes = await readFile(resolve(root, "config/openrouter-defaults.json"));
// The release candidate's configuration, unchanged.
const settings = providerSettingsSchema.parse(JSON.parse(configBytes.toString("utf8")));
assert.ok(
  usesContentKnowledgeContract(settings),
  "This round measures the content knowledge contract; the configuration selects another",
);
const voiceCorrectionModel = effectiveVoiceCorrectionModel(settings);
/** Every chat model the worker may call, and its configured output-token cap. */
const modelOutputTokens = Object.fromEntries(
  [...new Set([settings.llmModel, settings.visionModel, voiceCorrectionModel])].map((model) => [
    model,
    effectiveStructuredMaxOutputTokens(settings, model),
  ]),
);
const zdrBytes = await readFile(resolve(zdrPath));
const zdrEndpoints: unknown = JSON.parse(zdrBytes.toString("utf8"));
const zdrRates = Object.fromEntries(
  Object.keys(modelOutputTokens).map((model) => [
    model,
    zdrEndpointMaximumRates(zdrEndpoints, model),
  ]),
);
const knowledgeControls = settings.structuredModelOverrides?.[settings.llmModel];
// D49 release switch: production sends memory to generation only when it is on.
const teachingMemoryFile = "apps/web/src/server/teaching-memory.ts";
const teachingMemorySwitch = /^export const TEACHING_MEMORY_IN_GENERATION = (true|false);$/m.exec(
  await readFile(resolve(root, teachingMemoryFile), "utf8"),
);
assert.ok(teachingMemorySwitch, `${teachingMemoryFile} no longer declares the D49 switch`);
const teachingMemoryInGeneration = teachingMemorySwitch[1] === "true";
const fixtures = holdout5MigrationFixtures();
const fixturesHash = sha256Hex(canonicalJson(fixtures));
assert.equal(fixturesHash, holdout5FixturesHash, "Holdout-5 lessons differ from the Gemini round");
const schedule = baselineSchedule(fixtures);
const toolDirectory = resolve(root, evaluationToolPath);
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
  releaseCandidate: {
    branch: releaseBranch,
    commit: candidateCommit,
    mergeBase,
    mergeBaseIsCandidate: mergeBase === candidateCommit,
    releaseBranchHead,
    releaseBranchAtCandidate: releaseBranchHead === candidateCommit,
    head,
    toolPath: evaluationToolPath,
    codeUnchangedOutsideTool: changedAtStart.length === 0,
    changesOutsideTool: changedAtStart,
  },
  configPath: "config/openrouter-defaults.json",
  configHash: sha256Hex(configBytes),
  settings,
  releaseConfiguration: {
    llmModel: settings.llmModel,
    knowledgeContract: "content",
    structuredOutputMode: knowledgeControls?.structuredOutputMode ?? "json_schema",
    reasoningEffort: knowledgeControls?.reasoningEffort ?? null,
    maxOutputTokens: effectiveStructuredMaxOutputTokens(settings, settings.llmModel),
    timeoutMs: effectiveProviderTimeoutMs(settings, settings.llmModel),
    visionModel: settings.visionModel,
    voiceCorrectionModel,
  },
  pltSettings: readPltSettings(),
  fixturesHash,
  zdrEndpointHash: sha256Hex(zdrBytes),
  zdrEndpointMaximumRates: zdrRates,
  modelOutputTokens,
  toolHashes,
  controls: baselineControls,
  sharedLedgerPath,
  costAccounting: {
    reserve:
      "request body bytes x highest ZDR prompt rate + max(body max_tokens, configured output cap) x highest ZDR completion/reasoning rate, of the request's own model",
    reported: "usage.cost of the response",
    zeroCost: zeroCostAccountingRule,
    unknownOutcome: "full reserve, a provider deadline included; never repeated by this tool",
  },
  pipeline: {
    entry:
      "createProcessingRun with production's run options + processingJob driven by runFixtureProcessingStep",
    sources:
      "production upload APIs into a memory object store: text and PDF verified by DefaultSourceVerifier, class audio declared on the device; then the fixture units and blocks appended as a machine-extraction content version",
    knowledgeInput:
      "content contract (knowledge_generation_keys_v5); every lesson-input dispatch must equal the fixture's sources, roles, blocks, missing material, explanation language, learner context and lesson context",
    voiceAnalysis:
      "production wiring; a fresh learner has no voice enrollment and no original audio exists",
    learner: {
      setup:
        "fresh synthetic learner, course and class per case through production APIs; profile gives the fixture context",
      teachingMemoryInGeneration,
      teachingMemorySource: teachingMemoryFile,
      practiceCandidates: "none: a new pilot learner has no practice history",
    },
  },
  schedule: schedule.map(({ caseId, fixture, repeat }) => ({
    caseId,
    fixtureId: fixture.id,
    repeat,
  })),
};
const freeze = sha256Hex(canonicalJson(plan));
const statePath = resolve(directory, "state.json");
// One process per round directory, held before state.json is read and released on exit.
if (live || mockFetch) {
  const roundLock = await acquireRoundLock(directory, {
    pid: process.pid,
    mode: live ? "live" : "mock-fetch",
    freeze,
    startedAt: new Date().toISOString(),
  });
  process.once("exit", () => roundLock.release());
} else assertRoundUnlocked(directory);
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
 * A class run exactly as the production routes create it (apps/web/src/server/processing-routes.ts):
 * the D49 switch as released and the practice points read before the run, which for a new
 * pilot learner are none.
 */
function createBaselineRun(
  db: Database,
  created: BaselineCase,
  dependencies: { provider: AiProvider; job: JobDefinition<{ runId: string; userId: string }> },
) {
  return createProcessingRun(
    db,
    created.ctx,
    { sessionId: created.sessionId, operationKey: randomUUID() },
    {
      ...dependencies,
      teachingMemory: teachingMemoryInGeneration,
      practiceCandidates: async () => [],
    },
  );
}

/**
 * The run's frozen source snapshot and settings, and the content-contract input the worker
 * assembles from them, against the fixture. Read only through production APIs: the snapshot and
 * settings as stored on the run, the profile and preferences createProcessingRun turns into run
 * settings, and the class date and course. The dispatched request is checked again before payment.
 */
async function verifyRunInputs(
  db: Database,
  created: BaselineCase,
  fixture: MigrationFixture,
  runId: string,
) {
  const snapshot = await getProcessingRunSnapshot(db, created.ctx, runId);
  const frozen = runSettingsSchema.parse((await ownedRun(db, created.ctx, runId)).settings);
  const map = baselineIdMap(created.sources);
  const account = await getAccountState(db, created.ctx.userId);
  assert.ok(account, "baseline_account_missing");
  const preferences = await listTeachingPreferences(db, created.ctx);
  const explicit = (key: (typeof preferences)[number]["key"]) =>
    preferences.some(
      (preference) =>
        preference.key === key && preference.origin === "explicit" && preference.value === true,
    );
  // The rules createProcessingRun applies when it freezes the run settings (proc/runs.ts).
  const derived = {
    explanationLanguage:
      account.profile.explanationLanguage === "english" ? "en" : account.profile.firstLanguage,
    learnerContext: snapshotLearnerTeachingContext(account.profile, {
      simplerExplanations: teachingMemoryInGeneration && explicit("simpler_explanations"),
      practiceCandidates: [],
    }),
    teachingPreferences: { shorterExamples: explicit("shorter_examples") },
  };
  const lesson = await getSession(db, created.ctx, created.sessionId);
  const course = await getCourse(db, created.ctx, lesson.courseId);
  const lessonContext = {
    date: lesson.classDate,
    ...(course.isDefault ? {} : { course: course.name }),
  };
  // Assembled as proc/worker.ts does for sources that already hold a content version.
  const practiceFocus = selectPracticeFocus(frozen.learnerContext, snapshot.sources);
  const teaching = modelTeachingContext(frozen.learnerContext, practiceFocus);
  const workerInput = buildKnowledgeGenerationInput(
    {
      explanationLanguage: frozen.explanationLanguage,
      teachingPreferences: frozen.teachingPreferences,
      ...(teaching ? { learnerContext: teaching } : {}),
      sources: snapshot.sources,
      missingSourceIds: workerMissingSourceIds(snapshot.sources),
      lessonContext,
    },
    frozen.provider.maxInputCharacters,
    { maxOutputTokens: frozen.provider.maxOutputTokens },
  ).input;
  const sent = mapIdsInText(workerInput, map);
  const expected = expectedKnowledgeInput(
    fixture,
    settings.maxInputCharacters,
    settings.maxOutputTokens,
  );
  const check = (name: string, equal: boolean) => (equal ? [] : [name]);
  const differences = [
    ...compareSnapshotToFixture(snapshot, fixture, map),
    ...check("run_provider_settings", canonicalJson(frozen.provider) === canonicalJson(settings)),
    ...check(
      "run_settings_rule",
      canonicalJson(derived) ===
        canonicalJson({
          explanationLanguage: frozen.explanationLanguage,
          learnerContext: frozen.learnerContext,
          teachingPreferences: frozen.teachingPreferences,
        }),
    ),
    ...check("explanation_language", frozen.explanationLanguage === fixture.explanationLanguage),
    ...check(
      "learner_context",
      canonicalJson(frozen.learnerContext ?? null) ===
        canonicalJson(
          snapshotLearnerTeachingContext({ level: fixture.declaredLevel, goal: fixture.goal }),
        ),
    ),
    ...check("practice_focus", practiceFocus.length === 0),
    ...check(
      "teaching_preferences",
      canonicalJson(frozen.teachingPreferences) === canonicalJson(fixture.teachingPreferences),
    ),
    ...check(
      "lesson_context",
      canonicalJson(lessonContext) === canonicalJson(fixture.lessonContext),
    ),
    ...contentKnowledgeInputDifferences(sent, expected).map(
      (difference) => `knowledge_input_${difference}`,
    ),
  ];
  return {
    matches: differences.length === 0,
    differences,
    explanationLanguage: frozen.explanationLanguage,
    learnerContext: frozen.learnerContext ?? null,
    modelLearnerContext: teaching ?? null,
    roles: snapshot.sources.map((source) => source.role),
    pageCounts: snapshot.sources.map((source) => source.pageCount),
    missingSourceIds: mapIds(workerMissingSourceIds(snapshot.sources), map),
    lessonContext,
    inputFormat: "knowledge_generation_keys_v5",
    inputStringIdentical: sent === expected,
    inputCharacters: Array.from(workerInput).length,
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
        const run = await createBaselineRun(db, created, { provider, job });
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
        inputStringIdentical: checks.filter((entry) => entry.inputStringIdentical).length,
        cancelled: checks.filter((entry) => entry.runState === "cancelled").length,
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
      releaseCandidate: plan.releaseCandidate,
      releaseConfiguration: plan.releaseConfiguration,
      fixturesHash,
      zdrEndpointHash: plan.zdrEndpointHash,
      zdrEndpointMaximumRates: zdrRates,
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
    plan.releaseCandidate.mergeBaseIsCandidate && plan.releaseCandidate.codeUnchangedOutsideTool,
    "Code outside the evaluation tool differs from the release candidate; measure only the candidate",
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
const ledgerPath = live ? resolve(sharedLedgerPath) : resolve(directory, "mock-ledger.json");
if (live) {
  await assertMigrationLedgerAvailable(ledgerPath, false);
  assert.equal(
    await readMigrationRecordedJson(resolve(directory, "mock-ledger.json")),
    undefined,
    "This directory holds a mock round; choose a fresh output directory",
  );
}
const successCase = option("--success-case") ?? "S12-12";
const failureCase = option("--failure-case") ?? "S06-6";
assert.ok(
  !(live && (process.argv.includes("--success-case") || process.argv.includes("--failure-case"))),
  "A live round runs the whole frozen schedule",
);
const tasks: BaselineTask[] = live
  ? schedule
  : schedule.filter((task) => task.caseId === successCase || task.caseId === failureCase);
assert.equal(
  tasks.length,
  live ? 14 : 2,
  "Name two different scheduled cases, such as --success-case S12-12 --failure-case S06-6",
);
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
// No mock answer reaches the network: the success case gets a code-written lesson, the failure
// case the grammar refusal on its strict request and the provider deadline on its fallback.
let mockResponses = 0;
const transport: typeof fetch = live
  ? (url, init) => fetch(url, init)
  : async (_url, init) => {
      mockResponses += 1;
      const serialized = typeof init?.body === "string" ? init.body : "";
      if (current?.caseId === successCase)
        return syntheticLessonResponse(serialized, mockResponses);
      const format = (JSON.parse(serialized) as { response_format?: { type?: string } })
        .response_format?.type;
      if (format === "json_schema") return grammarRejectionResponse();
      return providerDeadline();
    };
const provider = new OpenRouterProvider(
  key,
  settings,
  guardedFetch({
    zdrEndpoints,
    transport,
    state,
    models: modelOutputTokens,
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
            reasoning: body.reasoning,
            provider: body.provider,
            responseFormat: (body.response_format as { type?: string } | undefined)?.type,
          },
          reserveOutputTokens: reserve.reserveOutputTokens,
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
      expected: expectedKnowledgeInput(
        task.fixture,
        settings.maxInputCharacters,
        settings.maxOutputTokens,
      ),
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
  // A case that dispatched nothing still has its (empty) receipts.
  await saveJson(resolve(dossier, "receipts.json"), active.receipts);
  const run = await createBaselineRun(db, created, { provider, job });
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
  // Content-contract knowledge dispatches: knowledge, knowledge:compact, knowledge:repair and
  // knowledge:study-repair, a json_object fallback joining its step.
  const knowledgeRequests = requests.filter((request) => contentKnowledgeDispatch(request.stage));
  const outcome = caseOutcome(
    { state: final.state, lastError: final.lastError, outputVersionId: final.outputVersionId },
    attempts,
    // Knowledge responses that carried a generation; rejections and unknowns generated nothing.
    knowledgeRequests.filter((request) => request.state === "completed").length,
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
    knowledgeHttpRequests: knowledgeRequests.length,
    knowledgeSteps: contentKnowledgeSteps,
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
    timeouts: active.receipts.filter((receipt) => receipt.timedOut === true).length,
    uncertainOutcomes: requests.filter((request) => request.state === "uncertain").length,
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
const changedAtEnd = changesOutsideTool();
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
  releaseCandidate: candidateCommit,
  releaseConfiguration: plan.releaseConfiguration,
  codeChangedOutsideToolDuringRound: canonicalJson(changedAtEnd) !== canonicalJson(changedAtStart),
  timeouts: state.results.reduce((total, result) => total + Number(result.timeouts ?? 0), 0),
  ledgerPath,
};
await saveJson(resolve(directory, "summary.json"), summary);

/**
 * The mock proves the wiring at zero cost. Success case: one strict json_schema knowledge
 * request answered by the code-written lesson, with its input equal to the fixture's, reaches
 * ready and writes the graders' files. Failure case: Gemini's strict request refused with the
 * grammar 400 counts its full reserve (the zero-cost rule is Anthropic's only), and its one
 * json_object fallback ends at the provider deadline, counts its full reserve and is never
 * repeated; the run waits for input. Nothing reaches the network, so those reserves are
 * accounted in the mock ledger only, and the shared ledger holds no round for this directory.
 */
async function mockWiring() {
  const evidence = (caseId: string) => ({
    result: state.results.find((result) => result.caseId === caseId),
    requests: state.requests.filter((request) => request.caseId === caseId),
  });
  const lessonCheck = (stage: string) => ({
    stage,
    semanticMatch: true,
    stringIdentical: true,
    differences: [],
  });
  const success = evidence(successCase);
  const graderFiles = await Promise.all(
    [
      "final-model.json",
      "notes.html",
      "cards.json",
      "validation-dossier.json",
      "receipts.json",
    ].map((name) =>
      readFile(resolve(directory, "dossiers", successCase, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  const [lesson] = success.requests;
  const successProven =
    success.result?.runState === "ready" &&
    success.result.finalLocalPass === true &&
    success.result.firstGenerationPass === true &&
    success.result.runInputMatchesFixture === true &&
    success.result.httpRequests === 1 &&
    canonicalJson(success.result.knowledgeInputChecks) ===
      canonicalJson([lessonCheck("knowledge")]) &&
    success.result.usdCost === 0 &&
    success.result.costFallbacks === 0 &&
    success.requests.length === 1 &&
    lesson?.stage === "knowledge" &&
    lesson.state === "completed" &&
    lesson.costUsd === 0 &&
    graderFiles.every(Boolean);
  const failure = evidence(failureCase);
  const [strict, fallback] = failure.requests;
  const failureProven =
    failure.result?.runState === "needs_input" &&
    failure.result.lastError === "provider_outcome_unknown" &&
    failure.result.finalLocalPass === false &&
    failure.result.runInputMatchesFixture === true &&
    failure.result.httpRequests === 2 &&
    canonicalJson(failure.result.knowledgeInputChecks) ===
      canonicalJson([lessonCheck("knowledge"), lessonCheck("knowledge:json")]) &&
    failure.requests.length === 2 &&
    strict?.stage === "knowledge" &&
    strict.state === "known_rejection" &&
    strict.costUsd === strict.reserveUsd &&
    fallback?.stage === "knowledge:json" &&
    fallback.state === "uncertain" &&
    fallback.costUsd === fallback.reserveUsd &&
    failure.result.usdCost === strict.reserveUsd + fallback.reserveUsd &&
    failure.result.costFallbacks === 2 &&
    failure.result.timeouts === 1 &&
    failure.result.uncertainOutcomes === 1;
  // Read only, never locked or written: a mock round must leave no entry in the shared ledger.
  const shared = await readMigrationRecordedJson(sharedLedgerPath);
  const sharedLedgerUntouched =
    shared === undefined ||
    !migrationLedgerSchema.parse(shared).rounds.some((round) => round.directory === directory);
  return {
    successProven,
    failureProven,
    sharedLedgerUntouched,
    proven:
      completed &&
      !state.stopped &&
      successProven &&
      failureProven &&
      sharedLedgerUntouched &&
      state.spentUsd === (strict?.reserveUsd ?? Number.NaN) + (fallback?.reserveUsd ?? Number.NaN),
  };
}
const mock = mode === "mock-fetch" ? await mockWiring() : undefined;
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
    // Requests that may have been billed: every one not settled as the zero-cost rejection.
    paidCalls: live
      ? state.requests.filter((request) => (request.costUsd ?? request.reserveUsd) > 0).length
      : 0,
    ...(mock
      ? {
          networkRequests: 0,
          paidUsd: 0,
          accountedMockUsd: state.spentUsd,
          mockResponses,
          successCase,
          failureCase,
          ...mock,
          mockWiringProven: mock.proven,
        }
      : {}),
    stopped: state.stopped,
    stopReason: state.stopReason,
  })}\n`,
);
if (mock) process.exitCode = mock.proven ? 0 : 1;
else if (state.stopped || !completed || summary.codeChangedOutsideToolDuringRound)
  process.exitCode = 1;
