import type { ProviderSettings } from "../../packages/core/src/aip";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";

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
  /** Decoding constraint; direct json_object unless the candidate declares strict json_schema. */
  structuredOutputMode?: "json_schema" | "json_object";
  /** Request deadline for this model only; slower reasoning models need more than the default. */
  timeoutMs?: number;
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
    // A holdout-5 response exceeded the shared 90 s deadline; medium reasoning needs more.
    timeoutMs: 180000,
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
/**
 * Strict json_schema variants (2026-10-09), kept apart from the compared json_object set. Each
 * keeps its json_object twin's controls, so the decoding constraint is the only variable.
 */
export const schemaDecodingCandidates: Record<string, ComparisonCandidate> = {
  "gemini-3.8-flash-medium-schema": {
    model: "google/gemini-3.8-flash",
    reasoningEffort: "medium",
    maxOutputTokens: 32000,
    structuredOutputMode: "json_schema",
    timeoutMs: 180000,
  },
};
/** Every candidate a round may name with --candidate. */
export const evaluationCandidates: Record<string, ComparisonCandidate> = {
  ...comparisonCandidates,
  ...schemaDecodingCandidates,
};
/**
 * The only candidates a gated holdout may accept instead of the production config. The schema
 * twin runs every gate, but the unchanged adoption gate expects direct json_object, so its round
 * reports `transportMatchesAdoptionGate: false` and is never adoption eligible until the owner
 * versions a gate change.
 */
export const acceptanceCandidateIds: readonly string[] = [
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-medium-schema",
];

/**
 * A comparison round always names a candidate. Another round takes one only when its fixture set
 * is registered for candidate acceptance and the candidate is on the allow-list; otherwise it
 * evaluates the production config.
 */
export function resolveEvaluationCandidate(
  candidateId: string | undefined,
  round: { comparison: boolean; acceptsCandidate: boolean },
): { candidateId: string; candidate: ComparisonCandidate; acceptance: boolean } | undefined {
  if (candidateId === undefined) {
    if (round.comparison) throw new Error("comparison_requires_candidate");
    return undefined;
  }
  const candidate = Object.hasOwn(evaluationCandidates, candidateId)
    ? evaluationCandidates[candidateId]
    : undefined;
  if (!candidate) throw new Error("unknown_candidate");
  if (round.comparison) return { candidateId, candidate, acceptance: false };
  if (!round.acceptsCandidate) throw new Error("fixture_set_uses_production_config");
  if (!acceptanceCandidateIds.includes(candidateId))
    throw new Error("candidate_not_on_acceptance_allow_list");
  return { candidateId, candidate, acceptance: true };
}
export type EvaluatedCandidate = NonNullable<ReturnType<typeof resolveEvaluationCandidate>>;
/** The migration production model; a round without a candidate evaluates exactly this. */
export const productionMigrationModel = "anthropic/claude-haiku-5.5";

/**
 * A round evaluates either the production config on direct JSON or exactly the named candidate on
 * its declared decoding mode. Strict json_schema decoding needs a candidate that declares it.
 */
export function assertEvaluatedRoundSettings(
  settings: ProviderSettings,
  evaluated: EvaluatedCandidate | undefined,
) {
  const structuredOutputMode =
    settings.structuredModelOverrides?.[settings.llmModel]?.structuredOutputMode;
  const directJsonMode = structuredOutputMode === "json_object";
  if (
    !directJsonMode &&
    !(
      evaluated?.candidate.structuredOutputMode === "json_schema" &&
      structuredOutputMode === "json_schema"
    )
  )
    throw new Error("evaluated_transport_not_declared");
  if (settings.llmModel !== (evaluated ? evaluated.candidate.model : productionMigrationModel))
    throw new Error("evaluated_model_differs_from_config_or_candidate");
  return { structuredOutputMode, directJsonMode };
}

type CandidatePlanBlock = {
  candidateId: string;
  candidate: ComparisonCandidate;
  zdrEndpointMaximumRates: { promptRate: number; outputRate: number };
  zdrEndpointHash: string;
};
/**
 * Every candidate round reserves at the most expensive ZDR endpoint price, so it needs the captured
 * ZDR endpoint list and the model catalog. The plan block binds the candidate, the price maxima and
 * the list hash; an acceptance round also stops on the first-pass gate and leaves the production
 * config unchanged.
 */
export function evaluationCandidatePlan(input: {
  evaluated: EvaluatedCandidate | undefined;
  llmModel: string;
  catalog: unknown;
  zdrEndpoints: unknown;
}): {
  candidateRates?: { promptRate: number; outputRate: number };
  comparison?: CandidatePlanBlock & { firstPassGateStopsRound: false; blindReviewRequired: true };
  acceptanceCandidate?: CandidatePlanBlock & {
    firstPassGateStopsRound: true;
    productionConfigUnchanged: true;
  };
} {
  const { evaluated } = input;
  if (!evaluated) return {};
  if (input.zdrEndpoints === undefined || input.catalog === undefined)
    throw new Error("candidate_round_requires_zdr_endpoints_and_catalog");
  if (input.llmModel !== evaluated.candidate.model)
    throw new Error("evaluated_model_differs_from_config_or_candidate");
  const candidateRates = zdrEndpointMaximumRates(input.zdrEndpoints, input.llmModel, input.catalog);
  const block: CandidatePlanBlock = {
    candidateId: evaluated.candidateId,
    candidate: evaluated.candidate,
    zdrEndpointMaximumRates: candidateRates,
    zdrEndpointHash: sha256Hex(canonicalJson(input.zdrEndpoints)),
  };
  return evaluated.acceptance
    ? {
        candidateRates,
        acceptanceCandidate: {
          ...block,
          firstPassGateStopsRound: true,
          productionConfigUnchanged: true,
        },
      }
    : {
        candidateRates,
        comparison: { ...block, firstPassGateStopsRound: false, blindReviewRequired: true },
      };
}

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
        structuredOutputMode: candidate.structuredOutputMode ?? "json_object",
        ...(candidate.temperature === undefined ? { omitTemperature: true as const } : {}),
        knowledgeContract: "content" as const,
        ...(candidate.timeoutMs === undefined ? {} : { timeoutMs: candidate.timeoutMs }),
      },
    },
    modelMaximumMicros: { ...base.modelMaximumMicros, [candidate.model]: base.maximumMicros },
  };
}

type EndpointPricing = {
  prompt?: string;
  completion?: string;
  internal_reasoning?: string;
  overrides?: { prompt?: string; completion?: string; internal_reasoning?: string }[];
};
const rates = (values: (string | undefined)[]) =>
  values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);

/**
 * Highest price among the model's zero-retention endpoints, including long-context overrides and
 * internal reasoning, so a reserve never undercounts. With a model catalog, the output maximum
 * must reach at least the catalog completion price.
 */
export function zdrEndpointMaximumRates(zdrEndpoints: unknown, model: string, catalog?: unknown) {
  // The public list is { data: [...] }; accept a bare array as well.
  const list =
    zdrEndpoints && typeof zdrEndpoints === "object" && "data" in zdrEndpoints
      ? (zdrEndpoints as { data: unknown }).data
      : zdrEndpoints;
  const entries = (Array.isArray(list) ? list : []) as {
    model_id?: string;
    pricing?: EndpointPricing;
  }[];
  const prices = entries
    .filter((entry) => entry.model_id === model)
    .map(({ pricing }) => ({
      prompt: Number(pricing?.prompt),
      completion: Number(pricing?.completion),
      promptRates: rates([
        pricing?.prompt,
        ...(pricing?.overrides ?? []).map((override) => override.prompt),
      ]),
      outputRates: rates([
        pricing?.completion,
        pricing?.internal_reasoning,
        ...(pricing?.overrides ?? []).flatMap((override) => [
          override.completion,
          override.internal_reasoning,
        ]),
      ]),
    }))
    .filter((entry) => Number.isFinite(entry.prompt) && Number.isFinite(entry.completion));
  if (!prices.length) throw new Error("candidate_has_no_zdr_endpoint");
  const maximum = {
    promptRate: Math.max(...prices.flatMap((entry) => entry.promptRates)),
    outputRate: Math.max(...prices.flatMap((entry) => entry.outputRates)),
  };
  if (catalog !== undefined) {
    const data =
      catalog && typeof catalog === "object" && "data" in catalog
        ? (catalog as { data: unknown }).data
        : undefined;
    const listed = (Array.isArray(data) ? data : []).find(
      (entry: { id?: string }) => entry?.id === model,
    ) as { pricing?: { completion?: string } } | undefined;
    if (!listed) throw new Error("candidate_model_missing_from_catalog");
    const completion = Number(listed.pricing?.completion);
    if (!Number.isFinite(completion) || maximum.outputRate < completion)
      throw new Error("zdr_output_rate_below_catalog_completion_rate");
  }
  return maximum;
}
