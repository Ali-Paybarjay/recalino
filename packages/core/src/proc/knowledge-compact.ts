import { z } from "zod";

/** Audit marker only: truncated text is never retained or parsed as lesson data. */
export const knowledgeTruncationSchema = z.strictObject({
  reason: z.literal("provider_output_truncated"),
  attemptId: z.uuid(),
});

export function compactKnowledgeBudget(maxOutputTokens: number): number {
  return Math.min(maxOutputTokens, 2048);
}

export function compactKnowledgeInstruction(explanationLanguage: string): string {
  return [
    "This is the single compact recovery after an earlier response reached its output limit. Read ALL supplied source evidence; do not remove or truncate input. Return at most ONE complete learning item, only if supported, with its complete question, answer, teaching fields and one exact evidence reference. No recognition extras. Keep supplementary arrays empty except an essential supported assignment or uncertainty. Preserve all required metadata and every sourceClassifications entry. Finish a short, complete JSON object; never emit partial JSON or an incomplete card.",
    explanationLanguage.split("-")[0] === "fa"
      ? 'Keep classNotes minimal and set classNotes.sourceNote to "این نسخه گزیده‌ای از درس است؛ جزئیات دیگر درس در آن نیامده است." Keep at most one short coverage sentence; chunks, board, tasks, register, gapfill and culture can be empty arrays. Do not invent material to fill a section.'
      : "The output is a selected subset, never an exhaustive lesson. Include one concise AI-expansion uncertainty in the requested explanation language stating that other lesson details are not included; use evidence ai, speakerRole unknown and no sourceRefs for that editorial note.",
  ].join(" ");
}
