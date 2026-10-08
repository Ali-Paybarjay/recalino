import { describe, expect, it } from "vitest";
import { assessMigrationQualityReview } from "./haiku55-migration-quality";

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
