import { expect, it } from "vitest";
import defaults from "../config/openrouter-defaults.json";
import { maximumProviderCost, providerSettingsSchema } from "../packages/core/src/aip";

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
  expect(settings.dataContractApproved).toBe(false);
});
