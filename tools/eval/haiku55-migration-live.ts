import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { z } from "../../packages/core/node_modules/zod";
import {
  type AiProvider,
  OpenRouterProvider,
  ProviderError,
  type ProviderResult,
  providerSettingsSchema,
  type StructuredInput,
} from "../../packages/core/src/aip";
import { completeFinalClosers } from "../../packages/core/src/aip/openrouter";
import {
  type KnowledgeModel,
  modelClaims,
  normalizeGeneratedStudyModel,
  renderClassNotesHtml,
  renderStudyCard,
} from "../../packages/core/src/lkm";
import { AppError, canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import type { generatedKnowledgeSchema } from "../../packages/core/src/proc/generated-knowledge";
import { finalizeGeneratedStudyPractice } from "../../packages/core/src/proc/generated-study-practice";
import { compactKnowledgeBudget } from "../../packages/core/src/proc/knowledge-compact";
import { buildKnowledgeGenerationInput } from "../../packages/core/src/proc/knowledge-generation";
import { generateCanonicalKnowledge } from "../../packages/core/src/proc/knowledge-generation-step";
import { buildKnowledgeStudyRepairInput } from "../../packages/core/src/proc/knowledge-study-repair";
import { validateGeneratedKnowledge } from "../../packages/core/src/proc/worker";
import {
  holdoutFixtureSetId,
  holdoutMigrationFixtures,
  holdoutRepeatIds,
} from "./haiku55-holdout-fixtures";
import {
  holdout3FixtureSetId,
  holdout3MigrationFixtures,
  holdout3RepeatIds,
} from "./haiku55-holdout3-fixtures";
import {
  freshMigrationFixtures,
  type MigrationFixture,
  migrationFixtureSchema,
  migrationInputData,
} from "./haiku55-migration-fixtures";
import { migrationAutomaticGoldChecks } from "./haiku55-migration-gold";
import {
  assertMigrationCumulativeBudget,
  assertMigrationDispatchAllowed,
  MigrationControlInterruption,
  migrationAutomaticGateFailure,
  migrationControlInterruptionResult,
  migrationControls,
  migrationInitialRecovery,
  migrationLedgerRound,
  migrationRequestReserve,
  migrationRequestSchema,
  readMigrationRecordedJson,
  selectMigrationDiagnosticCases,
  withMigrationLedger,
} from "./haiku55-migration-guards";
import { assessMigrationQualityReview } from "./haiku55-migration-quality";
import {
  comparisonCandidates,
  comparisonSettings,
  zdrEndpointMaximumRates,
} from "./model-comparison-candidates";
import { comparisonFixtureSetId, comparisonFixtures } from "./model-comparison-fixtures";

// This explicit CLI is never invoked by CI/Vitest and never touches database or learner data.
const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`Missing ${name} value`);
  return value;
};
const live = process.argv.includes("--run-live");
const directory = resolve(option("--out", "artifacts/verification/haiku55-migration") ?? "");
const catalogPath = option("--catalog-file");
const endpointPath = option("--endpoint-file");
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const save = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
};
const fixtureSet = option("--fixture-set", "migration-14") ?? "migration-14";
// Each holdout set is written before any candidate runs against it and is evaluated once.
const holdoutSets: Record<
  string,
  { fixtures: () => MigrationFixture[]; repeatIds: readonly string[] }
> = {
  [holdoutFixtureSetId]: { fixtures: holdoutMigrationFixtures, repeatIds: holdoutRepeatIds },
  [holdout3FixtureSetId]: { fixtures: holdout3MigrationFixtures, repeatIds: holdout3RepeatIds },
};
const comparison = fixtureSet === comparisonFixtureSetId;
assert.ok(
  fixtureSet === "migration-14" || comparison || fixtureSet in holdoutSets,
  `Unknown fixture set; use migration-14, ${comparisonFixtureSetId} or ${Object.keys(holdoutSets).join(" or ")}`,
);
const candidateId = option("--candidate");
const candidate = candidateId === undefined ? undefined : comparisonCandidates[candidateId];
assert.equal(
  candidate !== undefined,
  comparison,
  "A comparison round names exactly one predeclared candidate; other rounds use production config",
);
const zdrEndpointPath = option("--zdr-endpoint-file");
const ledgerPath = resolve("artifacts/verification/haiku55-evaluation-ledger.json");
const qualityReviewPath = option("--quality-review-file");
if (qualityReviewPath) {
  assert.ok(!live, "Offline quality review cannot dispatch paid calls");
  const recorded = z
    .object({
      freeze: z.string(),
      completedCases: z.number(),
      expectedCases: z.number(),
      stopped: z.boolean(),
      unresolved: z.array(z.unknown()),
      results: z.array(z.record(z.string(), z.unknown())),
    })
    .parse(await json(resolve(directory, "summary.json")));
  const capturedPlan = z
    .object({ freeze: z.string(), fixturesHash: z.string(), expectedCases: z.number() })
    .parse(await json(resolve(directory, "dry-run-plan.json")));
  const captured = z
    .object({ cases: z.array(migrationFixtureSchema) })
    .parse(await json(resolve(directory, "fixtures-and-ground-truth.json")));
  // Never trust edited summaries or answer keys: tie both to the approved dry-run freeze.
  assert.equal(recorded.freeze, capturedPlan.freeze, "Summary freeze differs from the plan");
  assert.equal(
    sha256Hex(canonicalJson(captured.cases)),
    capturedPlan.fixturesHash,
    "Captured answer keys differ from the frozen plan",
  );
  assert.equal(recorded.expectedCases, capturedPlan.expectedCases);
  const count = (field: string) =>
    recorded.results.filter((result) => result[field] === true).length;
  const summary = {
    ...recorded,
    finalLocalPasses: count("finalLocalPass"),
    firstGenerationPasses: count("firstGenerationPass"),
    unexpectedTransportFallbacks: count("unexpectedTransportFallback"),
    automaticGoldChecksPassed: recorded.results.every(
      (result) => result.finalLocalPass !== true || result.automaticGoldChecksPassed === true,
    ),
  };
  const references = await Promise.all(
    summary.results.map(async (result) => {
      const caseId = z.string().parse(result.caseId);
      const fixture = captured.cases.find((entry) => entry.id === result.fixtureId);
      assert.ok(fixture, "Unknown captured fixture");
      const requiredConceptIds = z.array(z.string()).parse(fixture.expected.requiredConceptIds);
      return {
        caseId,
        requiredConceptIds,
        modelHash:
          result.finalLocalPass === true
            ? sha256Hex(
                canonicalJson(
                  await json(resolve(directory, "dossiers", caseId, "final-model.json")),
                ),
              )
            : undefined,
      };
    }),
  );
  const assessed = assessMigrationQualityReview(
    summary,
    references,
    await json(resolve(qualityReviewPath)),
  );
  await save(resolve(directory, "quality-review-summary.json"), assessed);
  process.stdout.write(`${JSON.stringify(assessed)}\n`);
  process.exit(assessed.adoptionEligible ? 0 : 1);
}
const configText = await readFile("config/openrouter-defaults.json", "utf8");
const productionSettings = providerSettingsSchema.parse(JSON.parse(configText));
// A comparison candidate changes only model, effort, physical cap and sampling.
const settings = providerSettingsSchema.parse(
  candidate && candidateId
    ? comparisonSettings(productionSettings, candidateId, candidate)
    : productionSettings,
);
const directJsonMode =
  settings.structuredModelOverrides?.[settings.llmModel]?.structuredOutputMode === "json_object";
assert.ok(
  directJsonMode,
  "Final adoption evaluation requires the intentionally configured direct JSON transport",
);
assert.ok(
  comparison || settings.llmModel === "anthropic/claude-haiku-5.5",
  "Evaluate the actual migration production config, not an injected candidate",
);
const historical = z
  .object({ cases: z.array(migrationFixtureSchema), repeatCaseIds: z.array(z.string()) })
  .parse(await json("tools/eval/haiku55-migration-regression-fixtures.json"));
const holdoutSet = holdoutSets[fixtureSet];
const holdout = holdoutSet !== undefined;
const fixtures = comparison
  ? comparisonFixtures()
  : holdout
    ? holdoutSet.fixtures()
    : [...historical.cases, ...freshMigrationFixtures()];
const repeated = (ids: readonly string[], source: typeof fixtures) =>
  ids.map((id) => {
    const entry = source.find((fixture) => fixture.id === id);
    assert.ok(entry);
    return entry;
  });
const originalSchedule = (
  comparison
    ? fixtures
    : holdout
      ? [...fixtures, ...repeated(holdoutSet.repeatIds, fixtures)]
      : [
          ...historical.cases,
          ...repeated(historical.repeatCaseIds, historical.cases),
          ...freshMigrationFixtures(),
        ]
).map((fixture, ordinal) => ({
  caseId: `${fixture.id}-${ordinal + 1}`,
  fixture,
  repeat: comparison ? false : holdout ? ordinal >= 12 : ordinal >= 8 && ordinal < 10,
}));
assert.equal(originalSchedule.length, comparison ? 20 : 14);
const diagnosticIds = option("--diagnostic-only-case-ids");
assert.ok(
  !(holdout || comparison) || diagnosticIds === undefined,
  "Holdout and comparison rounds have no diagnostic subset",
);
const { diagnosticOnly, schedule } = selectMigrationDiagnosticCases(
  originalSchedule,
  diagnosticIds,
);
const dispatchLimits = diagnosticOnly
  ? { maximumPaidResponses: 4, maximumHttpRequests: 4 }
  : undefined;
const dispatchMode = comparison ? ("comparison" as const) : ("adoption" as const);
const git = (args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const paths = git([
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "packages/core/src",
  "config/openrouter-defaults.json",
  "tools/eval/haiku55-migration-regression-fixtures.json",
])
  .split(/\r?\n/)
  .filter((path) => path && !/\.(int\.)?test\.ts$/.test(path));
for (const path of [
  "tools/eval/haiku55-migration-live.ts",
  "tools/eval/haiku55-migration-fixtures.ts",
  "tools/eval/haiku55-holdout-fixtures.ts",
  "tools/eval/haiku55-holdout3-fixtures.ts",
  "tools/eval/model-comparison-candidates.ts",
  "tools/eval/model-comparison-fixtures.ts",
  "tools/eval/haiku55-migration-gold.ts",
  "tools/eval/haiku55-migration-guards.ts",
  "tools/eval/haiku55-migration-quality.ts",
  "tools/eval/haiku55-migration-regression-fixtures.json",
  "packages/core/src/proc/knowledge-generation.ts",
  "pnpm-lock.yaml",
  "package.json",
  "packages/core/package.json",
  "tools/tsconfig.json",
])
  if (!paths.includes(path)) paths.push(path);
const pipelineHashes = await Promise.all(
  paths.sort().map(async (path) => ({ path, sha256: sha256Hex(await readFile(path)) })),
);
const preparedCases = schedule.map(({ caseId, fixture, repeat }) => {
  const data = migrationInputData(fixture);
  const prepared = buildKnowledgeGenerationInput(data, settings.maxInputCharacters, {
    maxOutputTokens: settings.maxOutputTokens,
  });
  return {
    caseId,
    fixtureId: fixture.id,
    repeat,
    inputHash: sha256Hex(prepared.input),
    schemaHash: sha256Hex(JSON.stringify(z.toJSONSchema(prepared.schema))),
    systemHash: sha256Hex(prepared.system),
    format: "production compact evidence-key generation",
    inputCharacters: Array.from(prepared.input).length,
  };
});
const catalog = catalogPath ? await json(resolve(catalogPath)) : undefined;
const zdrEndpoints = zdrEndpointPath ? await json(resolve(zdrEndpointPath)) : undefined;
assert.ok(!comparison || zdrEndpoints, "A comparison round needs the captured ZDR endpoint list");
const comparisonRates =
  comparison && zdrEndpoints ? zdrEndpointMaximumRates(zdrEndpoints, settings.llmModel) : undefined;
const endpointCatalog = endpointPath ? await json(resolve(endpointPath)) : undefined;
let primaryReference:
  | { freeze: string; completedCases: number; firstGenerationPasses: number }
  | undefined;
if (diagnosticOnly) {
  const referenceDirectory = resolve("artifacts/verification/haiku55-migration-final-acceptance");
  const priorPlan = z
    .object({
      freeze: z.string(),
      fixturesHash: z.string(),
      pipelineHashes: z.array(z.object({ path: z.string(), sha256: z.string() })),
      schedule: z.array(
        z.object({
          caseId: z.string(),
          inputHash: z.string(),
          schemaHash: z.string(),
          systemHash: z.string(),
        }),
      ),
    })
    .parse(await json(resolve(referenceDirectory, "dry-run-plan.json")));
  const primarySummary = z
    .object({
      freeze: z.string(),
      stopped: z.boolean(),
      completedCases: z.number(),
      firstGenerationPasses: z.number(),
      results: z.array(z.object({ caseId: z.string() })),
      unresolved: z.array(z.unknown()),
    })
    .parse(await json(resolve(referenceDirectory, "summary.json")));
  assert.equal(priorPlan.freeze, primarySummary.freeze);
  assert.ok(
    primarySummary.stopped && primarySummary.unresolved.length === 0,
    "Only a known stopped primary round permits these diagnostics",
  );
  assert.equal(
    priorPlan.fixturesHash,
    sha256Hex(canonicalJson(fixtures)),
    "Never adapt diagnostic sources or ground truth",
  );
  for (const hash of pipelineHashes.filter((entry) => !entry.path.startsWith("tools/eval/"))) {
    assert.equal(
      priorPlan.pipelineHashes.find((entry) => entry.path === hash.path)?.sha256,
      hash.sha256,
      `Diagnostic production code changed: ${hash.path}`,
    );
  }
  for (const task of preparedCases) {
    assert.ok(
      !primarySummary.results.some((entry) => entry.caseId === task.caseId),
      "Diagnostics never replay a completed primary case",
    );
    const prior = priorPlan.schedule.find((entry) => entry.caseId === task.caseId);
    assert.ok(prior, "Diagnostic case must retain its original fourteen-case identity");
    for (const name of ["inputHash", "schemaHash", "systemHash"] as const)
      assert.equal(prior[name], task[name], `Diagnostic generation changed: ${name}`);
  }
  primaryReference = {
    freeze: priorPlan.freeze,
    completedCases: primarySummary.completedCases,
    firstGenerationPasses: primarySummary.firstGenerationPasses,
  };
}
const plan = {
  version: migrationControls.version,
  syntheticOnly: true,
  diagnosticOnly,
  expectedCases: schedule.length,
  ...(diagnosticOnly
    ? {
        adoptionEligible: false,
        primaryReference,
        primaryAdoptionGateStillFailed: true,
        scopeControlHarnessChanged: true,
        productionTeachingSourceChanged: false,
      }
    : {}),
  date: "2026-10-08",
  fixtureSet,
  nodeVersion: process.version,
  expectedKeysNeverSent: true,
  ...(comparison
    ? {
        comparison: {
          candidateId,
          candidate,
          zdrEndpointMaximumRates: comparisonRates,
          zdrEndpointHash: sha256Hex(canonicalJson(zdrEndpoints)),
          firstPassGateStopsRound: false,
          blindReviewRequired: true,
        },
      }
    : {}),
  evaluationProvenance: comparison
    ? {
        comparisonFixtureIds: fixtures.map((fixture) => fixture.id),
        explanationLanguages: [...new Set(fixtures.map((fixture) => fixture.explanationLanguage))],
        writtenBeforeAnyCandidateRan: true,
        sameContractTransportAndValidationForEveryCandidate: true,
        everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
        humanTeacherCertificationClaimed: false,
      }
    : holdout
      ? {
          holdoutFixtureIds: fixtures.map((fixture) => fixture.id),
          holdoutRepeatIds: holdoutSet.repeatIds,
          writtenAfterFailedFourteenCaseRound: true,
          disjointFromRegressionFixturesAndPromptExamples: true,
          everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
          automaticGoldChecksGateAdoption: true,
          humanTeacherCertificationClaimed: false,
          blindModelComparisonClaimed: false,
        }
      : {
          historicalFixtureIds: historical.cases.map((fixture) => fixture.id),
          historicalRepeatIds: historical.repeatCaseIds,
          predeclaredAdditionalFixtureIds: ["M01", "M02", "M03", "M04"],
          additionalFixturesExposedInStoppedPriorRound: ["M01", "M02"],
          additionalFixturesStillUnseenAtThisFreeze: ["M03", "M04"],
          allFourteenExposedInEarlierRounds: true,
          everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
          humanTeacherCertificationClaimed: false,
          blindModelComparisonClaimed: false,
        },
  model: settings.llmModel,
  directJsonMode,
  nativeSchemaAcceptanceClaimed: false,
  transportRationale:
    "Three native schema shapes were rejected under the unchanged zero-retention routing policy. The selected direct JSON transport bypasses that compiler and retains every strict local output, evidence, study, and accounting validator.",
  settings,
  controls: { ...migrationControls, ...dispatchLimits },
  schedule: preparedCases,
  fixturesHash: sha256Hex(canonicalJson(fixtures)),
  catalogHash: catalog === undefined ? null : sha256Hex(canonicalJson(catalog)),
  endpointHash: endpointCatalog === undefined ? null : sha256Hex(canonicalJson(endpointCatalog)),
  pipelineHashes,
};
const freeze = sha256Hex(canonicalJson(plan));
const priorState = await readMigrationRecordedJson(resolve(directory, "state.json"));
if (priorState !== undefined) {
  const recorded = z.object({ freeze: z.string() }).parse(priorState);
  assert.equal(
    recorded.freeze,
    freeze,
    "Preserve an earlier live round; choose a fresh output directory",
  );
}
await save(resolve(directory, "dry-run-plan.json"), { ...plan, freeze, paidCalls: 0 });
await save(resolve(directory, "fixtures-and-ground-truth.json"), {
  syntheticOnly: true,
  cases: fixtures,
});
if (!live) {
  process.stdout.write(
    `${JSON.stringify({ dryRun: true, freeze, fixtureCount: fixtures.length, scheduledCases: schedule.length, paidCalls: 0, catalogAvailable: catalog !== undefined, diagnosticOnly, controls: { ...migrationControls, ...dispatchLimits } })}\n`,
  );
  process.exit(0);
}
assert.ok(
  comparison ? comparisonRates : catalog && endpointCatalog,
  "Live dispatch requires captured current model and regional endpoint catalogs",
);
assert.equal(
  option("--approved-freeze"),
  freeze,
  "Root must approve this exact code/config/fixture/catalog freeze",
);
const stateSchema = z.strictObject({
  freeze: z.string(),
  spentUsd: z.number().nonnegative(),
  stopped: z.boolean(),
  stopReason: z.string().optional(),
  requests: z.array(migrationRequestSchema),
  results: z.array(z.record(z.string(), z.unknown())),
});
const statePath = resolve(directory, "state.json");
const state = stateSchema.parse(
  (await readMigrationRecordedJson(statePath)) ?? {
    freeze,
    spentUsd: 0,
    stopped: false,
    requests: [],
    results: [],
  },
);
assert.equal(state.freeze, freeze, "Never resume under changed production code or test fixtures");
assert.ok(!state.stopped, `Evaluation stopped: ${state.stopReason}`);
const relativeDirectory = directory.replace(resolve("."), "").replace(/^[\\/]+/, "");
const roundSpent = await withMigrationLedger(
  ledgerPath,
  (ledger) => migrationLedgerRound(ledger, freeze, relativeDirectory, fixtureSet).spentUsd,
);
assert.equal(roundSpent, state.spentUsd, "Ledger and round state disagree; recover offline");
const thisRound = (ledger: Parameters<Parameters<typeof withMigrationLedger>[1]>[0]) => {
  const entry = ledger.rounds.find((value) => value.freeze === freeze);
  assert.ok(entry, "Ledger round disappeared");
  return entry;
};
assert.ok(
  !state.requests.some((request) => request.state === "started" || request.state === "uncertain"),
  "Unresolved dispatch must be recovered offline, never retried",
);
let credential = process.env.OPENROUTER_API_KEY;
if (!credential) {
  const envFile = option("--env-file");
  assert.ok(
    envFile,
    "Pass an existing credential file explicitly; do not copy its settings into the worktree",
  );
  credential = parseEnv(await readFile(envFile, "utf8")).OPENROUTER_API_KEY;
}
assert.ok(credential, "Existing API credential unavailable");
const key = credential;
const persist = async () => {
  await save(statePath, state);
  await withMigrationLedger(ledgerPath, (ledger) => {
    const entry = thisRound(ledger);
    entry.spentUsd = state.spentUsd;
    entry.status = state.stopped ? "stopped" : "running";
    // A dispatch that is still started keeps its reserve counted against the shared cap.
    entry.inFlightUsd = state.requests
      .filter((request) => request.state === "started")
      .reduce((total, request) => total + request.reserveUsd, 0);
  });
};
const stopRequested = () =>
  readFile(resolve(directory, "STOP_REQUESTED"), "utf8")
    .then(() => true)
    .catch(() => false);
const failure = (error: unknown) => {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof AppError) {
    const fields = error.details?.fields;
    const output =
      fields && typeof fields === "object" && "output" in fields ? fields.output : undefined;
    return Array.isArray(output) && typeof output[0] === "string" ? output[0] : error.code;
  }
  return error instanceof Error ? error.message : "evaluation_failure";
};
const semanticRepairable = new Set([
  "language_script_mismatch",
  "source_classification_invalid",
  "source_reference_invalid",
  "evidence_kind_mismatch",
  "time_reference_invalid",
  "page_reference_invalid",
  "text_reference_invalid",
  "unverified_user_action",
  "class_evidence_missing",
  "expansion_attribution_invalid",
  "teacher_attribution_invalid",
  "teacher_role_unconfirmed",
  "study_language_invalid",
  "study_approximation_missing",
  "study_approximation_unsupported",
  "study_grammar_prompt_missing",
  "study_gap_missing",
  "study_gap_hint",
  "study_gap_invalid",
  "study_sentence_mismatch",
  "study_answer_exposed",
  "study_target_unsupported",
  "study_core_limit",
  "study_mistake_item_missing",
]);
for (const task of schedule) {
  if (state.results.some((result) => result.caseId === task.caseId)) continue;
  assert.ok(
    !state.requests.some((request) => request.caseId === task.caseId),
    "A captured dispatch without final result requires offline recovery, never repeating the call",
  );
  const boundaryFailure =
    diagnosticOnly || comparison
      ? state.results.some((result) => result.unexpectedTransportFallback)
        ? "unexpected_transport_gate_failed"
        : undefined
      : migrationAutomaticGateFailure(state.results);
  if (boundaryFailure || state.stopped || (await stopRequested())) {
    state.stopped = true;
    state.stopReason ??= boundaryFailure ?? "operator_requested";
    await persist();
    break;
  }
  const dossier = resolve(directory, "dossiers", task.caseId);
  await mkdir(dossier, { recursive: true });
  const data = migrationInputData(task.fixture);
  const hasAudio = data.sources.some((source) => source.kind === "audio");
  const started = Date.now();
  let stage = "generation",
    calls = 0,
    jsonClosersCompleted = 0,
    unexpectedTransport = false,
    initialFailure: string | undefined,
    localControlInterruption: string | undefined;
  const ensureControlContinues = async () => {
    if (!state.stopped && !(await stopRequested())) return;
    state.stopped = true;
    state.stopReason ??= "operator_requested";
    localControlInterruption = state.stopReason;
    await persist();
    throw new MigrationControlInterruption(state.stopReason);
  };
  const receipts: Record<string, unknown>[] = [];
  const provider = new OpenRouterProvider(key, settings, async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    await ensureControlContinues();
    const body = z
      .object({
        model: z.string(),
        max_tokens: z.number().int().positive(),
        provider: z.unknown(),
        response_format: z.object({ type: z.string() }),
        messages: z.array(z.unknown()),
      })
      .passthrough()
      .parse(JSON.parse(String(init?.body)));
    assert.equal(body.model, settings.llmModel);
    assert.deepEqual(body.provider, {
      zdr: true,
      data_collection: "deny",
      require_parameters: true,
    });
    const overrides = settings.structuredModelOverrides?.[settings.llmModel];
    const expectsTemperature =
      settings.structuredTemperature !== undefined &&
      !overrides?.omitTemperature &&
      overrides?.reasoningEffort === undefined;
    assert.ok(
      !["top_p", "top_k"].some((name) => Object.hasOwn(body, name)) &&
        (expectsTemperature
          ? body.temperature === settings.structuredTemperature
          : !Object.hasOwn(body, "temperature")),
      "Sampling must match the candidate exactly",
    );
    assert.equal(
      body.max_tokens,
      overrides?.maxOutputTokens ?? settings.maxOutputTokens,
      "Physical token cap must come from the real production adapter",
    );
    assert.deepEqual(
      body.reasoning,
      overrides?.reasoningEffort ? { effort: overrides.reasoningEffort } : undefined,
    );
    unexpectedTransport ||= body.response_format.type !== "json_object";
    const serialized = String(init?.body);
    assert.ok(
      overrides?.maxRequestBytes &&
        Buffer.byteLength(serialized, "utf8") <= overrides.maxRequestBytes,
      "Physical request bytes must fit the actual production cap",
    );
    // Comparison reserves use the most expensive ZDR endpoint price, never a list price.
    const reserve = comparisonRates
      ? {
          reserveUsd:
            Buffer.byteLength(serialized, "utf8") * comparisonRates.promptRate +
            body.max_tokens * comparisonRates.outputRate,
          inputTokenCeiling: Buffer.byteLength(serialized, "utf8"),
          ...comparisonRates,
        }
      : migrationRequestReserve(catalog, body.model, serialized, body.max_tokens);
    try {
      assertMigrationDispatchAllowed(
        state.requests,
        state.spentUsd,
        reserve.reserveUsd,
        calls,
        dispatchLimits,
        dispatchMode,
      );
      await withMigrationLedger(ledgerPath, (ledger) => {
        assertMigrationCumulativeBudget(ledger, reserve.reserveUsd);
        thisRound(ledger).inFlightUsd = reserve.reserveUsd;
      });
    } catch (error) {
      state.stopped = true;
      state.stopReason = failure(error);
      await persist();
      throw error;
    }
    const request = {
      id: randomUUID(),
      caseId: task.caseId,
      stage,
      state: "started" as const,
      reserveUsd: reserve.reserveUsd,
    };
    const requestIndex = state.requests.push(request) - 1;
    await persist();
    await save(resolve(dossier, `request-${requestIndex + 1}.json`), {
      syntheticOnly: true,
      controls: {
        model: body.model,
        maxOutputTokens: body.max_tokens,
        maxRequestBytes: overrides?.maxRequestBytes,
        reasoning: body.reasoning,
        provider: body.provider,
        responseFormat: body.response_format.type,
      },
      ...reserve,
      requestBodyHash: sha256Hex(serialized),
    });
    await save(resolve(dossier, `request-${requestIndex + 1}-body.json`), {
      syntheticOnly: true,
      body: JSON.parse(serialized),
    });
    const began = Date.now();
    try {
      const response = await fetch(url, init);
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
      await save(
        resolve(dossier, `${stage}-${requestIndex + 1}-response.json`),
        JSON.parse(
          JSON.stringify({ syntheticOnly: true, status: response.status, body: raw }).replaceAll(
            key,
            "[redacted]",
          ),
        ),
      );
      const metadata = z
        .object({
          id: z.string().optional(),
          model: z.string().optional(),
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
            })
            .optional(),
        })
        .parse(raw);
      if (response.status >= 500) throw new Error("provider_5xx_unknown_outcome");
      if (response.ok && metadata.usage?.cost === undefined)
        throw new Error("paid_cost_receipt_missing");
      const paidOverBound =
        response.ok &&
        ((metadata.usage?.cost ?? 0) > reserve.reserveUsd ||
          (metadata.usage?.completion_tokens ?? 0) > body.max_tokens);
      const receipt = {
        caseId: task.caseId,
        stage,
        status: response.status,
        elapsedMs: Date.now() - began,
        requestId: metadata.id,
        model: metadata.model,
        finishReason: metadata.choices?.[0]?.finish_reason,
        inputTokens: metadata.usage?.prompt_tokens,
        outputTokens: metadata.usage?.completion_tokens,
        reasoningTokens: metadata.usage?.completion_tokens_details?.reasoning_tokens,
        usdCost: metadata.usage?.cost,
      };
      receipts.push(receipt);
      state.requests[requestIndex] = {
        ...request,
        state: response.ok ? "completed" : "known_rejection",
        ...(response.ok ? { costUsd: metadata.usage?.cost } : {}),
      };
      if (response.ok) state.spentUsd += metadata.usage?.cost ?? 0;
      await persist();
      await save(resolve(dossier, "receipts.json"), receipts);
      // The cost is recorded first; a receipt above the reserve or token cap stops the round.
      if (paidOverBound) throw new Error("paid_receipt_exceeds_reserve_or_token_cap");
      if (
        response.ok &&
        metadata.model !== settings.llmModel &&
        !metadata.model?.startsWith(`${settings.llmModel}-`)
      )
        throw new Error("reported_model_does_not_match_candidate");
      const content = metadata.choices?.[0]?.message?.content;
      if (response.ok && typeof content === "string") {
        let visible: unknown;
        try {
          visible = JSON.parse(content);
        } catch {
          const completed =
            metadata.choices?.[0]?.finish_reason === "stop"
              ? completeFinalClosers(content)
              : undefined;
          if (completed) jsonClosersCompleted += completed.closers;
          visible = {
            unparseableVisibleContent: content,
            ...(completed ? { finalClosersCompletable: completed.closers } : {}),
          };
        }
        await save(resolve(dossier, `${stage}-raw-visible.json`), visible);
      }
      return new Response(rawText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      // A completed paid JSON response with invalid visible content still has known accounting.
      if (
        state.requests[requestIndex]?.state !== "completed" &&
        state.requests[requestIndex]?.state !== "known_rejection"
      )
        state.requests[requestIndex] = { ...request, state: "uncertain" };
      state.stopped = true;
      state.stopReason = failure(error);
      await persist();
      throw error;
    }
  });
  const dispatch = async <T>(input: StructuredInput<T>): Promise<ProviderResult<T>> => {
    await ensureControlContinues();
    if (calls >= migrationControls.maximumGenerationsPerCase || state.stopped)
      throw new ProviderError("evaluation_generation_limit", false, false);
    calls += 1;
    return provider.structured(input);
  };
  const boundedProvider: AiProvider = {
    name: provider.name,
    mode: provider.mode,
    settings: provider.settings,
    structured: dispatch,
    transcribe: provider.transcribe.bind(provider),
    speech: provider.speech.bind(provider),
  };
  const generate = async (compact = false, repairReason?: string, repairDetail?: string) => {
    const generation = buildKnowledgeGenerationInput(data, settings.maxInputCharacters, {
      maxOutputTokens: compact
        ? compactKnowledgeBudget(settings.maxOutputTokens)
        : settings.maxOutputTokens,
      ...(compact ? { compact: true } : {}),
      ...(repairReason ? { repairReason } : {}),
      ...(repairReason && repairDetail ? { repairDetail } : {}),
    });
    return (
      await generateCanonicalKnowledge(
        boundedProvider,
        settings.llmModel,
        randomUUID(),
        generation,
        stage === "evidence-repair" ? "class_knowledge_content_repair" : "class_knowledge_content",
      )
    ).output;
  };
  let result: Record<string, unknown>;
  try {
    let generated: z.infer<typeof generatedKnowledgeSchema>;
    try {
      generated = await generate();
    } catch (error) {
      initialFailure = failure(error);
      const recovery =
        error instanceof ProviderError
          ? migrationInitialRecovery({
              code: error.code,
              uncertain: error.uncertain,
              accounted: !!error.accounting,
            })
          : undefined;
      if (!recovery) throw error;
      await save(resolve(dossier, "recovery-marker.json"), {
        syntheticOnly: true,
        evaluationMarkerWithoutDatabase: true,
        productionCheckpointStep: recovery.marker,
        reason: initialFailure,
        detail: error instanceof ProviderError ? error.diagnostic : undefined,
        accounting: error instanceof ProviderError ? error.accounting : undefined,
      });
      stage = recovery.stage;
      generated = await generate(
        recovery.compact,
        recovery.repairReason,
        error instanceof ProviderError ? error.diagnostic : undefined,
      );
    }
    await save(resolve(dossier, "canonical-generated.json"), generated);
    let validated: ReturnType<typeof validateGeneratedKnowledge>;
    try {
      validated = validateGeneratedKnowledge(
        generated,
        data.sources,
        data.missingSourceIds,
        data.explanationLanguage,
      );
    } catch (error) {
      const validationFailure = failure(error);
      initialFailure ??= validationFailure;
      if (
        calls >= migrationControls.maximumGenerationsPerCase ||
        !semanticRepairable.has(validationFailure)
      )
        throw error;
      if (validationFailure === "study_sentence_mismatch") {
        stage = "study-repair";
        const repair = buildKnowledgeStudyRepairInput(
          generated,
          settings.maxInputCharacters,
          data.learnerContext,
        );
        generated = repair.apply(
          (
            await dispatch({
              operationKey: randomUUID(),
              model: settings.llmModel,
              schema: repair.schema,
              schemaName: "class_study_sentence_repair",
              system: repair.system,
              input: repair.input,
            })
          ).output,
        );
      } else {
        stage = "evidence-repair";
        generated = await generate(false, validationFailure);
      }
      await save(resolve(dossier, "canonical-repaired.json"), generated);
      validated = validateGeneratedKnowledge(
        generated,
        data.sources,
        data.missingSourceIds,
        data.explanationLanguage,
      );
    }
    const projected = finalizeGeneratedStudyPractice(
      normalizeGeneratedStudyModel(validated.model, hasAudio, data.lessonContext),
      validated.classified,
      data.learnerContext,
    );
    await save(resolve(dossier, "final-model.json"), projected.model);
    const goldChecks = migrationAutomaticGoldChecks(
      task.fixture,
      projected.model as KnowledgeModel,
    );
    await save(resolve(dossier, "automatic-gold-checks.json"), goldChecks);
    await writeFile(resolve(dossier, "notes.html"), renderClassNotesHtml(projected.model));
    await save(
      resolve(dossier, "cards.json"),
      projected.model.learningItems.map((item) => ({
        id: item.id,
        ...renderStudyCard(item, data.explanationLanguage),
      })),
    );
    result = {
      finalLocalPass: true,
      firstGenerationPass: calls === 1,
      projection: projected.audit,
      productionItems: projected.model.learningItems.filter(
        (item) => item.study?.set === "production",
      ).length,
      recognitionItems: projected.model.learningItems.filter(
        (item) => item.study?.set === "recognition",
      ).length,
      sourcedClaims: modelClaims(projected.model).filter((claim) => claim.origin === "from_class")
        .length,
      automaticGoldChecksPassed: goldChecks.every((check) => !check.gating || check.passed),
      automaticGoldCheckFailures: goldChecks
        .filter((check) => check.gating && !check.passed)
        .map((check) => check.id),
    };
  } catch (error) {
    result = migrationControlInterruptionResult(
      localControlInterruption,
      state.requests.filter((request) => request.caseId === task.caseId),
    ) ?? { finalLocalPass: false, firstGenerationPass: false, finalFailure: failure(error) };
  }
  const finalResult = {
    caseId: task.caseId,
    fixtureId: task.fixture.id,
    repeat: task.repeat,
    directJsonMode,
    diagnosticOnly,
    ...result,
    ...(initialFailure ? { initialFailure } : {}),
    generations: receipts.filter((receipt) => receipt.status === 200).length,
    providerAttempts: calls,
    httpRequests: state.requests.filter((request) => request.caseId === task.caseId).length,
    unexpectedTransportFallback: unexpectedTransport,
    jsonClosersCompleted,
    durationMs: Date.now() - started,
    usdCost: receipts.reduce(
      (total, receipt) => total + (typeof receipt.usdCost === "number" ? receipt.usdCost : 0),
      0,
    ),
  };
  state.results.push(finalResult);
  await persist();
  await save(resolve(dossier, "validation-dossier.json"), finalResult);
  process.stdout.write(
    `${JSON.stringify({ ...finalResult, projection: undefined, spentUsd: state.spentUsd })}\n`,
  );
  const gateFailure =
    diagnosticOnly || comparison
      ? unexpectedTransport
        ? "unexpected_transport_gate_failed"
        : undefined
      : migrationAutomaticGateFailure(state.results);
  if (gateFailure && !state.stopped) {
    state.stopped = true;
    state.stopReason = gateFailure;
    await persist();
  }
  if (!comparison && state.spentUsd >= migrationControls.softUsd) {
    state.stopped = true;
    state.stopReason = "soft_budget_review_required";
    await persist();
  }
  if (state.stopped) break;
}
for (const entry of pipelineHashes)
  assert.equal(
    sha256Hex(await readFile(entry.path)),
    entry.sha256,
    `Production source changed during evaluation: ${entry.path}`,
  );
const summary = {
  freeze,
  syntheticOnly: true,
  actualProductionPipeline: true,
  completedCases: state.results.length,
  expectedCases: schedule.length,
  diagnosticOnly,
  ...(diagnosticOnly
    ? { adoptionEligible: false, primaryReference, primaryAdoptionGateStillFailed: true }
    : {}),
  spentUsd: state.spentUsd,
  directJsonMode,
  nativeSchemaAcceptanceClaimed: false,
  unexpectedTransportFallbacks: state.results.filter((result) => result.unexpectedTransportFallback)
    .length,
  finalLocalPasses: state.results.filter((result) => result.finalLocalPass).length,
  firstGenerationPasses: state.results.filter((result) => result.firstGenerationPass).length,
  automaticGoldChecksPassed: state.results.every(
    (result) => result.finalLocalPass !== true || result.automaticGoldChecksPassed === true,
  ),
  jsonClosersCompleted: state.results.reduce(
    (total, result) =>
      total + (typeof result.jsonClosersCompleted === "number" ? result.jsonClosersCompleted : 0),
    0,
  ),
  ...(comparison ? { comparisonCandidate: candidateId, comparisonModel: settings.llmModel } : {}),
  cumulativeMigrationQaUsd: await withMigrationLedger(
    ledgerPath,
    (ledger) =>
      ledger.priorUnledgeredUsd + ledger.rounds.reduce((total, entry) => total + entry.spentUsd, 0),
  ),
  stopped: state.stopped,
  stopReason: state.stopReason,
  unresolved: state.requests.filter(
    (request) => request.state === "started" || request.state === "uncertain",
  ),
  results: state.results,
  contentQualityReviewStillRequired: true,
  controlInterruptions: state.results.filter((result) => result.controlInterruption),
};
await save(resolve(directory, "summary.json"), summary);
await withMigrationLedger(ledgerPath, (ledger) => {
  thisRound(ledger).status = state.stopped
    ? "stopped"
    : state.results.length === schedule.length
      ? "completed"
      : "running";
});
if (state.stopped || state.results.length !== schedule.length) process.exitCode = 1;
