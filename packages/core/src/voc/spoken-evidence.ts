import type { SpokenMistake, VoiceUtterance } from "./contracts";

const quotedWords = (value: string) => value.replaceAll("**", "").replace(/\s+/gu, " ").trim();

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
  const selfCorrection = /\b(?:sorry|i mean|let me (?:say|correct)|rather)\b/iu;
  const matches = (item: VoiceUtterance) =>
    item.speakerId === speakerId &&
    item.eligible &&
    item.endMs - item.startMs >= 2000 &&
    !selfCorrection.test(item.text) &&
    !/["“”]/u.test(item.text) &&
    phrase.test(quotedWords(item.text));
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
