import { z } from "zod";
import { errors } from "../plt";

export const providerSettingsSchema = z.strictObject({
  version: z.string().min(1).max(100),
  llmModel: z.string().min(1).max(200),
  visionModel: z.string().min(1).max(200),
  sttModel: z.string().min(1).max(200),
  ttsModel: z.string().min(1).max(200),
  voice: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(100),
  maxInputCharacters: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
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
