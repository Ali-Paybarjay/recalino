import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import {
  assessMigrationQualityReview,
  type MigrationQualityRound,
  migrationQualityMean,
  migrationQualityPlanContext,
  migrationQualityReviewSchema,
  migrationRecordedTechnicalSummary,
} from "./haiku55-migration-quality";

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing synthetic review fixture");
  return value;
}
const hash = "a".repeat(64);
const references = Array.from({ length: 14 }, (_, index) => ({
  caseId: `case-${index}`,
  modelHash: hash,
  requiredConceptIds: ["one", "two"],
}));
const summary = {
  freeze: hash,
  completedCases: 14,
  expectedCases: 14,
  finalLocalPasses: 14,
  firstGenerationPasses: 13,
  unexpectedTransportFallbacks: 0,
  stopped: false,
  unresolved: [],
};
const review = () => ({
  freeze: hash,
  reviewer: "independent synthetic review",
  cases: references.map((reference) => ({
    caseId: reference.caseId,
    modelHash: hash,
    scores: { correctness: 3, grounding: 3, coverage: 3, learnerFit: 3, clarityCardUsability: 3 },
    requiredConcepts: reference.requiredConceptIds.map((id) => ({
      id,
      adequatelyTaught: true,
      evidence: "claim-1",
    })),
    criticalIssues: [] as { category: "teaching"; detail: string }[],
  })),
});
// The production round on the direct json_object transport the unchanged adoption gate expects.
const directJsonRound: MigrationQualityRound = {
  fixtureSet: "migration-14",
  candidateId: null,
  model: "anthropic/claude-haiku-5.5",
  structuredOutputMode: "json_object",
  directJsonMode: true,
};
const assess = (
  technical: Parameters<typeof assessMigrationQualityReview>[0],
  cases: Parameters<typeof assessMigrationQualityReview>[1],
  raw: unknown,
  round: MigrationQualityRound = directJsonRound,
) => assessMigrationQualityReview(technical, cases, raw, round);
describe("PRD-QA-01 independent manual migration review", () => {
  it("requires all fourteen accepted models, all concepts and the unchanged technical gates", () => {
    expect(assess(summary, references, review()).adoptionEligible).toBe(true);
    expect(
      assess({ ...summary, firstGenerationPasses: 12 }, references, review()).adoptionEligible,
    ).toBe(false);
    const partial = review();
    partial.cases.pop();
    expect(assess(summary, references, partial)).toMatchObject({
      adoptionEligible: false,
      complete: false,
      contentQualityReviewStillRequired: true,
    });
  });
  it("does not let a high average hide omitted teaching or a critical error", () => {
    const omitted = review();
    defined(defined(omitted.cases[0]).requiredConcepts[1]).adequatelyTaught = false;
    expect(assess(summary, references, omitted).adoptionEligible).toBe(false);
    const critical = review();
    defined(critical.cases[0]).criticalIssues.push({
      category: "teaching",
      detail: "Wrong source rule",
    });
    expect(assess(summary, references, critical).adoptionEligible).toBe(false);
    const weak = review();
    defined(weak.cases[0]).scores.correctness = 2;
    expect(assess(summary, references, weak).adoptionEligible).toBe(false);
  });
  it("rejects stale output, duplicate cases and missing concept judgments", () => {
    const stale = review();
    defined(stale.cases[0]).modelHash = "b".repeat(64);
    expect(() => assess(summary, references, stale)).toThrow("model_hash_mismatch");
    const duplicate = review();
    defined(duplicate.cases[1]).caseId = defined(duplicate.cases[0]).caseId;
    expect(() => assess(summary, references, duplicate)).toThrow("duplicate_case");
    const missing = review();
    defined(missing.cases[0]).requiredConcepts.pop();
    expect(() => assess(summary, references, missing)).toThrow("predeclared_concepts");
  });
});

describe("FR-PROC-003 PRD-QA-01 multilingual review categories and scores", () => {
  it("fails a case on a critical explanation-language issue", () => {
    const language = review();
    defined(language.cases[3]).criticalIssues.push({
      category: "language" as "teaching",
      detail: "Explanation switches to another language",
    });
    const assessed = assess(summary, references, language);
    expect(assessed.adoptionEligible).toBe(false);
    expect(assessed.criticalIssues).toBe(1);
    expect(assessed.cases[3]?.qualityPassed).toBe(false);
  });
  it("records explanationLanguageQuality without adding it to the five-score mean", () => {
    const recorded = review();
    for (const entry of recorded.cases)
      Object.assign(entry.scores, { explanationLanguageQuality: 0 });
    const assessed = assess(summary, references, recorded);
    expect(assessed.adoptionEligible).toBe(true);
    expect(assessed.cases[0]).toMatchObject({ meanQuality: 3, explanationLanguageQuality: 0 });
    const weak = review();
    Object.assign(defined(weak.cases[0]).scores, {
      clarityCardUsability: 2,
      explanationLanguageQuality: 4,
    });
    const weakAssessed = assess(summary, references, weak);
    expect(weakAssessed.cases[0]?.meanQuality).toBeCloseTo(2.8);
    expect(weakAssessed.adoptionEligible).toBe(false);
    expect(
      migrationQualityMean({
        correctness: 4,
        grounding: 4,
        coverage: 4,
        learnerFit: 4,
        clarityCardUsability: 4,
        explanationLanguageQuality: 0,
      }),
    ).toBe(4);
  });
  it("still rejects unknown score names, categories and out-of-range scores", () => {
    for (const change of [
      { fluency: 3 },
      { explanationLanguageQuality: 5 },
      { explanationLanguageQuality: -1 },
    ]) {
      const invalid = review();
      Object.assign(defined(invalid.cases[0]).scores, change);
      expect(() => migrationQualityReviewSchema.parse(invalid)).toThrow();
    }
    const category = review();
    defined(category.cases[0]).criticalIssues.push({
      category: "style" as "teaching",
      detail: "Unknown category",
    });
    expect(() => migrationQualityReviewSchema.parse(category)).toThrow();
  });
});

describe("FR-PROC-003 offline review trusts only the recorded round state", () => {
  const results = [
    {
      caseId: "R01-1",
      fixtureId: "R01",
      finalLocalPass: true,
      firstGenerationPass: true,
      unexpectedTransportFallback: false,
      automaticGoldChecksPassed: true,
    },
    {
      caseId: "R02-2",
      fixtureId: "R02",
      finalLocalPass: true,
      firstGenerationPass: false,
      unexpectedTransportFallback: false,
      automaticGoldChecksPassed: true,
    },
  ];
  const recorded = () => ({
    freeze: hash,
    expectedCases: 14,
    summary: {
      freeze: hash,
      completedCases: 2,
      expectedCases: 14,
      stopped: false,
      results: structuredClone(results),
    },
    state: {
      freeze: hash,
      stopped: false,
      requests: [{ state: "completed" }, { state: "completed" }, { state: "known_rejection" }],
      results: structuredClone(results),
    },
    dossiers: new Map<string, unknown>(results.map((result) => [result.caseId, { ...result }])),
  });
  it("recomputes every technical count from state.json", () => {
    expect(migrationRecordedTechnicalSummary(recorded())).toMatchObject({
      freeze: hash,
      completedCases: 2,
      expectedCases: 14,
      finalLocalPasses: 2,
      firstGenerationPasses: 1,
      unexpectedTransportFallbacks: 0,
      stopped: false,
      unresolved: [],
      automaticGoldChecksPassed: true,
    });
    const unresolved = recorded();
    unresolved.state.requests.push({ state: "uncertain" });
    expect(migrationRecordedTechnicalSummary(unresolved).unresolved).toEqual([
      { state: "uncertain" },
    ]);
  });
  it("rejects an edited summary, a differing dossier and another freeze", () => {
    const edited = recorded();
    Object.assign(defined(edited.summary.results[1]), { firstGenerationPass: true });
    expect(() => migrationRecordedTechnicalSummary(edited)).toThrow(
      "quality_summary_differs_from_state",
    );
    const stopped = recorded();
    stopped.summary.stopped = true;
    expect(() => migrationRecordedTechnicalSummary(stopped)).toThrow(
      "quality_summary_differs_from_state",
    );
    const dossier = recorded();
    dossier.dossiers.set("R02-2", { ...results[1], firstGenerationPass: true });
    expect(() => migrationRecordedTechnicalSummary(dossier)).toThrow(
      "quality_dossier_differs_from_state",
    );
    const missing = recorded();
    missing.dossiers.delete("R01-1");
    expect(() => migrationRecordedTechnicalSummary(missing)).toThrow(
      "quality_dossier_differs_from_state",
    );
    const state = recorded();
    state.state.freeze = "b".repeat(64);
    expect(() => migrationRecordedTechnicalSummary(state)).toThrow("quality_state_freeze_mismatch");
    const summaryFreeze = recorded();
    summaryFreeze.summary.freeze = "b".repeat(64);
    expect(() => migrationRecordedTechnicalSummary(summaryFreeze)).toThrow(
      "quality_summary_freeze_mismatch",
    );
    const duplicate = recorded();
    for (const target of [duplicate.state.results, duplicate.summary.results])
      Object.assign(defined(target[1]), { caseId: "R01-1" });
    expect(() => migrationRecordedTechnicalSummary(duplicate)).toThrow(
      "quality_state_case_ids_invalid",
    );
  });
});

describe("FR-PROC-003 PRD-QA-01 the adoption gate's expected transport", () => {
  const schemaRound: MigrationQualityRound = {
    fixtureSet: "multilingual-holdout-4",
    candidateId: "gemini-3.8-flash-medium-schema",
    model: "google/gemini-3.8-flash",
    structuredOutputMode: "json_schema",
    directJsonMode: false,
  };
  it("accepts only the declared strict json_schema or direct json_object transport", () => {
    const assessed = assess(summary, references, review(), schemaRound);
    expect(assessed).toMatchObject({
      round: schemaRound,
      expectedTransport: "declared direct json_object or strict json_schema",
      transportMatchesAdoptionGate: true,
      adoptionGatesExceptTransportPassed: true,
      adoptionEligible: true,
    });
    expect(
      assess({ ...summary, unexpectedTransportFallbacks: 1 }, references, review(), schemaRound),
    ).toMatchObject({ adoptionEligible: false });
    for (const round of [
      { ...schemaRound, directJsonMode: true },
      { ...directJsonRound, structuredOutputMode: null },
      { ...directJsonRound, directJsonMode: false },
    ])
      expect(assess(summary, references, review(), round).adoptionEligible).toBe(false);
  });
  it("reports the evaluated round and the direct JSON transport as meeting the gate", () => {
    const candidate = {
      ...directJsonRound,
      fixtureSet: "multilingual-holdout-4",
      candidateId: "gemini-3.8-flash-medium",
      model: "google/gemini-3.8-flash",
    };
    expect(assess(summary, references, review(), candidate)).toMatchObject({
      round: candidate,
      transportMatchesAdoptionGate: true,
      adoptionGatesExceptTransportPassed: true,
      adoptionEligible: true,
    });
    expect(
      assess({ ...summary, finalLocalPasses: 13 }, references, review(), candidate),
    ).toMatchObject({ adoptionGatesExceptTransportPassed: false, adoptionEligible: false });
  });
});

describe("FR-PROC-003 offline review reads the round from the frozen plan", () => {
  const frozen = (plan: Record<string, unknown>) => ({
    ...plan,
    freeze: sha256Hex(canonicalJson(plan)),
    paidCalls: 0,
  });
  const acceptancePlan = {
    version: "synthetic",
    fixtureSet: "multilingual-holdout-4",
    fixturesHash: hash,
    expectedCases: 14,
    model: "google/gemini-3.8-flash",
    directJsonMode: false,
    structuredOutputMode: "json_schema",
    acceptanceCandidate: {
      candidateId: "gemini-3.8-flash-medium-schema",
      productionConfigUnchanged: true,
    },
  };
  it("takes the fixture set, candidate and transport from the plan", () => {
    const planFile = frozen(acceptancePlan);
    const context = migrationQualityPlanContext(planFile, {});
    expect(context).toEqual({
      freeze: planFile.freeze,
      fixturesHash: hash,
      expectedCases: 14,
      round: {
        fixtureSet: "multilingual-holdout-4",
        candidateId: "gemini-3.8-flash-medium-schema",
        model: "google/gemini-3.8-flash",
        structuredOutputMode: "json_schema",
        directJsonMode: false,
      },
    });
    expect(
      migrationQualityPlanContext(planFile, {
        fixtureSet: "multilingual-holdout-4",
        candidate: "gemini-3.8-flash-medium-schema",
      }),
    ).toEqual(context);
    const comparison = frozen({
      ...acceptancePlan,
      acceptanceCandidate: undefined,
      fixtureSet: "model-comparison",
      comparison: { candidateId: "gemini-3.8-flash-low" },
    });
    expect(migrationQualityPlanContext(comparison, {}).round.candidateId).toBe(
      "gemini-3.8-flash-low",
    );
  });
  it("rejects a --fixture-set or --candidate flag that differs from the plan", () => {
    const planFile = frozen(acceptancePlan);
    expect(() => migrationQualityPlanContext(planFile, { fixtureSet: "migration-14" })).toThrow(
      "quality_fixture_set_differs_from_plan",
    );
    expect(() =>
      migrationQualityPlanContext(planFile, { candidate: "gemini-3.8-flash-medium" }),
    ).toThrow("quality_candidate_differs_from_plan");
    const production = frozen({
      ...acceptancePlan,
      fixtureSet: "migration-14",
      acceptanceCandidate: undefined,
      directJsonMode: true,
      structuredOutputMode: "json_object",
    });
    expect(() =>
      migrationQualityPlanContext(production, { candidate: "gemini-3.8-flash-medium" }),
    ).toThrow("quality_candidate_differs_from_plan");
  });
  it("rejects a plan edited after its freeze", () => {
    const planFile = frozen(acceptancePlan);
    for (const edit of [
      { structuredOutputMode: "json_object", directJsonMode: true },
      { fixtureSet: "haiku55-holdout-2" },
      { acceptanceCandidate: { candidateId: "gemini-3.8-flash-medium" } },
      { expectedCases: 13 },
    ])
      expect(() => migrationQualityPlanContext({ ...planFile, ...edit }, {})).toThrow(
        "differs from its freeze",
      );
    expect(() => migrationQualityPlanContext({ ...planFile, paidCalls: 3 }, {})).not.toThrow();
  });
  it("reads a plan frozen before the decoding mode was recorded as direct JSON", () => {
    const { structuredOutputMode: _omitted, ...older } = {
      ...acceptancePlan,
      fixtureSet: "migration-14",
      model: "anthropic/claude-haiku-5.5",
      acceptanceCandidate: undefined,
      directJsonMode: true,
    };
    expect(migrationQualityPlanContext(frozen(older), {}).round).toEqual({
      fixtureSet: "migration-14",
      candidateId: null,
      model: "anthropic/claude-haiku-5.5",
      structuredOutputMode: "json_object",
      directJsonMode: true,
    });
  });
});
