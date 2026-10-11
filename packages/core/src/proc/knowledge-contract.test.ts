import { describe, expect, it } from "vitest";
import { type ProviderSettings, providerSettingsSchema } from "../aip";
import { usesContentKnowledgeContract } from "./knowledge-contract";

const base: ProviderSettings = {
  version: "synthetic-contract",
  llmModel: "anthropic/claude-haiku-4.5",
  visionModel: "anthropic/claude-haiku-4.5",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "recalino-knowledge-7",
  maxInputCharacters: 120000,
  maxOutputTokens: 6144,
  structuredTemperature: 0,
  timeoutMs: 90000,
  maximumMicros: 300000,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const gemini = "google/gemini-3.8-flash";

describe("FR-PROC-003 settings-selected knowledge contract", () => {
  it("keeps the content contract for legacy Haiku 5.5 snapshots without the field", () => {
    expect(
      usesContentKnowledgeContract({
        ...base,
        llmModel: "anthropic/claude-haiku-5.5",
        structuredModelOverrides: {
          "anthropic/claude-haiku-5.5": { maxOutputTokens: 12000, reasoningEffort: "low" },
        },
      }),
    ).toBe(true);
    expect(usesContentKnowledgeContract({ ...base, llmModel: "anthropic/claude-haiku-5.5" })).toBe(
      true,
    );
  });

  it("selects the content contract only for the model whose override names it", () => {
    const configured: ProviderSettings = {
      ...base,
      llmModel: gemini,
      structuredModelOverrides: {
        [gemini]: {
          maxOutputTokens: 32000,
          reasoningEffort: "medium",
          knowledgeContract: "content",
        },
      },
    };
    expect(usesContentKnowledgeContract(configured)).toBe(true);
    // The vision model and every other model keep the legacy contract.
    expect(usesContentKnowledgeContract(configured, configured.visionModel)).toBe(false);
    expect(
      usesContentKnowledgeContract({
        ...configured,
        structuredModelOverrides: { [gemini]: { maxOutputTokens: 32000 } },
      }),
    ).toBe(false);
    // A field on another model's override never changes llmModel's contract.
    expect(
      usesContentKnowledgeContract({
        ...base,
        structuredModelOverrides: { [gemini]: { knowledgeContract: "content" } },
      }),
    ).toBe(false);
    expect(usesContentKnowledgeContract(base)).toBe(false);
    expect(usesContentKnowledgeContract({ ...base, llmModel: "synthetic/llm" })).toBe(false);
  });

  it("accepts only the content value in a settings snapshot", () => {
    const parse = (knowledgeContract: unknown) =>
      providerSettingsSchema.safeParse({
        ...base,
        llmModel: gemini,
        structuredModelOverrides: { [gemini]: { knowledgeContract } },
      }).success;
    expect(parse("content")).toBe(true);
    expect(parse("legacy")).toBe(false);
    expect(parse(true)).toBe(false);
    expect(parse(1)).toBe(false);
    expect(providerSettingsSchema.safeParse(base).success).toBe(true);
  });
});
