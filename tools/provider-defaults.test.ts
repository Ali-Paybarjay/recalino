import { expect, it, vi } from "vitest";
import defaults from "../config/openrouter-defaults.json";
import {
  effectiveStructuredMaxOutputTokens,
  maximumProviderCost,
  OpenRouterProvider,
  providerSettingsSchema,
  transcriptSchema,
} from "../packages/core/src/aip";

it("does not request Anthropic's higher-price cache writes in the current cost-bound contract", async () => {
  // Anthropic cache writes require explicit top-level or block cache_control.
  // https://openrouter.ai/docs/guides/best-practices/prompt-caching
  const settings = providerSettingsSchema.parse({ ...defaults, dataContractApproved: true });
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: settings.llmModel,
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
    model: settings.llmModel,
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
    expect(maximumProviderCost(settings, settings.visionModel)).toBeGreaterThanOrEqual(
      requiredMicros,
    );
  }
  expect(settings.maximumMicros).toBeGreaterThanOrEqual(
    maximumProviderCost(settings, settings.llmModel),
  );
  expect(settings.dataContractApproved).toBe(true);
});

it("bounds Haiku 5.5 text requests including long-context regional prices and reasoning output", () => {
  // Public endpoint catalog checked 2026-10-08; these are verified test witnesses, not runtime rates.
  // https://openrouter.ai/api/v1/models/anthropic/claude-haiku-5.5/endpoints
  // A text token uses at least one UTF-8 byte. The provider bounds the entire native/fallback
  // wire body, rejects images under this text bound, and requests no higher-price cache writes.
  const settings = providerSettingsSchema.parse(defaults);
  const model = "anthropic/claude-haiku-5.5";
  expect(settings.llmModel).toBe(model);
  expect(settings.maxOutputTokens).toBe(6144);
  expect(settings.promptVersion).toBe("recalino-knowledge-5");
  expect(settings.structuredModelOverrides?.[model]).toEqual({
    maxOutputTokens: 12000,
    reasoningEffort: "low",
    maxRequestBytes: 400000,
    structuredOutputMode: "json_object",
  });
  const maximumPromptBytes = settings.structuredModelOverrides?.[model]?.maxRequestBytes;
  if (maximumPromptBytes === undefined) throw new Error("Expected explicit text request bound");
  // Use the >100k input tier even for smaller requests; include the 10% regional premium.
  for (const rate of [
    { prompt: 500000, completion: 2500000 },
    { prompt: 550000, completion: 2750000 },
  ]) {
    const requiredMicros = Math.ceil(
      (maximumPromptBytes * rate.prompt +
        effectiveStructuredMaxOutputTokens(settings, model) * rate.completion) /
        1000000,
    );
    expect(maximumProviderCost(settings, model)).toBeGreaterThanOrEqual(requiredMicros);
    expect(requiredMicros).toBeLessThanOrEqual(253000);
  }
  expect(maximumProviderCost(settings, model)).toBe(300000);
  expect(settings.visionModel).toBe("anthropic/claude-haiku-4.5");
  expect(effectiveStructuredMaxOutputTokens(settings, settings.visionModel)).toBe(6144);
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
