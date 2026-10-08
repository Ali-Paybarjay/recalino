import { z } from "../../packages/core/node_modules/zod";
import { migrationControls } from "./haiku55-migration-guards";

const qualityScore = z.number().min(0).max(4);
export const migrationQualityReviewSchema = z.strictObject({
  freeze: z.string().regex(/^[a-f0-9]{64}$/),
  reviewer: z.string().min(1),
  cases: z.array(
    z.strictObject({
      caseId: z.string().min(1),
      modelHash: z.string().regex(/^[a-f0-9]{64}$/),
      scores: z.strictObject({
        correctness: qualityScore,
        grounding: qualityScore,
        coverage: qualityScore,
        learnerFit: qualityScore,
        clarityCardUsability: qualityScore,
      }),
      requiredConcepts: z.array(
        z.strictObject({
          id: z.string().min(1),
          adequatelyTaught: z.boolean(),
          evidence: z.string().min(1),
        }),
      ),
      criticalIssues: z.array(
        z.strictObject({
          category: z.enum(["teaching", "grounding", "attribution", "injection"]),
          detail: z.string().min(1),
        }),
      ),
    }),
  ),
});

export type MigrationQualityReference = {
  caseId: string;
  modelHash?: string;
  requiredConceptIds: string[];
};
type MigrationTechnicalSummary = {
  freeze: string;
  completedCases: number;
  expectedCases: number;
  finalLocalPasses: number;
  firstGenerationPasses: number;
  unexpectedTransportFallbacks: number;
  stopped: boolean;
  unresolved: unknown[];
};

/** Reviewer judgments are tied to exact accepted models and every predeclared concept. */
export function assessMigrationQualityReview(
  summary: MigrationTechnicalSummary,
  references: MigrationQualityReference[],
  rawReview: unknown,
) {
  const review = migrationQualityReviewSchema.parse(rawReview);
  if (review.freeze !== summary.freeze) throw new Error("quality_review_freeze_mismatch");
  const byCase = new Map(references.map((entry) => [entry.caseId, entry]));
  const reviewed = new Set<string>();
  const cases = review.cases.map((entry) => {
    if (reviewed.has(entry.caseId)) throw new Error("quality_review_duplicate_case");
    reviewed.add(entry.caseId);
    const reference = byCase.get(entry.caseId);
    if (!reference?.modelHash) throw new Error("quality_review_requires_accepted_model");
    if (entry.modelHash !== reference.modelHash)
      throw new Error("quality_review_model_hash_mismatch");
    const ids = entry.requiredConcepts.map((concept) => concept.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== reference.requiredConceptIds.length ||
      reference.requiredConceptIds.some((id) => !ids.includes(id))
    )
      throw new Error("quality_review_requires_all_predeclared_concepts");
    const meanQuality = Object.values(entry.scores).reduce((sum, score) => sum + score, 0) / 5;
    return {
      caseId: entry.caseId,
      meanQuality,
      allRequiredConceptsAdequatelyTaught: entry.requiredConcepts.every(
        (concept) => concept.adequatelyTaught,
      ),
      criticalIssues: entry.criticalIssues.length,
      qualityPassed:
        meanQuality >= migrationControls.adoptionGates.minimumMeanQualityEachCase &&
        entry.requiredConcepts.every((concept) => concept.adequatelyTaught) &&
        entry.criticalIssues.length === 0,
    };
  });
  const complete =
    summary.expectedCases === 14 &&
    references.length === 14 &&
    review.cases.length === 14 &&
    references.every((entry) => reviewed.has(entry.caseId));
  const technicalGatesPassed =
    summary.expectedCases === 14 &&
    summary.completedCases === 14 &&
    summary.finalLocalPasses === 14 &&
    summary.firstGenerationPasses >= 13 &&
    summary.unexpectedTransportFallbacks === 0 &&
    !summary.stopped &&
    summary.unresolved.length === 0;
  return {
    freeze: review.freeze,
    reviewer: review.reviewer,
    offlineOnly: true,
    manualJudgments: true,
    reviewedCases: cases.length,
    expectedCases: 14,
    complete,
    technicalGatesPassed,
    contentQualityReviewStillRequired: !complete,
    allRequiredConceptsAdequatelyTaught:
      complete && cases.every((entry) => entry.allRequiredConceptsAdequatelyTaught),
    criticalIssues: cases.reduce((sum, entry) => sum + entry.criticalIssues, 0),
    adoptionEligible:
      complete && technicalGatesPassed && cases.every((entry) => entry.qualityPassed),
    cases,
  };
}
