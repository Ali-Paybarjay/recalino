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
import { providerHttpErrorCode } from "./provider-http-error";
import { createJsonFallbackTransport, createStructuredTransport } from "./structured-schema";

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
  text: transcriptSchema.shape.text,
  language: z.string().optional(),
  // Timing is optional evidence. A complete text/usage response remains usable
  // when its segment metadata cannot establish reliable native time spans.
  segments: z.unknown().optional(),
  usage: z
    .object({
      seconds: z.number().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});
const sttSegments = z
  .array(
    z.object({
      id: z.union([z.string(), z.number()]).optional(),
      text: z.string(),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      speaker: z.union([z.string(), z.number()]).optional(),
    }),
  )
  .max(100000);
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
          "X-OpenRouter-Cache": "false",
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
        await providerHttpErrorCode(response),
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
    const transport = createStructuredTransport(input.schema, input.model);
    for (const url of input.imageUrls ?? []) {
      if (
        !/^https:\/\//.test(url) &&
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
      )
        throw new ProviderError("provider_url_invalid", false, false);
      content.push({ type: "image_url", image_url: { url } });
    }
    const body = {
      model: input.model,
      provider: privacy,
      max_tokens: this.settings.maxOutputTokens,
      ...(this.settings.structuredTemperature === undefined
        ? {}
        : { temperature: this.settings.structuredTemperature }),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content },
      ],
    };
    let response: Response;
    let jsonFallback: ReturnType<typeof createJsonFallbackTransport> | undefined;
    try {
      response = await this.post(
        "chat/completions",
        {
          ...body,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.schemaName,
              strict: true,
              schema: transport.schema,
            },
          },
        },
        input.operationKey,
      );
    } catch (error) {
      // A recognized HTTP 400 grammar rejection happened before generation. One
      // JSON-mode attempt bypasses only the remote grammar compiler; every local
      // schema/evidence validator still applies. Unknown outcomes never retry.
      if (!(error instanceof ProviderError) || error.code !== "provider_request_schema_too_complex")
        throw error;
      jsonFallback = createJsonFallbackTransport(input.schema);
      response = await this.post(
        "chat/completions",
        {
          ...body,
          messages: [
            {
              role: "system",
              content: [
                input.system,
                "Return exactly one complete JSON object conforming to the following JSON Schema. Do not include Markdown fences or surrounding prose. All required fields, types, constraints and evidence rules still apply. Finish the entire object within the output token budget.",
                "Omit inapplicable optional fields. Null and empty-string absence values are permitted only where this schema explicitly declares them; never use them for required fields.",
                JSON.stringify(jsonFallback.schema),
              ].join("\n\n"),
            },
            { role: "user", content },
          ],
          response_format: { type: "json_object" },
        },
        `${input.operationKey}:json`,
      );
    }
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
    if (data.choices[0]?.finish_reason === "length")
      throw new ProviderError("provider_output_truncated", false, false, accounting);
    const contentValue = data.choices[0]?.message.content;
    let raw: unknown;
    try {
      raw = parseStructuredContent(contentValue, !!jsonFallback);
    } catch {
      reportSchemaFailure(input.schemaName, "json_parse", input.schema);
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    }
    const output = input.schema.safeParse(
      jsonFallback ? jsonFallback.decode(raw) : transport.decode(raw),
    );
    if (!output.success) {
      reportSchemaFailure(input.schemaName, "zod", input.schema, output.error.issues);
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    }
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
    const nativeSegments = sttSegments.safeParse(data.segments ?? []);
    const mappedSegments = (nativeSegments.success ? nativeSegments.data : []).map(
      (segment, index) => ({
        id: String(segment.id ?? index),
        text: segment.text,
        startMs: Math.round(segment.start * 1000) + offset,
        endMs: Math.round(segment.end * 1000) + offset,
        speakerId: segment.speaker === undefined ? null : String(segment.speaker),
        speakerRole: "unknown" as const,
      }),
    );
    const checkedSegments = transcriptSchema.shape.segments.safeParse(mappedSegments);
    const segments =
      checkedSegments.success &&
      checkedSegments.data.every(
        (segment) =>
          segment.startMs >= offset &&
          segment.endMs > segment.startMs &&
          segment.endMs <= input.durationMs + offset,
      )
        ? checkedSegments.data
        : [];
    // Keep all returned text if any span is unreliable. Filtering individual spans
    // would discard their words downstream; clamping would invent precise evidence.
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
const diagnosticSchemas = new Set([
  "source_extraction",
  "pdf_page_extraction",
  "class_knowledge",
  "class_knowledge_repair",
  "class_study_sentence_repair",
  "class_knowledge_translation",
  "spoken_mistake_candidates",
]);
const diagnosticIssueCodes = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);
/** Only code-owned schema names/paths and validation codes reach logs, never rejected values or messages. */
function reportSchemaFailure(
  schemaName: string,
  stage: "json_parse" | "zod",
  schema: z.ZodType,
  issues: z.ZodError["issues"] = [],
): void {
  try {
    const properties = new Set<string>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const node = value as Record<string, unknown>;
      for (const key of ["properties", "$defs", "definitions"] as const) {
        const children = node[key];
        if (!children || typeof children !== "object" || Array.isArray(children)) continue;
        for (const [name, child] of Object.entries(children)) {
          if (key === "properties" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
            properties.add(name);
          visit(child);
        }
      }
      for (const key of ["items", "additionalProperties"]) visit(node[key]);
      for (const key of ["anyOf", "oneOf", "allOf"]) {
        if (Array.isArray(node[key])) for (const child of node[key]) visit(child);
      }
    };
    visit(z.toJSONSchema(schema, { reused: "ref" }));
    const bounded = [...issues.slice(0, 12)];
    for (let index = 0; index < bounded.length && bounded.length < 12; index++) {
      const issue = bounded[index];
      if (issue?.code === "invalid_union")
        bounded.push(...issue.errors.flat().slice(0, 12 - bounded.length));
    }
    // JSON preserves nested issue paths in deployed logs; console's default
    // object inspection replaces deeper arrays with [Array]. The payload below
    // contains only bounded code-owned paths/codes, never rejected source data.
    console.warn(
      "recalino.provider_schema_invalid",
      JSON.stringify({
        schema: diagnosticSchemas.has(schemaName) ? schemaName : "other",
        stage,
        issues: bounded.map((issue) => ({
          code: diagnosticIssueCodes.has(issue.code) ? issue.code : "other",
          path: issue.path
            .slice(0, 12)
            .map((part) =>
              typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && part <= 1000000
                ? part
                : typeof part === "string" && properties.has(part)
                  ? part
                  : "[unknown]",
            ),
        })),
      }),
    );
  } catch {
    // Diagnostic failure must never alter the provider outcome or trigger another request.
  }
}
function parseStructuredContent(
  content: string | null | undefined,
  allowJsonFence: boolean,
): unknown {
  const text = content ?? "";
  try {
    return JSON.parse(text);
  } catch (error) {
    // Some JSON-mode endpoints wrap an otherwise complete JSON document in one
    // Markdown fence. Accept only that whole envelope, never prose or a fragment.
    const fenced = allowJsonFence
      ? /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text.trim())
      : null;
    if (!fenced) throw error;
    return JSON.parse(fenced[1] ?? "");
  }
}
function cost(value: number | undefined): number | null {
  if (value === undefined) return null;
  const micros = Math.ceil(value * 1000000);
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw new ProviderError("provider_cost_invalid", false, true);
  return micros;
}
