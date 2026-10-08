import type { SpokenMistake, VoiceUtterance } from "./contracts";

const quotedWords = (value: string) => value.replaceAll("**", "").replace(/\s+/gu, " ").trim();
const selfCorrection = /\b(?:sorry|i mean|let me (?:say|correct)|rather)\b/iu;
/** Only clean, own-words turns can supply or corroborate a spoken mistake. */
const corroborates = (item: VoiceUtterance) =>
  item.eligible &&
  item.endMs - item.startMs >= 2000 &&
  !selfCorrection.test(item.text) &&
  !/["“”]/u.test(item.text);

/**
 * True when at least one speaker has two usable turns ten seconds apart. Without that, no
 * mistake can pass `findRepeatedVoiceEvidence`, so a paid correction request is pointless.
 */
export function hasRepeatableVoiceEvidence(utterances: readonly VoiceUtterance[]): boolean {
  const usable = utterances.filter(corroborates);
  return usable.some((first) =>
    usable.some(
      (second) =>
        second.id !== first.id &&
        second.speakerId === first.speakerId &&
        second.startMs - first.endMs >= 10000,
    ),
  );
}

/** A second grounded occurrence, not a model's assertion, corroborates a transcript correction. */
export function findRepeatedVoiceEvidence(
  utterances: readonly VoiceUtterance[],
  mistake: Pick<SpokenMistake, "utteranceId" | "said" | "correct">,
  speakerId: string,
): VoiceUtterance | null {
  const quote = quotedWords(mistake.said);
  const tokens = quote.match(/[a-z]+(?:['’][a-z]+)?/giu) ?? [];
  if (
    tokens.length < 2 ||
    !tokens.some((token) => token.length >= 3) ||
    quote === quotedWords(mistake.correct)
  )
    return null;
  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const phrase = new RegExp(`(?<![a-zA-Z0-9_])${escaped}(?![a-zA-Z0-9_])`, "u");
  const matches = (item: VoiceUtterance) =>
    item.speakerId === speakerId && corroborates(item) && phrase.test(quotedWords(item.text));
  const original = utterances.find((item) => item.id === mistake.utteranceId && matches(item));
  if (!original) return null;
  return (
    utterances.find(
      (item) =>
        item.id !== original.id &&
        matches(item) &&
        (item.startMs - original.endMs >= 10000 || original.startMs - item.endMs >= 10000),
    ) ?? null
  );
}
