import { describe, expect, it } from "vitest";
import {
  assessMigrationQualityReview,
  migrationQualityMean,
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
describe("PRD-QA-01 independent manual migration review", () => {
  it("requires all fourteen accepted models, all concepts and the unchanged technical gates", () => {
    expect(assessMigrationQualityReview(summary, references, review()).adoptionEligible).toBe(true);
    expect(
      assessMigrationQualityReview({ ...summary, firstGenerationPasses: 12 }, references, review())
        .adoptionEligible,
    ).toBe(false);
    const partial = review();
    partial.cases.pop();
    expect(assessMigrationQualityReview(summary, references, partial)).toMatchObject({
      adoptionEligible: false,
      complete: false,
      contentQualityReviewStillRequired: true,
    });
  });
  it("does not let a high average hide omitted teaching or a critical error", () => {
    const omitted = review();
    defined(defined(omitted.cases[0]).requiredConcepts[1]).adequatelyTaught = false;
    expect(assessMigrationQualityReview(summary, references, omitted).adoptionEligible).toBe(false);
    const critical = review();
    defined(critical.cases[0]).criticalIssues.push({
      category: "teaching",
      detail: "Wrong source rule",
    });
    expect(assessMigrationQualityReview(summary, references, critical).adoptionEligible).toBe(
      false,
    );
    const weak = review();
    defined(weak.cases[0]).scores.correctness = 2;
    expect(assessMigrationQualityReview(summary, references, weak).adoptionEligible).toBe(false);
  });
  it("rejects stale output, duplicate cases and missing concept judgments", () => {
    const stale = review();
    defined(stale.cases[0]).modelHash = "b".repeat(64);
    expect(() => assessMigrationQualityReview(summary, references, stale)).toThrow(
      "model_hash_mismatch",
    );
    const duplicate = review();
    defined(duplicate.cases[1]).caseId = defined(duplicate.cases[0]).caseId;
    expect(() => assessMigrationQualityReview(summary, references, duplicate)).toThrow(
      "duplicate_case",
    );
    const missing = review();
    defined(missing.cases[0]).requiredConcepts.pop();
    expect(() => assessMigrationQualityReview(summary, references, missing)).toThrow(
      "predeclared_concepts",
    );
  });
});

describe("FR-PROC-003 PRD-QA-01 multilingual review categories and scores", () => {
  it("fails a case on a critical explanation-language issue", () => {
    const language = review();
    defined(language.cases[3]).criticalIssues.push({
      category: "language" as "teaching",
      detail: "Explanation switches to another language",
    });
    const assessed = assessMigrationQualityReview(summary, references, language);
    expect(assessed.adoptionEligible).toBe(false);
    expect(assessed.criticalIssues).toBe(1);
    expect(assessed.cases[3]?.qualityPassed).toBe(false);
  });
  it("records explanationLanguageQuality without adding it to the five-score mean", () => {
    const recorded = review();
    for (const entry of recorded.cases)
      Object.assign(entry.scores, { explanationLanguageQuality: 0 });
    const assessed = assessMigrationQualityReview(summary, references, recorded);
    expect(assessed.adoptionEligible).toBe(true);
    expect(assessed.cases[0]).toMatchObject({ meanQuality: 3, explanationLanguageQuality: 0 });
    const weak = review();
    Object.assign(defined(weak.cases[0]).scores, {
      clarityCardUsability: 2,
      explanationLanguageQuality: 4,
    });
    const weakAssessed = assessMigrationQualityReview(summary, references, weak);
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
