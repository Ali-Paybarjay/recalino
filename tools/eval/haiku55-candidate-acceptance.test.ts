import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "../../packages/core/node_modules/zod";
import {
  OpenRouterProvider,
  type ProviderSettings,
  providerSettingsSchema,
} from "../../packages/core/src/aip";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import { holdoutFixtureSetId } from "./haiku55-holdout-fixtures";
import {
  holdout4FixtureSetId,
  holdout5FixtureSetId,
  migrationHoldoutSets,
} from "./haiku55-holdout-registry";
import { holdout3FixtureSetId } from "./haiku55-holdout3-fixtures";
import { freshMigrationFixtures } from "./haiku55-migration-fixtures";
import {
  MigrationControlInterruption,
  migrationDispatchPreflight,
  migrationRequestReserve,
} from "./haiku55-migration-guards";
import {
  acceptanceCandidateIds,
  assertEvaluatedRoundSettings,
  comparisonCandidates,
  comparisonSettings,
  evaluationCandidatePlan,
  evaluationCandidates,
  productionMigrationModel,
  resolveEvaluationCandidate,
  schemaDecodingCandidates,
  zdrEndpointMaximumRates,
} from "./model-comparison-candidates";
import { holdout4MigrationFixtures, holdout4RepeatIds } from "./multilingual-holdout4-fixtures";
import { holdout5MigrationFixtures, holdout5RepeatIds } from "./multilingual-holdout5-fixtures";

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
      [
        holdoutFixtureSetId,
        holdout3FixtureSetId,
        holdout4FixtureSetId,
        holdout5FixtureSetId,
      ].sort(),
    );
    const set = migrationHoldoutSets[holdout4FixtureSetId];
    if (!set) throw new Error("Missing holdout 4");
    expect(set.acceptsCandidate).toBe(true);
    expect(set.repeatIds).toBe(holdout4RepeatIds);
    expect(set.fixtures()).toEqual(holdout4MigrationFixtures());
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
  it("registers multilingual holdout 5, written after holdout 4, for the same candidate", () => {
    expect(holdout5FixtureSetId).toBe("multilingual-holdout-5");
    const set = migrationHoldoutSets[holdout5FixtureSetId];
    if (!set) throw new Error("Missing holdout 5");
    expect(set.acceptsCandidate).toBe(true);
    expect(set.repeatIds).toBe(holdout5RepeatIds);
    expect(set.fixtures()).toEqual(holdout5MigrationFixtures());
    const fixtures = holdout5MigrationFixtures();
    const earlier = migrationHoldoutSets[holdout4FixtureSetId]?.provenance(fixtures);
    expect(set.provenance(fixtures)).toEqual({ ...earlier, writtenAfterHoldout4: true });
    expect(set.provenance(fixtures)).toMatchObject({
      writtenAfterBlindComparison: true,
      explanationLanguages: ["fa", "ar", "es", "ja", "uk"],
      candidateSelectedByBlindComparison: "gemini-3.8-flash-medium",
      humanTeacherCertificationClaimed: false,
    });
    expect(
      acceptanceCandidateIds.includes(
        String(set.provenance([]).candidateSelectedByBlindComparison),
      ),
    ).toBe(true);
  });
  it("hands each round a copy of the holdout 4 and holdout 5 fixtures", () => {
    for (const id of [holdout4FixtureSetId, holdout5FixtureSetId]) {
      const set = migrationHoldoutSets[id];
      expect(set?.fixtures()).not.toBe(set?.fixtures());
      expect(set?.fixtures()).toEqual(set?.fixtures());
    }
  });
});

const production = async () =>
  providerSettingsSchema.parse(
    JSON.parse(await readFile(resolve("config/openrouter-defaults.json"), "utf8")),
  );
const resolved = (id: string) => {
  const evaluated = resolveEvaluationCandidate(id, {
    comparison: false,
    acceptsCandidate: true,
  });
  if (!evaluated) throw new Error("Missing candidate");
  return evaluated;
};
const candidateRoundSettings = async (id: string) => {
  const evaluated = resolved(id);
  return providerSettingsSchema.parse(
    comparisonSettings(await production(), evaluated.candidateId, evaluated.candidate),
  );
};

describe("FR-PROC-003 evaluated round settings", () => {
  it("evaluates production config on direct JSON or exactly the candidate on its declared mode", async () => {
    expect(assertEvaluatedRoundSettings(await production(), undefined)).toEqual({
      structuredOutputMode: "json_object",
      directJsonMode: true,
    });
    expect((await production()).llmModel).toBe(productionMigrationModel);
    expect(
      assertEvaluatedRoundSettings(
        await candidateRoundSettings("gemini-3.8-flash-medium"),
        resolved("gemini-3.8-flash-medium"),
      ),
    ).toEqual({ structuredOutputMode: "json_object", directJsonMode: true });
    expect(
      assertEvaluatedRoundSettings(
        await candidateRoundSettings("gemini-3.8-flash-medium-schema"),
        resolved("gemini-3.8-flash-medium-schema"),
      ),
    ).toEqual({ structuredOutputMode: "json_schema", directJsonMode: false });
  });
  it("rejects an acceptance model mismatch or an injected production model", async () => {
    const lite = comparisonCandidates["gemini-3.5-flash-lite-medium"];
    if (!lite) throw new Error("Missing candidate");
    const liteSettings = providerSettingsSchema.parse(
      comparisonSettings(await production(), "gemini-3.5-flash-lite-medium", lite),
    );
    expect(() =>
      assertEvaluatedRoundSettings(liteSettings, resolved("gemini-3.8-flash-medium")),
    ).toThrow("evaluated_model_differs_from_config_or_candidate");
    expect(() => assertEvaluatedRoundSettings(liteSettings, undefined)).toThrow(
      "evaluated_model_differs_from_config_or_candidate",
    );
  });
  it("allows strict schema decoding only for a candidate that declares it", async () => {
    const schemaSettings = await candidateRoundSettings("gemini-3.8-flash-medium-schema");
    expect(() =>
      assertEvaluatedRoundSettings(schemaSettings, resolved("gemini-3.8-flash-medium")),
    ).toThrow("evaluated_transport_not_declared");
    const base = await production();
    const override = base.structuredModelOverrides?.[productionMigrationModel];
    const nativeProduction: ProviderSettings = {
      ...base,
      structuredModelOverrides: {
        [productionMigrationModel]: { ...override, structuredOutputMode: "json_schema" },
      },
    };
    expect(() => assertEvaluatedRoundSettings(nativeProduction, undefined)).toThrow(
      "evaluated_transport_not_declared",
    );
  });
});

describe("FR-QUOTA-009 candidate round plan block", () => {
  it("binds the acceptance candidate, its ZDR maxima and list hash with exactly these keys", () => {
    const evaluated = resolved("gemini-3.8-flash-medium");
    const plan = evaluationCandidatePlan({ evaluated, llmModel: gemini, catalog, zdrEndpoints });
    const rates = { promptRate: 0.00000135, outputRate: 0.00000675 };
    expect(plan).toEqual({
      candidateRates: rates,
      acceptanceCandidate: {
        candidateId: "gemini-3.8-flash-medium",
        candidate: comparisonCandidates["gemini-3.8-flash-medium"],
        zdrEndpointMaximumRates: rates,
        zdrEndpointHash: sha256Hex(canonicalJson(zdrEndpoints)),
        firstPassGateStopsRound: true,
        productionConfigUnchanged: true,
      },
    });
    expect(Object.keys(plan.acceptanceCandidate ?? {}).sort()).toEqual([
      "candidate",
      "candidateId",
      "firstPassGateStopsRound",
      "productionConfigUnchanged",
      "zdrEndpointHash",
      "zdrEndpointMaximumRates",
    ]);
  });
  it("keeps the comparison block unchanged and adds nothing for a production round", () => {
    const evaluated = resolveEvaluationCandidate("gemini-3.8-flash-low", {
      comparison: true,
      acceptsCandidate: false,
    });
    const plan = evaluationCandidatePlan({ evaluated, llmModel: gemini, catalog, zdrEndpoints });
    expect(plan.acceptanceCandidate).toBeUndefined();
    expect(plan.comparison).toEqual({
      candidateId: "gemini-3.8-flash-low",
      candidate: comparisonCandidates["gemini-3.8-flash-low"],
      zdrEndpointMaximumRates: plan.candidateRates,
      zdrEndpointHash: sha256Hex(canonicalJson(zdrEndpoints)),
      firstPassGateStopsRound: false,
      blindReviewRequired: true,
    });
    expect(
      evaluationCandidatePlan({
        evaluated: undefined,
        llmModel: productionMigrationModel,
        catalog: undefined,
        zdrEndpoints: undefined,
      }),
    ).toEqual({});
  });
  it("needs both the ZDR endpoint list and the model catalog for every candidate round", () => {
    for (const evaluated of [
      resolved("gemini-3.8-flash-medium"),
      resolved("gemini-3.8-flash-medium-schema"),
    ]) {
      expect(() =>
        evaluationCandidatePlan({ evaluated, llmModel: gemini, catalog, zdrEndpoints: undefined }),
      ).toThrow("candidate_round_requires_zdr_endpoints_and_catalog");
      expect(() =>
        evaluationCandidatePlan({ evaluated, llmModel: gemini, catalog: undefined, zdrEndpoints }),
      ).toThrow("candidate_round_requires_zdr_endpoints_and_catalog");
      expect(() =>
        evaluationCandidatePlan({
          evaluated,
          llmModel: productionMigrationModel,
          catalog,
          zdrEndpoints,
        }),
      ).toThrow("evaluated_model_differs_from_config_or_candidate");
    }
  });
});

describe("FR-PROC-003 FR-QUOTA-009 checks before any paid dispatch", () => {
  const probeSchema = z.strictObject({ verdict: z.enum(["alpha"]) });
  const structuredInput = (model: string) => ({
    operationKey: "operation",
    model,
    schema: probeSchema,
    schemaName: "preflight_probe",
    system: "Synthetic system prompt.",
    input: "Synthetic lesson text.",
  });
  // Captures the production adapter's request body without reaching the network.
  const capture = async (settings: ProviderSettings) => {
    let captured: { serialized: string; operationKey: string } | undefined;
    const provider = new OpenRouterProvider("synthetic-key", settings, async (_url, init) => {
      captured = {
        serialized: String(init?.body),
        operationKey: new Headers(init?.headers).get("Idempotency-Key") ?? "",
      };
      throw new MigrationControlInterruption("captured");
    });
    await provider.structured(structuredInput(settings.llmModel)).catch(() => undefined);
    if (!captured) throw new Error("Missing captured request");
    return captured;
  };
  const url = "https://openrouter.ai/api/v1/chat/completions";
  it("blocks a json_schema round's json_object fallback before it reaches the network", async () => {
    const settings = await candidateRoundSettings("gemini-3.8-flash-medium-schema");
    const rates = zdrEndpointMaximumRates(zdrEndpoints, gemini, catalog);
    const network: { responseFormat: string; reserveUsd: number; bytes: number }[] = [];
    const blocked: string[] = [];
    const provider = new OpenRouterProvider("synthetic-key", settings, async (requestUrl, init) => {
      const serialized = String(init?.body);
      const operationKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
      const preflight = migrationDispatchPreflight({
        url: String(requestUrl),
        serialized,
        operationKey,
        settings,
        structuredOutputMode: "json_schema",
        candidateRates: rates,
        catalog,
      });
      if (preflight.unexpectedTransport) {
        blocked.push(operationKey);
        throw new MigrationControlInterruption("unexpected_transport_gate_failed");
      }
      network.push({
        responseFormat: preflight.body.response_format.type,
        reserveUsd: preflight.reserve.reserveUsd,
        bytes: Buffer.byteLength(serialized, "utf8"),
      });
      // The grammar compiler rejects the schema, which makes the adapter try its JSON fallback.
      return new Response(
        JSON.stringify({ error: { message: "Provider schema is too complex for compilation" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });
    await expect(provider.structured(structuredInput(gemini))).rejects.toThrow();
    expect(blocked).toEqual(["operation:json"]);
    expect(network).toHaveLength(1);
    const [first] = network;
    expect(first?.responseFormat).toBe("json_schema");
    expect(first?.reserveUsd).toBeCloseTo(
      (first?.bytes ?? 0) * rates.promptRate + 32000 * rates.outputRate,
    );
  });
  it("reserves a production round at the catalog maximum and refuses any other transport", async () => {
    const settings = await production();
    const request = await capture(settings);
    const haikuCatalog = {
      data: [
        {
          id: productionMigrationModel,
          pricing: { prompt: "0.000001", completion: "0.000005" },
        },
      ],
    };
    const preflight = (change: Partial<Parameters<typeof migrationDispatchPreflight>[0]> = {}) =>
      migrationDispatchPreflight({
        url,
        ...request,
        settings,
        structuredOutputMode: "json_object",
        catalog: haikuCatalog,
        ...change,
      });
    const accepted = preflight();
    if (accepted.unexpectedTransport) throw new Error("Unexpected transport");
    expect(accepted.reserve).toEqual(
      migrationRequestReserve(haikuCatalog, productionMigrationModel, request.serialized, 12000),
    );
    expect(preflight({ structuredOutputMode: "json_schema" })).toEqual({
      unexpectedTransport: true,
    });
    expect(preflight({ operationKey: "operation:json" })).toEqual({ unexpectedTransport: true });
  });
  it("refuses a request whose route, sampling or caps differ from the evaluated settings", async () => {
    const settings = await candidateRoundSettings("gemini-3.8-flash-medium");
    const request = await capture(settings);
    const body = JSON.parse(request.serialized) as Record<string, unknown>;
    const check = (edited: Record<string, unknown>, requestUrl = url) =>
      migrationDispatchPreflight({
        url: requestUrl,
        serialized: JSON.stringify(edited),
        operationKey: request.operationKey,
        settings,
        structuredOutputMode: "json_object",
        candidateRates: zdrEndpointMaximumRates(zdrEndpoints, gemini, catalog),
        catalog,
      });
    expect(check(body).unexpectedTransport).toBe(false);
    expect(() => check(body, "https://example.invalid/v1/chat/completions")).toThrow();
    expect(() => check({ ...body, model: "google/gemini-3.8-flash-lite" })).toThrow();
    expect(() => check({ ...body, provider: { zdr: false } })).toThrow();
    expect(() => check({ ...body, temperature: 0 })).toThrow("Sampling must match");
    expect(() => check({ ...body, top_p: 0.9 })).toThrow("Sampling must match");
    expect(() => check({ ...body, max_tokens: 64000 })).toThrow("Physical token cap");
    expect(() => check({ ...body, reasoning: { effort: "low" } })).toThrow();
    expect(() => check({ ...body, padding: "x".repeat(400001) })).toThrow("Physical request bytes");
  });
});
