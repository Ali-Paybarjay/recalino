import { z } from "zod";
import {
  type AiProvider,
  effectiveProviderTimeoutMs,
  effectiveStructuredMaxOutputTokens,
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
const providerDefaultSamplingModels = new Set(["anthropic/claude-haiku-5.5"]);
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
    const serialized = JSON.stringify(body);
    const model =
      typeof body === "object" && body !== null && "model" in body ? body.model : undefined;
    const maximumBytes =
      path === "chat/completions" && typeof model === "string"
        ? this.settings.structuredModelOverrides?.[model]?.maxRequestBytes
        : undefined;
    // Check the complete wire body, including schema/system overhead, before any dispatch.
    if (maximumBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maximumBytes)
      throw new ProviderError("provider_request_too_large", false, false);
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
        body: serialized,
        signal: AbortSignal.timeout(
          effectiveProviderTimeoutMs(this.settings, typeof model === "string" ? model : undefined),
        ),
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
    const controls = this.settings.structuredModelOverrides?.[input.model];
    // A URL's byte length cannot bound the image's token usage. This bound is text-only.
    if (controls?.maxRequestBytes !== undefined && input.imageUrls?.length)
      throw new ProviderError("provider_bounded_images_unsupported", false, false);
    const content: unknown[] = [{ type: "text", text: input.input }];
    const transport =
      controls?.structuredOutputMode === "json_object"
        ? undefined
        : createStructuredTransport(input.schema, input.model);
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
      max_tokens: effectiveStructuredMaxOutputTokens(this.settings, input.model),
      ...(controls?.reasoningEffort === undefined
        ? {}
        : {
            reasoning: {
              effort: controls.reasoningEffort,
            },
          }),
      // Reasoning requests and models that reject non-default sampling use provider defaults;
      // the known model set also covers a snapshot that predates the override.
      ...(this.settings.structuredTemperature === undefined ||
      controls?.omitTemperature ||
      controls?.reasoningEffort !== undefined ||
      providerDefaultSamplingModels.has(input.model)
        ? {}
        : { temperature: this.settings.structuredTemperature }),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content },
      ],
    };
    let response: Response;
    let jsonFallback: ReturnType<typeof createJsonFallbackTransport> | undefined;
    const postJson = (
      jsonTransport: ReturnType<typeof createJsonFallbackTransport>,
      operationKey: string,
    ) =>
      this.post(
        "chat/completions",
        {
          ...body,
          messages: [
            {
              role: "system",
              content: [
                input.system,
                "Return exactly one complete JSON object conforming to the following JSON Schema. Do not include Markdown fences or surrounding prose. All required fields, types, constraints and evidence rules still apply. Finish the entire object within the output token budget.",
                "Omit inapplicable optional fields. Every required property must be present. Absence values null or empty string are allowed only where this schema explicitly permits them; never substitute absence for a field constrained to nonempty content.",
                JSON.stringify(jsonTransport.schema),
              ].join("\n\n"),
            },
            { role: "user", content },
          ],
          response_format: { type: "json_object" },
        },
        operationKey,
      );
    if (!transport) {
      // Explicit JSON mode skips native compilation, never local schema validation.
      jsonFallback = createJsonFallbackTransport(input.schema);
      response = await postJson(jsonFallback, input.operationKey);
    } else {
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
        if (
          !(error instanceof ProviderError) ||
          error.code !== "provider_request_schema_too_complex"
        )
          throw error;
        jsonFallback = createJsonFallbackTransport(input.schema);
        response = await postJson(jsonFallback, `${input.operationKey}:json`);
      }
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
      raw = parseStructuredContent(
        contentValue,
        !!jsonFallback,
        // Explicit JSON mode has no grammar. A response that stopped normally with only its
        // final closers missing is completed without changing any value; strict Zod follows.
        !transport && data.choices[0]?.finish_reason === "stop" ? input.schemaName : undefined,
      );
    } catch {
      reportSchemaFailure(input.schemaName, "json_parse", input.schema);
      throw new ProviderError("provider_schema_invalid", false, false, accounting, "json_parse");
    }
    const outputTransport = jsonFallback ?? transport;
    if (!outputTransport)
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    const output = input.schema.safeParse(outputTransport.decode(raw));
    if (!output.success) {
      const summaries = reportSchemaFailure(
        input.schemaName,
        "zod",
        input.schema,
        output.error.issues,
      );
      throw new ProviderError(
        "provider_schema_invalid",
        false,
        false,
        accounting,
        schemaIssueDiagnostic(summaries),
      );
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
  "class_knowledge_content",
  "class_knowledge_content_repair",
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
type SchemaIssueSummary = { code: string; path: (string | number)[] };
/** At most three code-owned issues, e.g. `zod:too_small@learningItems.1.teaching.imageFa`. */
function schemaIssueDiagnostic(summaries: SchemaIssueSummary[]): string | undefined {
  // A union issue is kept when no nested branch issue explains it (an invalid discriminator).
  const specific = summaries.filter((issue) => issue.code !== "invalid_union");
  const parts = (specific.length ? specific : summaries)
    .slice(0, 3)
    .map(
      (issue) =>
        `zod:${issue.code}@${issue.path.map((part) => (part === "[unknown]" ? "?" : part)).join(".")}`,
    );
  return parts.length ? parts.join(";") : undefined;
}
/** Only code-owned schema names/paths and validation codes reach logs, never rejected values or messages. */
function reportSchemaFailure(
  schemaName: string,
  stage: "json_parse" | "zod",
  schema: z.ZodType,
  issues: z.ZodError["issues"] = [],
): SchemaIssueSummary[] {
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
    const summaries = bounded.map((issue) => ({
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
    }));
    console.warn("recalino.provider_schema_invalid", {
      schema: diagnosticSchemas.has(schemaName) ? schemaName : "other",
      stage,
      issues: summaries,
    });
    return summaries;
  } catch {
    // Diagnostic failure must never alter the provider outcome or trigger another request.
    return [];
  }
}
function parseStructuredContent(
  content: string | null | undefined,
  allowJsonFence: boolean,
  closerCompletionSchema?: string,
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
    if (fenced) return JSON.parse(fenced[1] ?? "");
    const completed = closerCompletionSchema === undefined ? undefined : completeFinalClosers(text);
    if (!completed) throw error;
    const value = JSON.parse(completed.text);
    console.warn("recalino.provider_json_closers_completed", {
      schema: diagnosticSchemas.has(closerCompletionSchema ?? "")
        ? closerCompletionSchema
        : "other",
      closers: completed.closers,
    });
    return value;
  }
}
/**
 * A root object whose text ends by closing a container, outside any string, and lacks only
 * one or two final closers. Every value is unchanged; anything else stays a parse failure.
 */
export function completeFinalClosers(
  content: string,
): { text: string; closers: number } | undefined {
  const text = content.trim();
  if (!text.startsWith("{") || !(text.endsWith("}") || text.endsWith("]"))) return undefined;
  const expected: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{") expected.push("}");
    else if (character === "[") expected.push("]");
    else if ((character === "}" || character === "]") && expected.pop() !== character)
      return undefined;
  }
  if (inString || expected.length === 0 || expected.length > 2) return undefined;
  return { text: text + expected.reverse().join(""), closers: expected.length };
}
function cost(value: number | undefined): number | null {
  if (value === undefined) return null;
  const micros = Math.ceil(value * 1000000);
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw new ProviderError("provider_cost_invalid", false, true);
  return micros;
}
