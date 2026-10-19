import { z } from "zod";
import { errors } from "../plt";

export const providerSettingsSchema = z.strictObject({
  version: z.string().min(1).max(100),
  llmModel: z.string().min(1).max(200),
  /** Spoken-mistake corrections; absent in older snapshots, which keep using llmModel. */
  voiceCorrectionModel: z.string().min(1).max(200).optional(),
  visionModel: z.string().min(1).max(200),
  sttModel: z.string().min(1).max(200),
  ttsModel: z.string().min(1).max(200),
  voice: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(100),
  maxInputCharacters: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  structuredTemperature: z.number().min(0).max(1).optional(),
  structuredModelOverrides: z
    .record(
      z.string().min(1).max(200),
      z.strictObject({
        maxOutputTokens: z.number().int().positive().max(128000).optional(),
        reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
        maxRequestBytes: z.number().int().positive().safe().optional(),
        structuredOutputMode: z.enum(["json_schema", "json_object"]).optional(),
        /** The model rejects non-default sampling, so structuredTemperature is never sent. */
        omitTemperature: z.literal(true).optional(),
        /** As llmModel, generate knowledge with the content-only contract and its two-generation cap. */
        knowledgeContract: z.literal("content").optional(),
        /** A slower reasoning model's request deadline; every other model keeps timeoutMs. */
        timeoutMs: z.number().int().positive().max(600000).optional(),
      }),
    )
    .optional(),
  /**
   * Lesson quality (lesson-quality-1). Absent in older snapshots, which keep the fixed planning
   * budget, the plain OCR prompt and a single lesson call exactly as before.
   */
  lessonQuality: z
    .strictObject({
      version: z.literal("lesson-quality-1"),
      /** Item limits from the model's own output limit and the measured class material. */
      budget: z.literal("lesson-budget-1"),
      /** Every source with extracted text is cited or listed as not used, with a reason code. */
      sourceCoverage: z.boolean(),
      /** Photos and scanned pages keep typed blocks, reading order and uncertainty. */
      structuredBoard: z.boolean(),
      /** Photos not already marked as personal notes use this model; PDF pages keep visionModel. */
      boardVisionModel: z.string().min(1).max(200).optional(),
      /** D17: a class with more speech than this is taught part by part, then merged. */
      classPartMinutes: z.number().int().min(30).max(90).optional(),
      /**
       * D78: structured readings also return the spans highlighted, underlined or circled on the
       * photo or page. The lesson teaches them at board level, and each adds one card to the item
       * limit, up to LESSON_MARKED_PRODUCTION_MAXIMUM. Needs structuredBoard.
       */
      learnerMarks: z.boolean().optional(),
    })
    .optional(),
  timeoutMs: z.number().int().positive().max(600000),
  maximumMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  modelMaximumMicros: z
    .record(z.string().min(1), z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .optional(),
  currency: z.literal("USD"),
  priceVersion: z.string().min(1).max(100),
  charactersPerPage: z.number().int().positive(),
  audioUrlSupported: z.boolean(),
  sttProviderOptions: z.record(z.string(), z.record(z.string(), z.unknown())),
  dataContractApproved: z.boolean(),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
/** Content planning retains maxOutputTokens; only this model's transport cap changes. */
export function effectiveStructuredMaxOutputTokens(
  settings: ProviderSettings,
  model: string,
): number {
  return settings.structuredModelOverrides?.[model]?.maxOutputTokens ?? settings.maxOutputTokens;
}
/**
 * The model for spoken-mistake corrections. Its hold, sampling, transport and deadline follow
 * this model's own overrides, never those of llmModel when the two differ.
 */
export function effectiveVoiceCorrectionModel(settings: ProviderSettings): string {
  return settings.voiceCorrectionModel ?? settings.llmModel;
}
/** The request deadline for one model: its override when set, otherwise the shared timeout. */
export function effectiveProviderTimeoutMs(settings: ProviderSettings, model?: string): number {
  return (model && settings.structuredModelOverrides?.[model]?.timeoutMs) || settings.timeoutMs;
}
/** The longest deadline any configured model may use, for runners that wait on a provider step. */
export function longestProviderTimeoutMs(settings: ProviderSettings): number {
  return Math.max(
    settings.timeoutMs,
    ...Object.values(settings.structuredModelOverrides ?? {}).map(
      (override) => override.timeoutMs ?? 0,
    ),
  );
}
export function maximumProviderCost(settings: ProviderSettings, model: string): number {
  const maximum = settings.modelMaximumMicros?.[model] ?? settings.maximumMicros;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > settings.maximumMicros)
    throw errors.validationFailed({ provider: ["invalid_model_cost_bound"] });
  return maximum;
}
export const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  audioSeconds: z.number().int().nonnegative().optional(),
  characters: z.number().int().nonnegative().optional(),
  pages: z.number().int().nonnegative().optional(),
});
export interface ProviderResult<T> {
  output: T;
  requestId: string | null;
  model: string;
  provider: string;
  usage: z.infer<typeof usageSchema>;
  actualMicros: number | null;
}
export interface StructuredInput<T> {
  operationKey: string;
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  input: string;
  imageUrls?: readonly string[];
}
export const transcriptSchema = z.strictObject({
  text: z.string().max(2000000),
  language: z.string().nullable(),
  segments: z
    .array(
      z.strictObject({
        id: z.string(),
        text: z.string(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        speakerId: z.string().nullable(),
        speakerRole: z.literal("unknown"),
      }),
    )
    .max(100000),
});
export type Transcript = z.infer<typeof transcriptSchema>;
export interface TranscriptionInput {
  operationKey: string;
  model: string;
  audio: { url: string; format: string } | { bytes: Uint8Array; format: string };
  durationMs: number;
  offsetMs?: number;
}
export interface AiProvider {
  readonly name: string;
  readonly mode: "real" | "mock";
  readonly settings: ProviderSettings;
  structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>>;
  transcribe(input: TranscriptionInput): Promise<ProviderResult<Transcript>>;
  speech(input: {
    operationKey: string;
    text: string;
    model?: string;
    voice?: string;
  }): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>>;
}
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly uncertain: boolean,
    readonly accounting?: Omit<ProviderResult<never>, "output">,
    /** Code-owned validation detail (schema paths and issue codes only), never response text. */
    readonly diagnostic?: string,
    /** OPS-02: the transport cause of an uncertain outcome, e.g. "ECONNRESET" or "timeout". */
    readonly causeCode?: string,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}
export function requireProvider(provider: AiProvider | undefined): AiProvider {
  if (!provider?.settings.dataContractApproved)
    throw errors.validationFailed({ provider: ["configuration_unavailable"] });
  if (
    provider.mode === "mock" &&
    (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview")
  )
    throw errors.validationFailed({ provider: ["mock_not_allowed"] });
  return provider;
}
