import type { z } from "zod";
import type { Claim, LearningItem, SourceCoverage } from "../lkm";
import type { RunSource } from "./contracts";
import type { generatedKnowledgeSchema } from "./generated-knowledge";
import { LESSON_PRODUCTION_MAXIMUM, LESSON_RECOGNITION_MAXIMUM } from "./lesson-budget";

/**
 * D63 (owner decision 2026-10-12, resolving D17): a class with more speech than one part allows
 * is taught part by part, each part at most classPartMinutes long, and the parts are merged into
 * one lesson by code. No extra provider call merges them and quota is charged once at publish.
 */
type GeneratedKnowledge = z.infer<typeof generatedKnowledgeSchema>;

export interface LessonPart {
  index: number;
  sources: RunSource[];
  missingSourceIds: string[];
}

/** The end of an audio source's own timeline. */
function audioSpan(source: RunSource): number {
  return Math.max(
    source.durationMs ?? 0,
    ...source.units.map((unit) => (unit.kind === "time" ? (unit.end ?? unit.start) : 0)),
  );
}

/**
 * Splits the class's audio timeline (its audio sources one after another) into equal parts of at
 * most partMinutes. A photo or document anchored to a recording joins the part of its anchor;
 * any other non-audio source joins the first part. Null when one part holds the whole class.
 */
export function planLessonParts(
  sources: readonly RunSource[],
  partMinutes: number,
  missingSourceIds: readonly string[] = [],
): LessonPart[] | null {
  const offsets = new Map<string, number>();
  let total = 0;
  for (const source of sources)
    if (source.kind === "audio") {
      offsets.set(source.sourceId, total);
      total += audioSpan(source);
    }
  const partMs = partMinutes * 60_000;
  const count = Math.ceil(total / partMs);
  if (!Number.isFinite(count) || count < 2) return null;
  const length = total / count;
  const partOf = (globalMs: number) =>
    Math.min(count - 1, Math.max(0, Math.floor(globalMs / length)));
  const parts: RunSource[][] = Array.from({ length: count }, () => []);
  for (const source of sources) {
    if (source.kind !== "audio") {
      const anchor = source.captureAnchor;
      const offset = anchor ? offsets.get(anchor.sourceId) : undefined;
      parts[offset === undefined || !anchor ? 0 : partOf(offset + anchor.offsetMs)]?.push(source);
      continue;
    }
    const offset = offsets.get(source.sourceId) ?? 0;
    for (let index = 0; index < count; index++) {
      const units = source.units.filter((unit) =>
        unit.kind === "time" ? partOf(offset + unit.start) === index : index === 0,
      );
      const ids = new Set(units.map((unit) => unit.id));
      const blocks = source.blocks.filter((block) => ids.has(block.unitId));
      if (units.length) parts[index]?.push({ ...source, units, blocks });
    }
  }
  const result = parts
    .map((partSources) => ({
      sources: partSources,
      missingSourceIds: missingSourceIds.filter((sourceId) =>
        partSources.some((source) => source.sourceId === sourceId),
      ),
    }))
    .filter((part) => part.sources.some((source) => source.blocks.some((b) => b.text.trim())))
    .map((part, index) => ({ index, ...part }));
  return result.length >= 2 ? result : null;
}

const normalized = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
const claimKey = (claim: Claim) => normalized(claim.text);
function unique<T>(values: readonly T[], key: (value: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (result.length < limit) result.push(value);
  }
  return result;
}
const capText = (value: string, limit: number) => Array.from(value).slice(0, limit).join("");

/**
 * One lesson from its parts' validated content: items are taken round-robin across parts so every
 * part keeps its core points, the same target is taught once, and the D62 limits hold. Claim and
 * item IDs are reassigned by assignGeneratedKnowledgeIds afterwards.
 */
export function mergeLessonParts(parts: readonly GeneratedKnowledge[]): GeneratedKnowledge {
  const [first] = parts;
  if (!first) throw new RangeError("lesson parts");
  const itemKey = (item: LearningItem) =>
    `${item.study?.set ?? item.kind}|${normalized(item.study?.en ?? item.front)}`;
  const picked: { part: number; item: LearningItem }[] = [];
  const seen = new Set<string>();
  const limits = { production: LESSON_PRODUCTION_MAXIMUM, recognition: LESSON_RECOGNITION_MAXIMUM };
  const counts = { production: 0, recognition: 0 };
  const rounds = Math.max(...parts.map((part) => part.learningItems.length));
  for (let round = 0; round < rounds; round++)
    parts.forEach((part, partIndex) => {
      const item = part.learningItems[round];
      if (!item) return;
      const key = itemKey(item);
      if (seen.has(key)) return;
      const set = item.study?.set === "recognition" ? "recognition" : "production";
      if (counts[set] >= limits[set]) return;
      seen.add(key);
      counts[set] += 1;
      picked.push({ part: partIndex, item });
    });
  // Production first, then recognition, each in round-robin order; IDs stay unique per part.
  const ordered = [
    ...picked.filter(({ item }) => item.study?.set !== "recognition"),
    ...picked.filter(({ item }) => item.study?.set === "recognition"),
  ];
  const renamed = new Map<string, string>();
  const learningItems = ordered.map(({ part, item }, index) => {
    const id = `merged-item-${index}`;
    renamed.set(`${part}:${item.id}`, id);
    return { ...item, id, claim: { ...item.claim, id: `merged-item-claim-${index}` } };
  });
  let claimNumber = 0;
  const claims = (values: readonly Claim[], limit: number) =>
    unique(values, claimKey, limit).map((claim) => ({
      ...claim,
      id: `merged-claim-${claimNumber++}`,
    }));
  const topics = unique(
    parts.flatMap((part) => part.topics),
    (topic) => normalized(topic.title),
    100,
  ).map((topic, index) => ({
    ...topic,
    id: `merged-topic-${index}`,
    claims: claims(topic.claims, 300),
  }));
  const coverageSources = new Map<string, SourceCoverage>();
  for (const part of parts)
    for (const entry of part.coverage.sources ?? []) {
      const prior = coverageSources.get(entry.sourceId);
      if (!prior || (prior.status === "not_used" && entry.status === "used"))
        coverageSources.set(entry.sourceId, entry);
    }
  const notes = parts.flatMap((part) => (part.classNotes ? [part.classNotes] : []));
  const [firstNotes] = notes;
  const json = (value: unknown) => JSON.stringify(value);
  const mistakes = parts
    .flatMap((part, partIndex) =>
      (part.classNotes?.mistakes?.items ?? []).map((mistake) => {
        const { itemId, ...rest } = mistake;
        const merged = itemId ? renamed.get(`${partIndex}:${itemId}`) : undefined;
        return merged ? { ...rest, itemId: merged } : rest;
      }),
    )
    .slice(0, 15);
  const missing = [...new Set(parts.flatMap((part) => part.coverage.missingSourceIds))];
  return {
    schemaVersion: first.schemaVersion,
    title: first.title,
    language: first.language,
    summary: claims(
      parts.flatMap((part) => part.summary),
      100,
    ),
    topics,
    learningItems,
    homework: claims(
      parts.flatMap((part) => part.homework),
      100,
    ),
    uncertainties: claims(
      parts.flatMap((part) => part.uncertainties),
      100,
    ),
    coverage: {
      complete: missing.length === 0,
      missingSourceIds: missing,
      ...(coverageSources.size ? { sources: [...coverageSources.values()] } : {}),
    },
    ...(firstNotes
      ? {
          classNotes: {
            ...firstNotes,
            coverage: capText(
              unique(
                notes.map((note) => note.coverage),
                normalized,
                notes.length,
              ).join(" "),
              2000,
            ),
            ...(() => {
              const sourceNote = unique(
                notes.flatMap((note) => (note.sourceNote ? [note.sourceNote] : [])),
                normalized,
                notes.length,
              ).join(" ");
              return sourceNote ? { sourceNote: capText(sourceNote, 10000) } : {};
            })(),
            chunks: unique(
              notes.flatMap((note) => note.chunks),
              json,
              100,
            ),
            board: unique(
              notes.flatMap((note) => note.board),
              normalized,
              100,
            ),
            tasks: unique(
              notes.flatMap((note) => note.tasks),
              json,
              30,
            ),
            register: unique(
              notes.flatMap((note) => note.register),
              json,
              100,
            ),
            gapfill: [],
            ...(notes.some((note) => note.culture?.length)
              ? {
                  culture: unique(
                    notes.flatMap((note) => note.culture ?? []),
                    json,
                    30,
                  ),
                }
              : {}),
            ...(firstNotes.mistakes
              ? { mistakes: { ...firstNotes.mistakes, patterns: [], items: mistakes } }
              : {}),
          },
        }
      : {}),
    sourceClassifications: unique(
      parts.flatMap((part) => part.sourceClassifications),
      (entry) => entry.sourceId,
      100,
    ),
  };
}
