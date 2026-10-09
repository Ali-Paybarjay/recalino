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
import type { MigrationFixture } from "./haiku55-migration-fixtures";
import { holdout4MigrationFixtures, holdout4RepeatIds } from "./multilingual-holdout4-fixtures";

export const holdout4FixtureSetId = "multilingual-holdout-4";
export type MigrationHoldoutSet = {
  fixtures: () => MigrationFixture[];
  repeatIds: readonly string[];
  /** Only a set written for one allow-listed candidate may evaluate it instead of production. */
  acceptsCandidate: boolean;
  /** What the frozen plan claims about how and when the set was written. */
  provenance: (fixtures: MigrationFixture[]) => Record<string, unknown>;
};
const haikuHoldoutProvenance = () => ({
  writtenAfterFailedFourteenCaseRound: true,
  disjointFromRegressionFixturesAndPromptExamples: true,
  everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
  automaticGoldChecksGateAdoption: true,
  humanTeacherCertificationClaimed: false,
  blindModelComparisonClaimed: false,
});

// Each holdout set is written before any candidate runs against it and is evaluated once.
export const migrationHoldoutSets: Record<string, MigrationHoldoutSet> = {
  [holdoutFixtureSetId]: {
    fixtures: holdoutMigrationFixtures,
    repeatIds: holdoutRepeatIds,
    acceptsCandidate: false,
    provenance: haikuHoldoutProvenance,
  },
  [holdout3FixtureSetId]: {
    fixtures: holdout3MigrationFixtures,
    repeatIds: holdout3RepeatIds,
    acceptsCandidate: false,
    provenance: haikuHoldoutProvenance,
  },
  [holdout4FixtureSetId]: {
    fixtures: () => structuredClone(holdout4MigrationFixtures),
    repeatIds: holdout4RepeatIds,
    acceptsCandidate: true,
    provenance: (fixtures) => ({
      writtenAfterBlindComparison: true,
      explanationLanguages: [...new Set(fixtures.map((fixture) => fixture.explanationLanguage))],
      disjointFromComparisonSetAndHoldouts: true,
      candidateSelectedByBlindComparison: "gemini-3.8-flash-medium",
      everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
      automaticGoldChecksGateAdoption: true,
      humanTeacherCertificationClaimed: false,
      blindModelComparisonClaimed: false,
    }),
  },
};
