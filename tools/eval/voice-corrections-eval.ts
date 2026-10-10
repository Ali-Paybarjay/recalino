import { z } from "../../packages/core/node_modules/zod";
import type { ProviderSettings } from "../../packages/core/src/aip";
import { isExplanationLanguage, matchesExplanationScript } from "../../packages/core/src/lkm";
import type { SpokenMistake } from "../../packages/core/src/voc";
import type { BuiltUtterance, BuiltVoiceCase, DistractorKind } from "./voice-corrections-fixtures";

/**
 * Spoken-mistake correction evaluation (2026-10-10). Both candidates run the production
 * `correctVoiceCandidates` request through `OpenRouterProvider`; only `voiceCorrectionModel`
 * and that model's own override differ. The rest of the settings is the release candidate
 * (knowledge on Gemini 3.8 Flash), so the voice step sees exactly what it would see after it.
 */
export const voiceEvalControls = {
  version: "voice-corrections-eval-1",
  /** A failed first answer gets one retry, as the learner's "try again" in the class view. */
  maximumAttemptsPerCase: 2,
  /** Two cases in flight; every in-flight reserve counts against the hard cap. */
  concurrency: 2,
  rateLimitRetries: 2,
} as const;

export const geminiVoiceOverride = {
  maxOutputTokens: 32000,
  reasoningEffort: "medium",
  maxRequestBytes: 400000,
  structuredOutputMode: "json_schema",
  omitTemperature: true,
  knowledgeContract: "content",
  timeoutMs: 180000,
} as const;

export interface VoiceEvalCandidate {
  id: string;
  model: string;
  label: string;
}
export const voiceEvalCandidates: VoiceEvalCandidate[] = [
  {
    id: "haiku-4.5-production",
    model: "anthropic/claude-haiku-4.5",
    label: "Haiku 4.5 (production voice path)",
  },
  {
    id: "gemini-3.8-flash-medium",
    model: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash, reasoning medium, strict json_schema",
  },
];

/** The release provider settings with the voice step pointed at one candidate model. */
export function voiceEvalSettings(voiceCorrectionModel: string): ProviderSettings {
  return {
    version: "openrouter-2026-10-10-voice-eval",
    llmModel: "google/gemini-3.8-flash",
    voiceCorrectionModel,
    visionModel: "anthropic/claude-haiku-4.5",
    sttModel: "openai/whisper-large-v3-turbo",
    ttsModel: "hexgrad/kokoro-82m",
    voice: "af_heart",
    promptVersion: "recalino-knowledge-9",
    structuredTemperature: 0,
    structuredModelOverrides: { "google/gemini-3.8-flash": { ...geminiVoiceOverride } },
    maxInputCharacters: 120000,
    maxOutputTokens: 6144,
    timeoutMs: 90000,
    maximumMicros: 760000,
    modelMaximumMicros: {
      "google/gemini-3.8-flash": 760000,
      "anthropic/claude-haiku-4.5": 300000,
      "openai/whisper-large-v3-turbo": 5000,
      "hexgrad/kokoro-82m": 5000,
    },
    currency: "USD",
    priceVersion: "openrouter-models-2026-10-09",
    charactersPerPage: 3000,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
  };
}

/** Production c50c018 `config/openrouter-defaults.json`: the voice step uses llmModel Haiku 4.5. */
export const productionC50c018Settings: ProviderSettings = {
  version: "openrouter-2026-10-08-1",
  llmModel: "anthropic/claude-haiku-4.5",
  visionModel: "anthropic/claude-haiku-4.5",
  sttModel: "openai/whisper-large-v3-turbo",
  ttsModel: "hexgrad/kokoro-82m",
  voice: "af_heart",
  promptVersion: "recalino-knowledge-5",
  structuredTemperature: 0,
  maxInputCharacters: 120000,
  maxOutputTokens: 6144,
  timeoutMs: 90000,
  maximumMicros: 300000,
  modelMaximumMicros: {
    "anthropic/claude-haiku-4.5": 300000,
    "openai/whisper-large-v3-turbo": 5000,
    "hexgrad/kokoro-82m": 5000,
  },
  currency: "USD",
  priceVersion: "openrouter-models-2026-10-04",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};

const endpointSchema = z.object({
  model_id: z.string(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    internal_reasoning: z.string().optional(),
  }),
});
/** The most expensive ZDR endpoint for the model; the reserve never assumes the cheap route. */
export function zdrMaximumRates(endpoints: unknown, model: string) {
  const raw = z
    .union([z.array(z.unknown()), z.object({ data: z.array(z.unknown()) })])
    .parse(endpoints);
  const rows = (Array.isArray(raw) ? raw : raw.data).flatMap((row) => {
    const parsed = endpointSchema.safeParse(row);
    return parsed.success && parsed.data.model_id === model ? [parsed.data] : [];
  });
  if (!rows.length) throw new Error(`zdr_endpoint_missing:${model}`);
  const prompt = Math.max(...rows.map((row) => Number(row.pricing.prompt)));
  const output = Math.max(
    ...rows.flatMap((row) => [
      Number(row.pricing.completion),
      Number(row.pricing.internal_reasoning ?? row.pricing.completion),
    ]),
  );
  if (![prompt, output].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("invalid_zdr_price");
  return { prompt, output, endpoints: rows.length };
}
/** UTF-8 bytes bound the input tokens; max_tokens bounds output including reasoning. */
export function voiceRequestReserveUsd(
  rates: { prompt: number; output: number },
  body: string,
  maxTokens: number,
): number {
  return Buffer.byteLength(body, "utf8") * rates.prompt + maxTokens * rates.output;
}

export function assertWithinHardBudget(input: {
  spentUsd: number;
  uncertainUsd: number;
  inFlightUsd: number;
  reserveUsd: number;
  hardUsd: number;
}) {
  const values = Object.values(input);
  if (!values.every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("invalid_budget_values");
  if (input.spentUsd + input.uncertainUsd + input.inFlightUsd + input.reserveUsd > input.hardUsd)
    throw new Error("hard_budget_before_dispatch");
}

export type SuggestionClass =
  | { type: "planted"; errorId: string }
  | { type: "trap"; trapId: string }
  | { type: "distractor"; kind: DistractorKind }
  | { type: "other" }
  | { type: "unknown_utterance" };
export interface ModelSuggestion extends Omit<SpokenMistake, "explanationLanguage"> {
  speakerId: string;
}

const plain = (value: string) =>
  value.replaceAll("**", "").replace(/\s+/gu, " ").trim().toLowerCase();
const hasWord = (text: string, word: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}'’])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}'’])`,
    "u",
  ).test(plain(text));

/**
 * Gold position of one suggestion. A planted-error turn holds exactly one planted error and
 * nothing else wrong; trap, distractor and neutral turns hold no learner error at all.
 */
export function classifySuggestion(
  built: BuiltVoiceCase,
  suggestion: Pick<ModelSuggestion, "utteranceId" | "said">,
): SuggestionClass {
  const utterance = built.utterances.find((item) => item.id === suggestion.utteranceId);
  if (!utterance) return { type: "unknown_utterance" };
  const mark = utterance.mark;
  if (mark?.e) {
    const planted = built.fixture.errors.find((item) => item.id === mark.e);
    if (planted?.keys.some((key) => hasWord(suggestion.said, key)))
      return { type: "planted", errorId: planted.id };
    return { type: "other" };
  }
  if (mark?.k) return { type: "trap", trapId: mark.k };
  if (mark?.d) return { type: "distractor", kind: mark.d };
  return { type: "other" };
}

export function flattenSuggestions(output: unknown): ModelSuggestion[] {
  const parsed = z
    .object({
      candidates: z.array(
        z.object({
          speakerId: z.string(),
          mistakes: z.array(z.record(z.string(), z.unknown())),
        }),
      ),
    })
    .safeParse(output);
  if (!parsed.success) return [];
  return parsed.data.candidates.flatMap((candidate) =>
    candidate.mistakes.map(
      (mistake) => ({ ...mistake, speakerId: candidate.speakerId }) as unknown as ModelSuggestion,
    ),
  );
}

/**
 * Why `validateVoiceCorrections` rejected a schema-valid answer. Diagnostic only; the
 * production function itself decides validity.
 */
export function evidenceDiagnostics(
  built: BuiltVoiceCase,
  output: unknown,
  language: string,
): string[] {
  const words = (text: string) => text.replaceAll("**", "").replace(/\s+/g, " ").trim();
  const issues = new Set<string>();
  const parsed = z
    .object({
      candidates: z.array(
        z.object({
          speakerId: z.string(),
          mistakes: z.array(
            z.object({
              utteranceId: z.string(),
              said: z.string(),
              correct: z.string(),
              whyFa: z.string(),
            }),
          ),
        }),
      ),
    })
    .safeParse(output);
  if (!parsed.success) return ["shape"];
  const candidateIds = new Set(built.analysis.candidates.map((item) => item.id));
  const seen = new Set<string>();
  for (const candidate of parsed.data.candidates) {
    if (!candidateIds.has(candidate.speakerId)) issues.add("unknown_speaker");
    if (seen.has(candidate.speakerId)) issues.add("duplicate_speaker");
    seen.add(candidate.speakerId);
    for (const mistake of candidate.mistakes) {
      const utterance = built.analysis.utterances.find((item) => item.id === mistake.utteranceId);
      if (!utterance) issues.add("unknown_utterance");
      else if (utterance.speakerId !== candidate.speakerId)
        issues.add("utterance_of_other_speaker");
      else if (!utterance.eligible) issues.add("ineligible_utterance");
      else if (!words(utterance.text).includes(words(mistake.said)))
        issues.add("said_not_verbatim");
      if (!words(mistake.said)) issues.add("empty_said");
      if (words(mistake.said) === words(mistake.correct)) issues.add("said_equals_correct");
      if (!matchesExplanationScript(mistake.whyFa, language)) issues.add("explanation_script");
    }
  }
  return [...issues];
}

export function supportedLanguage(language: string) {
  return isExplanationLanguage(language);
}

export function utteranceLabel(utterance: BuiltUtterance) {
  return `U${String(utterance.index + 1).padStart(2, "0")}`;
}

/** Nearest-rank percentile; latency samples are few, so no interpolation. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ??
    null
  );
}

/** Deterministic per-case label order, so the blind key is reproducible from the seed. */
export function blindOrder(seed: string, caseId: string): [string, string] {
  let hash = 2166136261;
  for (const character of `${seed}:${caseId}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0
    ? ["haiku-4.5-production", "gemini-3.8-flash-medium"]
    : ["gemini-3.8-flash-medium", "haiku-4.5-production"];
}

export const criticalIssueTypes = [
  "false_correction",
  "wrong_correction",
  "wrong_explanation",
  "wrong_language",
  "injection_followed",
] as const;
export const reviewSchema = z.strictObject({
  language: z.enum(["fa", "ar", "es", "ja", "uk"]),
  grader: z.string().min(1),
  cases: z.array(
    z.strictObject({
      caseId: z.string(),
      outputs: z.array(
        z.strictObject({
          label: z.enum(["X", "Y"]),
          suggestions: z.array(
            z.strictObject({
              id: z.string(),
              genuineLearnerError: z.boolean(),
              correctionOk: z.boolean(),
              explanationCorrect: z.boolean(),
              explanationInRequestedLanguage: z.boolean(),
              score: z.number().int().min(1).max(4),
              critical: z.array(z.enum(criticalIssueTypes)),
              note: z.string(),
            }),
          ),
          outputCritical: z.array(z.enum(criticalIssueTypes)),
          overall: z.number().int().min(1).max(4).nullable(),
          note: z.string(),
        }),
      ),
    }),
  ),
});
export type VoiceReview = z.infer<typeof reviewSchema>;

export interface MergedSuggestionVerdict {
  genuineLearnerError: boolean;
  correctionOk: boolean;
  explanationCorrect: boolean;
  explanationInRequestedLanguage: boolean;
  score: number;
  critical: string[];
  graders: number;
}
/**
 * Conservative merge: any grader's critical issue counts (union), the lowest score stands, and
 * a property holds only if every grader affirmed it.
 */
export function mergeSuggestionVerdicts(
  verdicts: VoiceReview["cases"][number]["outputs"][number]["suggestions"],
): MergedSuggestionVerdict {
  if (!verdicts.length) throw new Error("no_verdicts");
  return {
    genuineLearnerError: verdicts.every((item) => item.genuineLearnerError),
    correctionOk: verdicts.every((item) => item.correctionOk),
    explanationCorrect: verdicts.every((item) => item.explanationCorrect),
    explanationInRequestedLanguage: verdicts.every((item) => item.explanationInRequestedLanguage),
    score: Math.min(...verdicts.map((item) => item.score)),
    critical: [...new Set(verdicts.flatMap((item) => item.critical))].sort(),
    graders: verdicts.length,
  };
}
