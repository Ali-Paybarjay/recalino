import { describe, expect, it } from "vitest";
import { providerSettingsSchema } from "../../packages/core/src/aip";
import { holdoutFixtureSetId } from "./haiku55-holdout-fixtures";
import { holdout4FixtureSetId, migrationHoldoutSets } from "./haiku55-holdout-registry";
import { holdout3FixtureSetId } from "./haiku55-holdout3-fixtures";
import { freshMigrationFixtures } from "./haiku55-migration-fixtures";
import { migrationRequestReserve } from "./haiku55-migration-guards";
import {
  acceptanceCandidateIds,
  comparisonCandidates,
  comparisonSettings,
  evaluationCandidates,
  resolveEvaluationCandidate,
  schemaDecodingCandidates,
  zdrEndpointMaximumRates,
} from "./model-comparison-candidates";
import { holdout4MigrationFixtures, holdout4RepeatIds } from "./multilingual-holdout4-fixtures";

const base = providerSettingsSchema.parse({
  version: "base",
  llmModel: "anthropic/claude-haiku-5.5",
  visionModel: "v",
  sttModel: "s",
  ttsModel: "t",
  voice: "x",
  promptVersion: "p",
  maxInputCharacters: 120000,
  maxOutputTokens: 6144,
  structuredTemperature: 0,
  timeoutMs: 90000,
  maximumMicros: 300000,
  currency: "USD",
  priceVersion: "p",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
});
const gemini = "google/gemini-3.8-flash";
// Synthetic prices shaped like the captured lists: a priority tier at 1.8x the list price.
const catalog = {
  data: [{ id: gemini, pricing: { prompt: "0.00000075", completion: "0.00000375" } }],
};
const zdrEndpoints = {
  data: [
    { model_id: gemini, pricing: { prompt: "0.00000135", completion: "0.00000675" } },
    { model_id: gemini, pricing: { prompt: "0.00000075", completion: "0.00000375" } },
    { model_id: "google/gemini-3.8-flash-lite", pricing: { prompt: "0.1", completion: "0.1" } },
  ],
};

describe("FR-PROC-003 allow-listed acceptance candidate", () => {
  it("requires a candidate for comparison and evaluates production config otherwise", () => {
    expect(() =>
      resolveEvaluationCandidate(undefined, { comparison: true, acceptsCandidate: false }),
    ).toThrow("comparison_requires_candidate");
    expect(
      resolveEvaluationCandidate(undefined, { comparison: false, acceptsCandidate: true }),
    ).toBeUndefined();
    expect(
      resolveEvaluationCandidate("claude-haiku-4.5", { comparison: true, acceptsCandidate: false }),
    ).toMatchObject({ candidateId: "claude-haiku-4.5", acceptance: false });
  });
  it("accepts a candidate only on a registered set and only from the explicit allow-list", () => {
    expect(acceptanceCandidateIds).toEqual([
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-medium-schema",
    ]);
    for (const id of acceptanceCandidateIds)
      expect(resolveEvaluationCandidate(id, { comparison: false, acceptsCandidate: true })).toEqual(
        { candidateId: id, candidate: evaluationCandidates[id], acceptance: true },
      );
    expect(() =>
      resolveEvaluationCandidate("gemini-3.8-flash-medium", {
        comparison: false,
        acceptsCandidate: false,
      }),
    ).toThrow("fixture_set_uses_production_config");
    expect(() =>
      resolveEvaluationCandidate("claude-haiku-4.5", {
        comparison: false,
        acceptsCandidate: true,
      }),
    ).toThrow("candidate_not_on_acceptance_allow_list");
    for (const id of ["unknown", "toString", "__proto__"])
      expect(() =>
        resolveEvaluationCandidate(id, { comparison: false, acceptsCandidate: true }),
      ).toThrow("unknown_candidate");
  });
  it("evaluates exactly the compared settings for the medium candidate", () => {
    const resolved = resolveEvaluationCandidate("gemini-3.8-flash-medium", {
      comparison: false,
      acceptsCandidate: true,
    });
    expect(resolved?.candidate).toBe(comparisonCandidates["gemini-3.8-flash-medium"]);
    if (!resolved) throw new Error("Missing candidate");
    const settings = providerSettingsSchema.parse(
      comparisonSettings(base, resolved.candidateId, resolved.candidate),
    );
    expect(settings.llmModel).toBe(gemini);
    expect(settings.structuredTemperature).toBeUndefined();
    expect(settings.structuredModelOverrides?.[gemini]).toEqual({
      maxOutputTokens: 32000,
      reasoningEffort: "medium",
      maxRequestBytes: 400000,
      structuredOutputMode: "json_object",
      omitTemperature: true,
      knowledgeContract: "content",
    });
  });
  it("keeps json_object for compared candidates and passes json_schema only for the schema twin", () => {
    for (const [id, candidate] of Object.entries(comparisonCandidates))
      expect(
        comparisonSettings(base, id, candidate).structuredModelOverrides?.[candidate.model]
          ?.structuredOutputMode,
      ).toBe("json_object");
    const schema = schemaDecodingCandidates["gemini-3.8-flash-medium-schema"];
    const twin = comparisonCandidates["gemini-3.8-flash-medium"];
    if (!schema || !twin) throw new Error("Missing candidate");
    expect(schema).toEqual({ ...twin, structuredOutputMode: "json_schema" });
    const schemaSettings = comparisonSettings(base, "gemini-3.8-flash-medium-schema", schema);
    const twinSettings = comparisonSettings(base, "gemini-3.8-flash-medium", twin);
    expect(schemaSettings.structuredModelOverrides?.[gemini]).toEqual({
      ...twinSettings.structuredModelOverrides?.[gemini],
      structuredOutputMode: "json_schema",
    });
    expect({ ...schemaSettings, version: "", structuredModelOverrides: undefined }).toEqual({
      ...twinSettings,
      version: "",
      structuredModelOverrides: undefined,
    });
    expect(Object.keys(comparisonCandidates)).not.toContain("gemini-3.8-flash-medium-schema");
  });
});

describe("FR-QUOTA-009 zero-retention reserve maxima", () => {
  it("reserves above the catalog price for a priority-routed call", () => {
    const rates = zdrEndpointMaximumRates(zdrEndpoints, gemini, catalog);
    expect(rates).toEqual({ promptRate: 0.00000135, outputRate: 0.00000675 });
    const body = "x".repeat(35000);
    const zdrReserve = 35000 * rates.promptRate + 32000 * rates.outputRate;
    expect(zdrReserve).toBeCloseTo(0.263, 3);
    expect(zdrReserve).toBeGreaterThan(
      migrationRequestReserve(catalog, gemini, body, 32000).reserveUsd,
    );
  });
  it("includes long-context overrides and internal reasoning in the maxima", () => {
    const endpoints = [
      {
        model_id: "synthetic/model",
        pricing: {
          prompt: "0.000001",
          completion: "0.000005",
          internal_reasoning: "0.000009",
          overrides: [{ prompt: "0.000002", completion: "0.000006" }],
        },
      },
      {
        model_id: "synthetic/model",
        pricing: {
          prompt: "0.000001",
          completion: "0.000004",
          overrides: [{ prompt: "0.000003", internal_reasoning: "0.000011" }],
        },
      },
    ];
    expect(zdrEndpointMaximumRates(endpoints, "synthetic/model")).toEqual({
      promptRate: 0.000003,
      outputRate: 0.000011,
    });
  });
  it("refuses a model without a ZDR endpoint or below the catalog completion rate", () => {
    expect(() => zdrEndpointMaximumRates(zdrEndpoints, "google/gemini-unknown")).toThrow(
      "candidate_has_no_zdr_endpoint",
    );
    expect(() => zdrEndpointMaximumRates({ data: [] }, gemini)).toThrow(
      "candidate_has_no_zdr_endpoint",
    );
    expect(() =>
      zdrEndpointMaximumRates(zdrEndpoints, gemini, {
        data: [{ id: gemini, pricing: { prompt: "0.00000075", completion: "0.00001" } }],
      }),
    ).toThrow("zdr_output_rate_below_catalog_completion_rate");
    expect(() => zdrEndpointMaximumRates(zdrEndpoints, gemini, { data: [] })).toThrow(
      "candidate_model_missing_from_catalog",
    );
  });
});

describe("FR-PROC-003 holdout registry and per-set provenance", () => {
  it("keeps the earlier holdouts on production config with their original provenance", () => {
    for (const id of [holdoutFixtureSetId, holdout3FixtureSetId]) {
      const set = migrationHoldoutSets[id];
      expect(set?.acceptsCandidate).toBe(false);
      expect(set?.provenance(set.fixtures())).toEqual({
        writtenAfterFailedFourteenCaseRound: true,
        disjointFromRegressionFixturesAndPromptExamples: true,
        everyAcceptedCaseRequiresIndependentReviewerConceptChecks: true,
        automaticGoldChecksGateAdoption: true,
        humanTeacherCertificationClaimed: false,
        blindModelComparisonClaimed: false,
      });
    }
  });
  it("registers multilingual holdout 4 for the blind-comparison candidate", () => {
    expect(holdout4FixtureSetId).toBe("multilingual-holdout-4");
    expect(Object.keys(migrationHoldoutSets).sort()).toEqual(
      [holdoutFixtureSetId, holdout3FixtureSetId, holdout4FixtureSetId].sort(),
    );
    const set = migrationHoldoutSets[holdout4FixtureSetId];
    if (!set) throw new Error("Missing holdout 4");
    expect(set.acceptsCandidate).toBe(true);
    expect(set.repeatIds).toBe(holdout4RepeatIds);
    expect(set.fixtures()).toEqual(holdout4MigrationFixtures);
    const fixtures = freshMigrationFixtures();
    expect(set.provenance(fixtures)).toMatchObject({
      writtenAfterBlindComparison: true,
      explanationLanguages: [...new Set(fixtures.map((fixture) => fixture.explanationLanguage))],
      candidateSelectedByBlindComparison: "gemini-3.8-flash-medium",
      humanTeacherCertificationClaimed: false,
    });
    expect(
      acceptanceCandidateIds.includes(
        String(set.provenance([]).candidateSelectedByBlindComparison),
      ),
    ).toBe(true);
  });
  it("hands each round a copy of the holdout 4 fixtures", () => {
    const set = migrationHoldoutSets[holdout4FixtureSetId];
    expect(set?.fixtures()).not.toBe(holdout4MigrationFixtures);
  });
});
