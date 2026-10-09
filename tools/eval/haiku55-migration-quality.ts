import { z } from "../../packages/core/node_modules/zod";
import { canonicalJson } from "../../packages/core/src/plt";
import { migrationControls } from "./haiku55-migration-guards";

const qualityScore = z.number().min(0).max(4);
/** The five scored dimensions of the adoption gate's per-case mean. */
export const migrationQualityDimensions = [
  "correctness",
  "grounding",
  "coverage",
  "learnerFit",
  "clarityCardUsability",
] as const;
export const migrationQualityScoresSchema = z.strictObject({
  correctness: qualityScore,
  grounding: qualityScore,
  coverage: qualityScore,
  learnerFit: qualityScore,
  clarityCardUsability: qualityScore,
  /** Recorded for multilingual review; never part of the five-score mean. */
  explanationLanguageQuality: qualityScore.optional(),
});
export const migrationRequiredConceptSchema = z.strictObject({
  id: z.string().min(1),
  adequatelyTaught: z.boolean(),
  evidence: z.string().min(1),
});
export const migrationCriticalIssueSchema = z.strictObject({
  category: z.enum(["teaching", "grounding", "attribution", "injection", "language"]),
  detail: z.string().min(1),
});
export const migrationQualityReviewSchema = z.strictObject({
  freeze: z.string().regex(/^[a-f0-9]{64}$/),
  reviewer: z.string().min(1),
  cases: z.array(
    z.strictObject({
      caseId: z.string().min(1),
      modelHash: z.string().regex(/^[a-f0-9]{64}$/),
      scores: migrationQualityScoresSchema,
      requiredConcepts: z.array(migrationRequiredConceptSchema),
      criticalIssues: z.array(migrationCriticalIssueSchema),
    }),
  ),
});
export type MigrationQualityReview = z.infer<typeof migrationQualityReviewSchema>;

/** Mean of the five gate dimensions only. */
export function migrationQualityMean(scores: z.infer<typeof migrationQualityScoresSchema>) {
  return (
    migrationQualityDimensions.reduce((sum, dimension) => sum + scores[dimension], 0) /
    migrationQualityDimensions.length
  );
}

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
  /** Deterministic answer-key checks for every accepted case; absent means not evaluated. */
  automaticGoldChecksPassed?: boolean;
};

/**
 * Offline review trusts only the round state. summary.json and every case's
 * validation-dossier.json must equal it, and the technical counts are recomputed from it.
 */
export function migrationRecordedTechnicalSummary(recorded: {
  freeze: string;
  expectedCases: number;
  summary: {
    freeze: string;
    completedCases: number;
    expectedCases: number;
    stopped: boolean;
    results: Record<string, unknown>[];
  };
  state: {
    freeze: string;
    stopped: boolean;
    requests: { state: string }[];
    results: Record<string, unknown>[];
  };
  dossiers: ReadonlyMap<string, unknown>;
}): MigrationTechnicalSummary & { results: Record<string, unknown>[] } {
  const { state, summary } = recorded;
  if (state.freeze !== recorded.freeze) throw new Error("quality_state_freeze_mismatch");
  if (summary.freeze !== recorded.freeze) throw new Error("quality_summary_freeze_mismatch");
  if (
    summary.expectedCases !== recorded.expectedCases ||
    summary.completedCases !== state.results.length ||
    summary.stopped !== state.stopped ||
    canonicalJson(summary.results) !== canonicalJson(state.results)
  )
    throw new Error("quality_summary_differs_from_state");
  const caseIds = state.results.map((result) => result.caseId);
  if (
    caseIds.some((caseId) => typeof caseId !== "string") ||
    new Set(caseIds).size !== caseIds.length
  )
    throw new Error("quality_state_case_ids_invalid");
  for (const result of state.results)
    if (canonicalJson(recorded.dossiers.get(String(result.caseId))) !== canonicalJson(result))
      throw new Error("quality_dossier_differs_from_state");
  const count = (field: string) => state.results.filter((result) => result[field] === true).length;
  return {
    freeze: recorded.freeze,
    completedCases: state.results.length,
    expectedCases: recorded.expectedCases,
    finalLocalPasses: count("finalLocalPass"),
    firstGenerationPasses: count("firstGenerationPass"),
    unexpectedTransportFallbacks: count("unexpectedTransportFallback"),
    stopped: state.stopped,
    unresolved: state.requests.filter(
      (request) => request.state === "started" || request.state === "uncertain",
    ),
    automaticGoldChecksPassed: state.results.every(
      (result) => result.finalLocalPass !== true || result.automaticGoldChecksPassed === true,
    ),
    results: state.results,
  };
}

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
    const meanQuality = migrationQualityMean(entry.scores);
    return {
      caseId: entry.caseId,
      meanQuality,
      ...(entry.scores.explanationLanguageQuality === undefined
        ? {}
        : { explanationLanguageQuality: entry.scores.explanationLanguageQuality }),
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
    summary.unresolved.length === 0 &&
    summary.automaticGoldChecksPassed !== false;
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
