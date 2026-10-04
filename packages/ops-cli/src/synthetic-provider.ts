import { randomUUID } from "node:crypto";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
  TranscriptionInput,
} from "@recalino/core/aip";
import type { KnowledgeModel } from "@recalino/core/lkm";
import { z } from "zod";

/** Deterministic transport fixture. It never makes a network request or claims semantic accuracy. */
export class SyntheticEvaluationProvider implements AiProvider {
  readonly name = "synthetic-evaluation";
  readonly mode = "mock";
  constructor(readonly settings: ProviderSettings) {}
  private result<T>(model: string, output: T): ProviderResult<T> {
    return {
      model,
      output,
      provider: this.name,
      requestId: `synthetic:${randomUUID()}`,
      actualMicros: 1,
      usage: {},
    };
  }
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    if (input.schemaName === "source_extraction")
      return this.result(
        input.model,
        input.schema.parse({
          blocks: [{ id: "fixture", text: "I have studied English for two years." }],
        }),
      );
    const data = z
      .object({
        sources: z.array(
          z.object({
            sourceId: z.uuid(),
            contentVersionId: z.uuid(),
            blocks: z.array(z.object({ id: z.string(), text: z.string() })),
          }),
        ),
      })
      .parse(JSON.parse(input.input));
    const source = data.sources[0];
    const block = source?.blocks[0];
    if (!source || !block) throw new Error("synthetic_evidence_missing");
    const claim = (id: string) => ({
      id,
      text: "The present perfect connects a past action to the present.",
      origin: "from_class" as const,
      creation: "ai_generation" as const,
      evidence: "material" as const,
      sourceRefs: [
        {
          sourceId: source.sourceId,
          contentVersionId: source.contentVersionId,
          locator: {
            kind: "text" as const,
            blockId: block.id,
            start: 0,
            end: Array.from(block.text).length,
          },
        },
      ],
      speakerRole: "unknown" as const,
      uncertain: false,
    });
    const output: KnowledgeModel = {
      schemaVersion: "1",
      title: "Synthetic English lesson",
      language: { learning: "en", explanation: "en" },
      summary: [claim("summary")],
      topics: [],
      learningItems: [
        {
          id: "present-perfect",
          kind: "grammar",
          front: "Which tense connects a past action to the present?",
          back: "The present perfect.",
          claim: claim("learning-item"),
        },
      ],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    return this.result(input.model, input.schema.parse(output));
  }
  async transcribe(input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    return this.result(input.model, {
      text: "I have studied English for two years.",
      language: "en",
      segments: [
        {
          id: "synthetic",
          text: "I have studied English for two years.",
          startMs: 0,
          endMs: Math.min(input.durationMs, 1000),
          speakerId: null,
          speakerRole: "unknown",
        },
      ],
    });
  }
  async speech(input: {
    operationKey: string;
    text: string;
    model?: string;
    voice?: string;
  }): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    return this.result(input.model ?? this.settings.ttsModel, {
      bytes: Buffer.from("ID3 synthetic transport fixture"),
      mimeType: "audio/mpeg",
    });
  }
}
