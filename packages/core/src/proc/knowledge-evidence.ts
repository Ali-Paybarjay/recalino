import { ProviderError } from "../aip";
import { type Claim, type SourceRef, type StudyLessonContext, sourceRefSchema } from "../lkm";
import { errors } from "../plt";
import type { SourceClassification } from "../src";
import type { RunSource } from "./contracts";
import { buildKnowledgeInput } from "./knowledge-input";
import type { ModelTeachingContext } from "./learner-context";

export interface KnowledgeEvidenceInput {
  sources: readonly RunSource[];
  explanationLanguage: string;
  teachingPreferences: { shorterExamples: boolean };
  missingSourceIds: readonly string[];
  lessonContext?: StudyLessonContext;
  learnerContext?: ModelTeachingContext;
}

export interface KnowledgeEvidence {
  reference: SourceRef;
  evidence: Claim["evidence"];
  source: RunSource;
  block: RunSource["blocks"][number];
}

function classification(source: RunSource): SourceClassification {
  const role = source.role === "class_audio" ? "class_material" : (source.role ?? "class_material");
  return { role, confidence: role === "class_material" ? "uncertain" : "high" };
}

function evidenceKind(source: RunSource): Claim["evidence"] {
  if (source.kind === "audio") return "audio";
  if (source.role === "user_notes") return "user_notes";
  if (source.kind === "image" && source.role === "board_photo") return "board";
  return "material";
}

/** The wire handle of a source for per-source coverage, e.g. s1. */
export function sourceKey(sourceIndex: number): string {
  return `s${sourceIndex + 1}`;
}

/** Finite keys select exact native evidence; text is never truncated or reinterpreted. */
export function buildKnowledgeEvidenceInput(
  data: KnowledgeEvidenceInput,
  maxInputCharacters: number,
  format = "knowledge_repair_keys_v1",
  options: { sourceKeys?: boolean } = {},
) {
  const prepared = buildKnowledgeInput(data, maxInputCharacters);
  const encoded = JSON.parse(prepared.input);
  const references = new Map<string, KnowledgeEvidence>();
  let ordinal = 0;
  const sources = data.sources.map((source, sourceIndex) => {
    const transport = encoded.sources[sourceIndex];
    let rows: unknown[][];
    let metadata: Record<string, unknown>;
    if (prepared.format === "compact") {
      const { evidence, ...rest } = transport;
      rows = evidence;
      metadata = rest;
    } else {
      const { units, blocks: _blocks, allowedSourceRefs, ...rest } = transport;
      metadata = {
        ...rest,
        blockDefaults: {},
        incompleteUnits: units
          .filter((unit: RunSource["units"][number]) => unit.status !== "extracted")
          .map(({ id: _id, ...unit }: RunSource["units"][number]) => unit),
      };
      rows = source.blocks.map((block, index) => {
        const locator = allowedSourceRefs[index].locator as SourceRef["locator"];
        const row: unknown[] =
          locator.kind === "time"
            ? ["time", locator.startMs, locator.endMs, block.text]
            : locator.kind === "page"
              ? ["page", locator.page, locator.blockId, block.text]
              : ["text", locator.blockId, locator.start, locator.end, block.text];
        const { id: _id, unitId: _unitId, text: _text, ...annotations } = block;
        row.push(annotations);
        return row;
      });
    }
    const units = new Map(source.units.map((unit) => [unit.id, unit]));
    const evidence = rows.map((row, blockIndex) => {
      const block = source.blocks[blockIndex];
      const key = `r${(ordinal++).toString(36)}`;
      if (!block) throw errors.validationFailed({ output: ["source_reference_invalid"] });
      // Whitespace-only rows carry no evidence and never receive a citable key.
      if (!block.text.trim()) return [null, ...row];
      if (!source.contentVersionId)
        throw errors.validationFailed({ output: ["source_reference_invalid"] });
      const unit = units.get(block.unitId);
      const locator: SourceRef["locator"] =
        source.kind === "audio" && unit?.kind === "time" && unit.end !== undefined
          ? { kind: "time", startMs: unit.start, endMs: unit.end }
          : source.kind === "pdf" && unit?.kind === "page"
            ? { kind: "page", page: unit.start, blockId: block.id }
            : { kind: "text", blockId: block.id, start: 0, end: Array.from(block.text).length };
      if (locator.kind === "time" && locator.endMs <= locator.startMs)
        throw errors.validationFailed({ output: ["time_reference_invalid"] });
      references.set(key, {
        reference: sourceRefSchema.parse({
          sourceId: source.sourceId,
          contentVersionId: source.contentVersionId,
          locator,
        }),
        evidence: evidenceKind(source),
        source,
        block,
      });
      return [key, ...row];
    });
    // lesson-quality-1: a short handle the model uses to account for each source.
    return {
      ...(options.sourceKeys ? { sourceKey: sourceKey(sourceIndex) } : {}),
      ...metadata,
      evidence,
    };
  });
  if (!references.size) throw errors.validationFailed({ sources: ["no_extractable_content"] });
  const input = JSON.stringify({
    format,
    explanationLanguage: data.explanationLanguage,
    teachingPreferences: data.teachingPreferences,
    sources,
    missingSourceIds: data.missingSourceIds,
    ...(data.lessonContext ? { lessonContext: data.lessonContext } : {}),
    ...(data.learnerContext ? { learnerContext: data.learnerContext } : {}),
  });
  if (Array.from(input).length > maxInputCharacters)
    throw new ProviderError("provider_input_too_large", false, false);
  return {
    input,
    references: references as ReadonlyMap<string, KnowledgeEvidence>,
    keys: Array.from(references.keys()) as [string, ...string[]],
    sourceClassifications: data.sources.map((source) => ({
      sourceId: source.sourceId,
      classification: classification(source),
    })),
  };
}
