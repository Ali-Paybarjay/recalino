import { z } from "zod";
import {
  type AiProvider,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  providerSettingsSchema,
  type StructuredInput,
  type Transcript,
  type TranscriptionInput,
  transcriptSchema,
} from "./contracts";
import { structuredTransportSchema } from "./structured-schema";

const privacy = { zdr: true, data_collection: "deny", require_parameters: true };
const chatResponse = z.object({
  id: z.string().optional(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});
const sttResponse = z.object({
  text: z.string(),
  language: z.string().optional(),
  segments: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
        text: z.string(),
        start: z.number().nonnegative(),
        end: z.number().positive(),
        speaker: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      seconds: z.number().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});
type Fetch = typeof fetch;

/** Only the fixed HTTPS OpenRouter API receives credentials; provider errors never contain content. */
export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";
  readonly mode = "real";
  readonly settings: ProviderSettings;
  constructor(
    private readonly key: string,
    settings: ProviderSettings,
    private readonly request: Fetch = fetch,
  ) {
    if (!key.trim()) throw new ProviderError("provider_key_missing", false, false);
    this.settings = providerSettingsSchema.parse(settings);
    if (!this.settings.dataContractApproved)
      throw new ProviderError("provider_contract_missing", false, false);
  }
  private async post(path: string, body: unknown, operationKey: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`https://openrouter.ai/api/v1/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "X-Title": "Recalino",
          "Idempotency-Key": operationKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch {
      throw new ProviderError("provider_outcome_unknown", false, true);
    }
    if (!response.ok) {
      const retryable = response.status === 429;
      throw new ProviderError(
        `provider_http_${response.status}`,
        retryable,
        response.status >= 500,
      );
    }
    return response;
  }
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    if (Array.from(input.input).length > this.settings.maxInputCharacters)
      throw new ProviderError("provider_input_too_large", false, false);
    const content: unknown[] = [{ type: "text", text: input.input }];
    for (const url of input.imageUrls ?? []) {
      if (
        !/^https:\/\//.test(url) &&
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
      )
        throw new ProviderError("provider_url_invalid", false, false);
      content.push({ type: "image_url", image_url: { url } });
    }
    const response = await this.post(
      "chat/completions",
      {
        model: input.model,
        provider: privacy,
        max_tokens: this.settings.maxOutputTokens,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: structuredTransportSchema(input.schema, input.model),
          },
        },
      },
      input.operationKey,
    );
    const parsed = chatResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ProviderError("provider_response_invalid", false, true);
    const data = parsed.data;
    const accounting = {
      requestId: data.id ?? null,
      provider: this.name,
      model: data.model,
      usage: {
        ...(data.usage?.prompt_tokens === undefined
          ? {}
          : { inputTokens: data.usage.prompt_tokens }),
        ...(data.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: data.usage.completion_tokens }),
      },
      actualMicros: cost(data.usage?.cost),
    };
    const contentValue = data.choices[0]?.message.content;
    let raw: unknown;
    try {
      raw = JSON.parse(contentValue ?? "");
    } catch {
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    }
    const output = input.schema.safeParse(raw);
    if (!output.success || data.choices[0]?.finish_reason === "length")
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    return {
      output: output.data,
      ...accounting,
    };
  }
  async transcribe(input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    const audio =
      "url" in input.audio
        ? (() => {
            if (!this.settings.audioUrlSupported || !/^https:\/\//.test(input.audio.url))
              throw new ProviderError("audio_url_not_supported", false, false);
            return { url: input.audio.url, format: input.audio.format };
          })()
        : { data: Buffer.from(input.audio.bytes).toString("base64"), format: input.audio.format };
    const response = await this.post(
      "audio/transcriptions",
      {
        model: input.model,
        input_audio: audio,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
        provider: { zdr: true, data_collection: "deny", options: this.settings.sttProviderOptions },
      },
      input.operationKey,
    );
    const result = sttResponse.safeParse(await response.json().catch(() => null));
    if (!result.success) throw new ProviderError("provider_response_invalid", false, true);
    const data = result.data;
    const offset = input.offsetMs ?? 0;
    const segments = (data.segments ?? []).map((segment, index) => ({
      id: String(segment.id ?? index),
      text: segment.text,
      startMs: Math.round(segment.start * 1000) + offset,
      endMs: Math.round(segment.end * 1000) + offset,
      speakerId: segment.speaker === undefined ? null : String(segment.speaker),
      speakerRole: "unknown" as const,
    }));
    if (
      segments.some(
        (segment) => segment.endMs <= segment.startMs || segment.endMs > input.durationMs + offset,
      )
    )
      throw new ProviderError("provider_timestamps_invalid", false, true);
    // Missing native timestamps are retained as text, never fabricated as precise class evidence.
    return {
      output: transcriptSchema.parse({
        text: data.text,
        language: data.language ?? null,
        segments,
      }),
      requestId: response.headers.get("X-Generation-Id"),
      provider: this.name,
      model: input.model,
      usage: {
        ...(data.usage?.seconds === undefined
          ? {}
          : { audioSeconds: Math.ceil(data.usage.seconds) }),
        ...(data.usage?.input_tokens === undefined ? {} : { inputTokens: data.usage.input_tokens }),
        ...(data.usage?.output_tokens === undefined
          ? {}
          : { outputTokens: data.usage.output_tokens }),
      },
      actualMicros: cost(data.usage?.cost),
    };
  }
  async speech(input: {
    operationKey: string;
    text: string;
    model?: string;
    voice?: string;
  }): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    if (!input.text || Array.from(input.text).length > this.settings.maxInputCharacters)
      throw new ProviderError("provider_input_too_large", false, false);
    const model = input.model ?? this.settings.ttsModel;
    const response = await this.post(
      "audio/speech",
      {
        model,
        input: input.text,
        voice: input.voice ?? this.settings.voice,
        response_format: "mp3",
        provider: { zdr: true, data_collection: "deny" },
      },
      input.operationKey,
    );
    if (!response.headers.get("Content-Type")?.startsWith("audio/mpeg"))
      throw new ProviderError("provider_media_invalid", false, true);
    return {
      output: { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: "audio/mpeg" },
      requestId: response.headers.get("X-Generation-Id"),
      provider: this.name,
      model,
      usage: { characters: Array.from(input.text).length },
      actualMicros: null,
    };
  }
}
function cost(value: number | undefined): number | null {
  if (value === undefined) return null;
  const micros = Math.ceil(value * 1000000);
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw new ProviderError("provider_cost_invalid", false, true);
  return micros;
}
