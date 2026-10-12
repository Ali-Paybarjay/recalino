import { expect, it, vi } from "vitest";
import defaults from "../config/openrouter-defaults.json";
import {
  effectiveProviderTimeoutMs,
  effectiveStructuredMaxOutputTokens,
  effectiveVoiceCorrectionModel,
  longestProviderTimeoutMs,
  maximumProviderCost,
  OpenRouterProvider,
  providerSettingsSchema,
  transcriptSchema,
} from "../packages/core/src/aip";
import { DEFAULT_PLT_SETTINGS } from "../packages/core/src/plt/settings";
import { usesContentKnowledgeContract } from "../packages/core/src/proc/knowledge-contract";

it("does not request Anthropic's higher-price cache writes in the current cost-bound contract", async () => {
  // Anthropic cache writes require explicit top-level or block cache_control.
  // https://openrouter.ai/docs/guides/best-practices/prompt-caching
  const settings = providerSettingsSchema.parse({ ...defaults, dataContractApproved: true });
  // Every structured model of the config, including the Anthropic vision and correction model.
  for (const model of new Set([
    settings.llmModel,
    settings.visionModel,
    effectiveVoiceCorrectionModel(settings),
  ])) {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model,
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"text":"synthetic","language":null,"segments":[]}' },
            },
          ],
          usage: { cost: 0 },
        }),
      ),
    );
    await new OpenRouterProvider("synthetic-local-only-key", settings, request).structured({
      operationKey: "synthetic-cost-bound-cache-check",
      model,
      schema: transcriptSchema,
      schemaName: "synthetic",
      system: "Synthetic test",
      input: "Synthetic fixture",
    });
    expect(request).toHaveBeenCalledOnce();
    const call = request.mock.calls[0];
    if (!call) throw new Error("Expected mocked provider request");
    const body = JSON.parse(String(call[1]?.body));
    expect(body).not.toHaveProperty("cache_control");
    expect(JSON.stringify(body.messages)).not.toContain('"cache_control"');
  }
});

it("retains the verified Haiku 4.5 vision/rollback bound for its full input context", () => {
  // Public endpoint metadata, checked 2026-10-04. Regional endpoints add a 10% premium.
  // https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints
  const contextTokens = 200_000;
  const endpointUsdPerMillion = [
    { prompt: 1, completion: 5 },
    { prompt: 1.1, completion: 5.5 },
  ];
  const settings = providerSettingsSchema.parse(defaults);
  expect(settings.maxOutputTokens).toBe(6144);
  // The codepoint limit does not bound multilingual tokenization. Include all context tokens
  // (source text, system/schema and images), then separately reserve output for conservatism.
  for (const { prompt, completion } of endpointUsdPerMillion) {
    // Integer microUSD-per-million arithmetic avoids binary decimal rounding ambiguity.
    const promptMicrosPerMillion = Math.round(prompt * 1_000_000);
    const completionMicrosPerMillion = Math.round(completion * 1_000_000);
    const requiredMicros = Math.ceil(
      (contextTokens * promptMicrosPerMillion +
        settings.maxOutputTokens * completionMicrosPerMillion) /
        1_000_000,
    );
    expect(settings.visionModel).toBe("anthropic/claude-haiku-4.5");
    // Spoken corrections use the same model and cap; their input is bounded far below this context.
    for (const model of [settings.visionModel, effectiveVoiceCorrectionModel(settings)])
      expect(maximumProviderCost(settings, model)).toBeGreaterThanOrEqual(requiredMicros);
  }
  expect(settings.maximumMicros).toBeGreaterThanOrEqual(
    maximumProviderCost(settings, settings.llmModel),
  );
  expect(settings.dataContractApproved).toBe(true);
});

const gemini = "google/gemini-3.8-flash";
const haiku = "anthropic/claude-haiku-4.5";

it("FR-PROC-003 D56 selects Gemini 3.8 Flash on the content contract with its declared transport", () => {
  const settings = providerSettingsSchema.parse(defaults);
  expect(settings.version).toBe("openrouter-2026-10-12-1");
  expect(settings.llmModel).toBe(gemini);
  expect(settings.promptVersion).toBe("recalino-knowledge-11");
  expect(settings.priceVersion).toBe("openrouter-models-2026-10-09");
  expect(settings.structuredTemperature).toBe(0);
  // maxOutputTokens stays the content plan budget; only the Gemini transport cap is larger.
  expect(settings.maxOutputTokens).toBe(6144);
  expect(settings.structuredModelOverrides).toEqual({
    [gemini]: {
      maxOutputTokens: 32000,
      reasoningEffort: "medium",
      maxRequestBytes: 400000,
      structuredOutputMode: "json_schema",
      omitTemperature: true,
      knowledgeContract: "content",
      timeoutMs: 180000,
    },
  });
  expect(effectiveStructuredMaxOutputTokens(settings, gemini)).toBe(32000);
  // The selector reads the snapshot, not a model id: llmModel uses the content contract.
  expect(usesContentKnowledgeContract(settings)).toBe(true);
  expect(usesContentKnowledgeContract(settings, settings.visionModel)).toBe(false);
  expect(usesContentKnowledgeContract(settings, effectiveVoiceCorrectionModel(settings))).toBe(
    false,
  );
});

it("lesson-quality-1 proposes the content-scaled budget, source coverage and board structure", () => {
  const settings = providerSettingsSchema.parse(defaults);
  // Proposed in docs/plans/LESSON_QUALITY_2026-10-12.md; production keeps its own env JSON.
  expect(settings.lessonQuality).toEqual({
    version: "lesson-quality-1",
    budget: "lesson-budget-1",
    sourceCoverage: true,
    structuredBoard: true,
  });
  // No separate board model or class parts until the owner chooses them after evaluation.
  expect(settings.lessonQuality?.boardVisionModel).toBeUndefined();
  expect(settings.lessonQuality?.classPartMinutes).toBeUndefined();
  // The production snapshot of D56 has no lessonQuality and keeps the fixed planning budget.
  const { lessonQuality: _quality, ...previous } = settings;
  expect(providerSettingsSchema.parse(previous).lessonQuality).toBeUndefined();
});

it("FR-QUOTA-009 FR-QUOTA-010 D56 reserves a Gemini request at the highest captured ZDR endpoint price", () => {
  // Captured ZDR endpoint list for google/gemini-3.8-flash, snapshot 2026-10-09, from the
  // migration evidence openrouter-zdr-endpoints-2026-10-09.json (no inference request).
  // Verified test witnesses in USD per million tokens, not runtime rates. Reasoning tokens are
  // billed at the completion rate and count within max_tokens.
  const zdrEndpoints = [
    { tag: "google-vertex/global/priority", prompt: 1.35, completion: 6.75 },
    { tag: "google-vertex/global", prompt: 0.75, completion: 3.75 },
    { tag: "google-vertex/global/flex", prompt: 0.375, completion: 1.875 },
  ];
  const settings = providerSettingsSchema.parse(defaults);
  const maximumPromptBytes = settings.structuredModelOverrides?.[gemini]?.maxRequestBytes;
  if (maximumPromptBytes === undefined) throw new Error("Expected explicit text request bound");
  // A text token uses at least one UTF-8 byte, and the provider bounds the entire wire body
  // (schema and system prompt included) before dispatch, so bytes bound prompt tokens.
  const required = zdrEndpoints.map(({ prompt, completion }) =>
    Math.ceil(
      (maximumPromptBytes * Math.round(prompt * 1_000_000) +
        effectiveStructuredMaxOutputTokens(settings, gemini) * Math.round(completion * 1_000_000)) /
        1_000_000,
    ),
  );
  expect(required).toEqual([756000, 420000, 210000]);
  for (const micros of required)
    expect(micros).toBeLessThanOrEqual(maximumProviderCost(settings, gemini));
  // Owner decision 2026-10-10: reserve up to 0.76 USD per Gemini call.
  expect(maximumProviderCost(settings, gemini)).toBe(760000);
  expect(settings.maximumMicros).toBe(760000);
  expect(settings.modelMaximumMicros).toEqual({
    [gemini]: 760000,
    [haiku]: 300000,
    "openai/whisper-large-v3-turbo": 5000,
    "hexgrad/kokoro-82m": 5000,
  });
});

it("FR-VOC-008 D56 keeps vision and spoken corrections on Haiku 4.5 with its cap and sampling", async () => {
  const settings = providerSettingsSchema.parse({ ...defaults, dataContractApproved: true });
  expect(settings.visionModel).toBe(haiku);
  expect(settings.voiceCorrectionModel).toBe(haiku);
  expect(effectiveVoiceCorrectionModel(settings)).toBe(haiku);
  expect(settings.structuredModelOverrides?.[haiku]).toBeUndefined();
  for (const model of [settings.visionModel, effectiveVoiceCorrectionModel(settings)]) {
    expect(effectiveStructuredMaxOutputTokens(settings, model)).toBe(6144);
    expect(maximumProviderCost(settings, model)).toBe(300000);
    expect(effectiveProviderTimeoutMs(settings, model)).toBe(90000);
  }
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: haiku,
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"text":"synthetic","language":null,"segments":[]}' },
          },
        ],
        usage: { cost: 0 },
      }),
    ),
  );
  await new OpenRouterProvider("synthetic-local-only-key", settings, request).structured({
    operationKey: "synthetic-voice-model-sampling",
    model: effectiveVoiceCorrectionModel(settings),
    schema: transcriptSchema,
    schemaName: "synthetic",
    system: "Synthetic test",
    input: "Synthetic fixture",
  });
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(body.model).toBe(haiku);
  expect(body.temperature).toBe(0);
  expect(body.max_tokens).toBe(6144);
  expect(body).not.toHaveProperty("reasoning");
  expect(body.response_format.type).toBe("json_schema");
});

it("FR-PLT-005 D56 gives only Gemini a 180 s request deadline, well inside the function limit", () => {
  const settings = providerSettingsSchema.parse(defaults);
  expect(effectiveProviderTimeoutMs(settings, gemini)).toBe(180000);
  expect(settings.timeoutMs).toBe(90000);
  expect(longestProviderTimeoutMs(settings)).toBe(180000);
  // A live runner renews a running job's 120 s lease every quarter (rule 5), so a request may
  // outlast one lease period; a lapsed claim never repeats a paid request. The 800 s function
  // limit (ADR-0001) bounds the deadline instead, and the cron claim margin and processing wake
  // budget grow with it (apps/web/src/server/jobs.test.ts).
  expect(DEFAULT_PLT_SETTINGS.jobs.leaseSeconds).toBe(120);
  expect(longestProviderTimeoutMs(settings)).toBeLessThanOrEqual(800000 / 4);
});

it("reserves enough for a full five-minute STT chunk at every currently listed endpoint rate", () => {
  // Public OpenRouter endpoint metadata, checked 2026-10-04 (no inference request).
  // https://openrouter.ai/api/v1/models/openai/whisper-large-v3-turbo/endpoints
  const endpointUsdPerSecond = {
    DeepInfra: "0.00000333",
    Groq: "0.0000111111111111",
  };
  // The native preparer caps a dispatched chunk at 300000 ms.
  const maximumChunkSeconds = 300;
  const settings = providerSettingsSchema.parse(defaults);
  const heldMicros = maximumProviderCost(settings, settings.sttModel);
  for (const price of Object.values(endpointUsdPerSecond)) {
    const actualMicros = Math.ceil(maximumChunkSeconds * Number(price) * 1_000_000);
    expect(heldMicros).toBeGreaterThanOrEqual(actualMicros);
  }
  expect(heldMicros).toBeLessThanOrEqual(settings.maximumMicros);
  expect(settings.dataContractApproved).toBe(true);
});
