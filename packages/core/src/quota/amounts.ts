import { z } from "zod";

export const DIMENSIONS = ["audio", "document", "regeneration", "tts", "storage"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const amountsSchema = z.strictObject({
  audio: units,
  document: units,
  regeneration: units,
  tts: units,
  storage: units,
});
export type Amounts = z.infer<typeof amountsSchema>;
export function emptyAmounts(): Amounts {
  return { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 };
}
export function amounts(partial: Partial<Amounts>): Amounts {
  return amountsSchema.parse({ ...emptyAmounts(), ...partial });
}

/** Unique selected seconds, without charging technical overlap (FR-QUOTA-006). */
export function selectedSeconds(ranges: readonly { start: number; end: number }[]): number {
  const sorted = ranges
    .map(({ start, end }) => {
      z.number().finite().nonnegative().parse(start);
      z.number().finite().gt(start).parse(end);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let end = 0;
  for (const range of sorted) {
    total += Math.max(0, range.end - Math.max(end, range.start));
    end = Math.max(end, range.end);
  }
  return Math.ceil(total);
}

/** Text is measured in Unicode characters rather than UTF-16 code units. */
export function equivalentPages(text: string, charactersPerPage: number): number {
  z.number().int().positive().parse(charactersPerPage);
  return Math.ceil(Array.from(text).length / charactersPerPage);
}
