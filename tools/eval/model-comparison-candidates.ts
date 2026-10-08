import type { ProviderSettings } from "../../packages/core/src/aip";

/**
 * Cross-model comparison candidates (2026-10-08). Every candidate uses the same content-only
 * generation contract, direct JSON transport, ZDR routing and local validation; only the model,
 * reasoning effort, physical output cap and sampling differ. Gemini 3.5/3.8 ZDR endpoints do not
 * accept temperature, so with require_parameters it is omitted (provider default).
 */
export type ComparisonCandidate = {
  model: string;
  reasoningEffort?: "low" | "medium";
  maxOutputTokens: number;
  temperature?: number;
};
export const comparisonCandidates: Record<string, ComparisonCandidate> = {
  "gemini-3.8-flash-low": {
    model: "google/gemini-3.8-flash",
    reasoningEffort: "low",
    maxOutputTokens: 16000,
  },
  "gemini-3.8-flash-medium": {
    model: "google/gemini-3.8-flash",
    reasoningEffort: "medium",
    maxOutputTokens: 32000,
  },
  "gemini-3.5-flash-lite-low": {
    model: "google/gemini-3.5-flash-lite",
    reasoningEffort: "low",
    maxOutputTokens: 16000,
  },
  "gemini-3.5-flash-lite-medium": {
    model: "google/gemini-3.5-flash-lite",
    reasoningEffort: "medium",
    maxOutputTokens: 32000,
  },
  // Current production model and sampling, without reasoning, on the same contract.
  "claude-haiku-4.5": {
    model: "anthropic/claude-haiku-4.5",
    maxOutputTokens: 6144,
    temperature: 0,
  },
  "claude-haiku-5.5-low": {
    model: "anthropic/claude-haiku-5.5",
    reasoningEffort: "low",
    maxOutputTokens: 12000,
  },
};

/** Candidate settings derived from the versioned production defaults; nothing else changes. */
export function comparisonSettings(
  base: ProviderSettings,
  id: string,
  candidate: ComparisonCandidate,
): ProviderSettings {
  return {
    ...base,
    version: `${base.version}+comparison-${id}`,
    llmModel: candidate.model,
    ...(candidate.temperature === undefined
      ? { structuredTemperature: undefined }
      : { structuredTemperature: candidate.temperature }),
    structuredModelOverrides: {
      [candidate.model]: {
        maxOutputTokens: candidate.maxOutputTokens,
        ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}),
        maxRequestBytes: 400000,
        structuredOutputMode: "json_object",
        ...(candidate.temperature === undefined ? { omitTemperature: true as const } : {}),
      },
    },
    modelMaximumMicros: { ...base.modelMaximumMicros, [candidate.model]: base.maximumMicros },
  };
}

/** Highest price among the model's zero-retention endpoints, so a reserve never undercounts. */
export function zdrEndpointMaximumRates(zdrEndpoints: unknown, model: string) {
  // The public list is { data: [...] }; accept a bare array as well.
  const list =
    zdrEndpoints && typeof zdrEndpoints === "object" && "data" in zdrEndpoints
      ? (zdrEndpoints as { data: unknown }).data
      : zdrEndpoints;
  const entries = (Array.isArray(list) ? list : []) as {
    model_id?: string;
    pricing?: { prompt?: string; completion?: string };
  }[];
  const prices = entries
    .filter((entry) => entry.model_id === model)
    .map((entry) => ({
      prompt: Number(entry.pricing?.prompt),
      completion: Number(entry.pricing?.completion),
    }))
    .filter((entry) => Number.isFinite(entry.prompt) && Number.isFinite(entry.completion));
  if (!prices.length) throw new Error("candidate_has_no_zdr_endpoint");
  return {
    promptRate: Math.max(...prices.map((entry) => entry.prompt)),
    outputRate: Math.max(...prices.map((entry) => entry.completion)),
  };
}
