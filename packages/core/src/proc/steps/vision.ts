// Photo and scanned-page reading shared by the extraction stages (audit QUA-01). Moved verbatim
// from worker.ts.

import { z } from "zod";
import type { AiProvider } from "../../aip";
import type { JobContext } from "../../plt";
import {
  blockLayoutTypes,
  learnerMarkStyles,
  learnerMarksIn,
  sourceClassificationSchema,
} from "../../src";

import { callFits, failureRank } from "./runtime";

export const extractionSchema = z.strictObject({
  classification: sourceClassificationSchema.default({
    role: "class_material",
    confidence: "uncertain",
  }),
  blocks: z
    .array(z.strictObject({ id: z.string().min(1).max(100), text: z.string().min(1).max(100000) }))
    .max(1000),
});
/** lesson-quality-1: a photo or scanned page read as typed blocks in reading order. */
export const structuredExtractionSchema = z.strictObject({
  classification: extractionSchema.shape.classification,
  blocks: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        type: z.enum(blockLayoutTypes),
        text: z.string().min(1).max(100000),
        uncertain: z.boolean().optional(),
      }),
    )
    .max(1000),
});
/**
 * D78: a structured reading that also lists the marked spans of each block. Mark text and count
 * are loose here so one odd mark never fails the reading; learnerMarksIn keeps the valid ones.
 */
export const markedExtractionSchema = z.strictObject({
  classification: extractionSchema.shape.classification,
  blocks: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        type: z.enum(blockLayoutTypes),
        text: z.string().min(1).max(100000),
        uncertain: z.boolean().optional(),
        marks: z
          .array(
            z.strictObject({
              style: z.enum(learnerMarkStyles),
              text: z.string().min(1).max(100000),
            }),
          )
          .max(1000)
          .optional(),
      }),
    )
    .max(1000),
});
export type VisionOutput =
  | z.infer<typeof extractionSchema>
  | z.infer<typeof structuredExtractionSchema>
  | z.infer<typeof markedExtractionSchema>;
export const structuredBoardInstruction =
  'Read the photo or page in its natural reading order and return one block per visual unit, in that order, each with a type: heading for a title, list_item for one bullet or numbered line, table for a table (one line per row, cells separated by " | "), relation for an arrow or line linking items (write it as "A → B"), example for an example sentence, correction for a crossed-out or corrected form (write it as "wrong → right"), and text for anything else. Copy the visible words exactly. Set uncertain to true for any block whose reading is not certain, and still never guess hidden or illegible words. ';
/** D78: highlighted, underlined or circled spans are what the learner found important or hard. */
export const learnerMarksInstruction =
  "For each block also list in marks every span that is visibly marked: highlighted with a marker (style highlight), underlined (underline), or circled or boxed (circle). Copy only the marked words, exactly as they appear in that block's text, one entry per separate mark. Omit marks when a block has no clear mark, and never guess a mark. ";
const layoutKinds = {
  heading: "heading",
  list_item: "list_item",
  table: "table",
  relation: "paragraph",
  example: "paragraph",
  correction: "paragraph",
  text: "paragraph",
} as const;
/** Older snapshots keep plain paragraphs; structured readings keep type, order and uncertainty. */
export function visionBlocks(output: VisionOutput, unitId: string, prefix = "") {
  return output.blocks.map((block, index) => {
    if (!("type" in block))
      return { id: `${prefix}${block.id}`, kind: "paragraph" as const, text: block.text, unitId };
    const marks = "marks" in block ? learnerMarksIn(block.text, block.marks) : [];
    return {
      id: `${prefix}${block.id}`,
      kind: layoutKinds[block.type],
      text: block.text,
      unitId,
      layout: {
        type: block.type,
        order: index + 1,
        ...(block.uncertain ? { uncertain: true as const } : {}),
        ...(marks.length ? { marks } : {}),
      },
    };
  });
}
/**
 * Lanes of vision calls, a few at a time. A call starts only while it can still finish before the
 * runner's deadline (callFits); after a failure no new call starts, the calls in flight settle and
 * the most significant failure is thrown. Returns how many calls it started.
 */
export async function boundedVisionCalls<T>(
  job: JobContext,
  provider: AiProvider,
  model: string | ((item: T) => string),
  items: readonly T[],
  concurrency: number,
  call: (item: T) => Promise<void>,
): Promise<number> {
  const queue = [...items];
  let launched = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure) {
      const item = queue[0];
      if (item === undefined) return;
      if (!callFits(job, provider, typeof model === "string" ? model : model(item))) return;
      queue.shift();
      launched += 1;
      try {
        await call(item);
      } catch (error) {
        const earlier = failure as { error: unknown } | null;
        if (!earlier || failureRank(error) > failureRank(earlier.error)) failure = { error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failure) throw (failure as { error: unknown }).error;
  return launched;
}
