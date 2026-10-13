import { ProviderError } from "../aip";
import type { StudyLessonContext } from "../lkm";
import type { RunSource } from "./contracts";
import type { ModelTeachingContext } from "./learner-context";

interface KnowledgeInput {
  explanationLanguage: string;
  teachingPreferences: { shorterExamples: boolean };
  sources: readonly RunSource[];
  missingSourceIds: readonly string[];
  lessonContext?: StudyLessonContext;
  learnerContext?: ModelTeachingContext;
}
type Block = RunSource["blocks"][number];
type BlockMetadata = Pick<
  Block,
  "kind" | "level" | "speakerRole" | "speakerId" | "timeStatus" | "layout"
>;

const fullReferencePrompt =
  "For each SourceRef choose and copy an allowedSourceRefs entry exactly, including its locator. Do not count or invent character offsets. Use the provided full block, page or native time span unchanged. If the source cannot support a claim, omit it or mark uncertainty rather than inventing evidence.";
const compactReferencePrompt =
  'The input format compact_evidence_v1 is a lossless evidence table. Each source has its exact sourceId and contentVersionId once. Its evidence rows contain ALL original block text and an allowed locator: ["time",startMs,endMs,text,optionalBlockMetadata], ["page",page,blockId,text,optionalBlockMetadata], or ["text",blockId,start,end,text,optionalBlockMetadata]. For every output SourceRef use the full output schema: copy sourceId and contentVersionId from that source and expand the row locator to {kind:"time",startMs,endMs}, {kind:"page",page,blockId}, or {kind:"text",blockId,start,end}, exactly. Do not output tuples as SourceRefs, count character offsets, combine spans, or invent times. blockDefaults apply to every row; optionalBlockMetadata overrides them. Block kind and heading level preserve document structure. Speaker roles default to unknown; speakerId is anonymous grouping, never proof of identity. Teacher attribution requires an audio time row and explicitly confirmed teacher roles throughout the span; a text row never proves teacher speech. Do not cite empty text or a zero-length span. Incomplete units and missingSourceIds preserve source uncertainty. Photo captureAnchor is context only, never an allowed locator. If evidence cannot support a claim, omit it or mark uncertainty.';

function allowedLocator(
  source: Pick<RunSource, "kind">,
  block: Block,
  unit: RunSource["units"][number] | undefined,
) {
  return source.kind === "pdf" && unit?.kind === "page"
    ? { kind: "page" as const, page: unit.start, blockId: block.id }
    : source.kind === "audio" && unit?.kind === "time" && unit.end !== undefined
      ? { kind: "time" as const, startMs: unit.start, endMs: unit.end }
      : {
          kind: "text" as const,
          blockId: block.id,
          start: 0,
          end: Array.from(block.text).length,
        };
}

function blockMetadata(block: Block): BlockMetadata {
  return {
    kind: block.kind,
    speakerRole: block.speakerRole ?? "unknown",
    ...(block.level !== undefined ? { level: block.level } : {}),
    ...(block.speakerId !== undefined ? { speakerId: block.speakerId } : {}),
    ...(block.timeStatus !== undefined ? { timeStatus: block.timeStatus } : {}),
    ...(block.layout !== undefined ? { layout: block.layout } : {}),
  };
}

function compactSource(source: RunSource) {
  const units = new Map(source.units.map((unit) => [unit.id, unit]));
  const metadata = source.blocks.map(blockMetadata);
  const common = Object.fromEntries(
    Object.entries(metadata[0] ?? {}).filter(([key, value]) =>
      metadata.every((item) => item[key as keyof BlockMetadata] === value),
    ),
  );
  return {
    sourceId: source.sourceId,
    contentVersionId: source.contentVersionId,
    kind: source.kind,
    role: source.role,
    durationMs: source.durationMs,
    pageCount: source.pageCount,
    ranges: source.ranges,
    captureAnchor: source.captureAnchor,
    blockDefaults: common,
    incompleteUnits: source.units
      .filter((unit) => unit.status !== "extracted")
      .map(({ id: _id, ...unit }) => unit),
    evidence: source.blocks.map((block, index) => {
      const locator = allowedLocator(source, block, units.get(block.unitId));
      const row: unknown[] =
        locator.kind === "time"
          ? ["time", locator.startMs, locator.endMs, block.text]
          : locator.kind === "page"
            ? ["page", locator.page, locator.blockId, block.text]
            : ["text", locator.blockId, locator.start, locator.end, block.text];
      const annotations = Object.fromEntries(
        Object.entries(metadata[index] ?? {}).filter(([key, value]) => common[key] !== value),
      );
      if (Object.keys(annotations).length) row.push(annotations);
      return row;
    }),
  };
}

/** Compress repeated transport metadata only; evidence text and native locators stay unchanged. */
export function buildKnowledgeInput(data: KnowledgeInput, maxInputCharacters: number) {
  const full = JSON.stringify({
    ...data,
    sources: data.sources.map(({ objectId: _objectId, sha256: _sha256, ...source }) => {
      const units = new Map(source.units.map((unit) => [unit.id, unit]));
      return {
        ...source,
        allowedSourceRefs: source.blocks.map((block) => ({
          sourceId: source.sourceId,
          contentVersionId: source.contentVersionId,
          locator: allowedLocator(source, block, units.get(block.unitId)),
        })),
      };
    }),
  });
  if (Array.from(full).length <= maxInputCharacters)
    return { input: full, sourceRefPrompt: fullReferencePrompt, format: "full" as const };
  const compact = JSON.stringify({
    format: "compact_evidence_v1",
    ...data,
    sources: data.sources.map(compactSource),
  });
  if (Array.from(compact).length > maxInputCharacters)
    throw new ProviderError("provider_input_too_large", false, false);
  return { input: compact, sourceRefPrompt: compactReferencePrompt, format: "compact" as const };
}
