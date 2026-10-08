import { z } from "zod";
import type { StudyContent } from "./study-schema";

export const studyPronunciationTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (text) =>
      /\p{Script=Latin}/u.test(text) &&
      !/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}]/u.test(text) &&
      !/[<>{}[\]\\]|&(?:#\d+|[a-z]+);/iu.test(text),
  );

export interface StudyLexicalTarget {
  /** Spoken headword without dictionary object slots or grammatical complement notation. */
  text: string;
  /** Lexical chunks separated by an explicit sb/sth object slot, in their original order. */
  parts: string[];
}

const placeholder = /^(?:sb|sth|someone|somebody|something)$/iu;
// A spelled-out slot word standing alone cannot be a slot: it is the taught word itself.
const literalPronoun = /^(?:someone|somebody|something)$/iu;
const lexical = /^[\p{Script=Latin}\p{Mark}\p{Number}\s'’-]+$/u;
const grammarWord = /\b(?:noun|verb|adjective|adverb|adj|adv|participle|ing)\b/iu;
const complement =
  "(?:-?ing(?: form)?|noun|verb|base verb|person|place|sb|sth|someone|somebody|something)";
const complementPattern = new RegExp(
  `^${complement}(?:\\s*(?:/|\\bor\\b)\\s*${complement})*$`,
  "iu",
);

function headword(value: string): StudyLexicalTarget | undefined {
  if (!lexical.test(value) || grammarWord.test(value)) return undefined;
  const parts: string[] = [];
  let words: string[] = [];
  for (const word of value.split(" ")) {
    if (placeholder.test(word)) {
      if (words.length) parts.push(words.join(" "));
      words = [];
    } else words.push(word);
  }
  if (words.length) parts.push(words.join(" "));
  return parts.length ? { text: parts.join(" "), parts } : undefined;
}

/** AC-D46-01: a narrow, shared dictionary-frame parser; unknown notation is never guessed. */
export function studyLexicalTarget(en: string): StudyLexicalTarget | undefined {
  let value = en.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!value || value.length > 500 || /[<>{}[\]\\]|&(?:#\d+|[a-z]+);/iu.test(value))
    return undefined;
  // A complete dictionary label describes the headword, never adds answer words.
  // Unknown annotations remain unsupported instead of silently losing their meaning.
  const separable = /\s+\(separable phrasal verb\)$/iu.test(value);
  // These complete suffixes label usage; arbitrary parenthetical grammar/definitions are unsupported.
  value = value.replace(
    /\s+\((?:pronunciation|sl|n|v|adj|adv|noun|noun phrase|formal|informal|British English|separable phrasal verb)\)$/iu,
    "",
  );
  // Checked before slot unwrapping, so "(somebody)", "sb" and "sth" alone stay unsupported.
  if (!separable && literalPronoun.test(value)) return { text: value, parts: [value] };
  value = value.replace(
    /\((sb|sth|someone|somebody|something)(?:\s*\/\s*(?:sb|sth|someone|somebody|something))?\)/giu,
    "$1",
  );
  value = value.replace(/\b(?:sb|sth)\s*\/\s*(?:sb|sth)\b/giu, "sth");
  const plus = value.split(/\s*\+\s*/u);
  if (plus.length > 2 || (plus[1] !== undefined && !complementPattern.test(plus[1])))
    return undefined;
  const alternatives = (plus[0] ?? "").split(/\s+\/\s+/u).map(headword);
  const first = alternatives[0];
  if (!first || alternatives.some((entry) => !entry)) return undefined;
  if (separable) {
    // A declared separable two-word verb needs both lexical parts hidden, even
    // when an object occurs between them. No general grammar inference is made.
    const words = first.text.split(" ");
    if (
      alternatives.length !== 1 ||
      words.length !== 2 ||
      !/^(?:away|back|down|in|off|on|out|over|up)$/iu.test(words[1] ?? "")
    )
      return undefined;
    return { text: first.text, parts: words };
  }
  for (const alternative of alternatives.slice(1)) {
    if (!alternative) return undefined;
    if (alternative.text === first.text) continue;
    // A documented optional trailing preposition preserves the same lexical headword.
    if (
      !new RegExp(`^${escapePattern(first.text)} (?:with|in|on|for|to|from|at)$`, "iu").test(
        alternative.text,
      )
    )
      return undefined;
  }
  return first;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Object slots may be realised by a short object phrase; the lexical chunks must all remain. */
export function studyLexicalTargetMatches(target: StudyLexicalTarget, text: string): boolean {
  const pattern = target.parts.map(escapePattern).join("\\s+(?:[\\p{L}\\p{N}'’_-]+\\s+){0,8}");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** AC-D46-01: only a structured English headword/frame can become speech, never card HTML. */
export function studyPronunciationTarget(item: { study?: StudyContent }): string | undefined {
  if (!item.study) return undefined;
  const target = studyLexicalTarget(item.study.en);
  if (!target) return undefined;
  if (target.parts.length === 1) {
    const spoken = studyPronunciationTargetSchema.safeParse(target.text);
    return spoken.success ? spoken.data : undefined;
  }
  // A separable frame can be pronounced naturally only when both saved sentences agree.
  if (item.study.set !== "production" || !item.study.gapSentence) return undefined;
  const parts = item.study.gapSentence.split("______");
  if (parts.length < 2 || parts.length > 4) return undefined;
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const full = item.study.fullSentence;
  if (!new RegExp(`^${escaped.join("(.+?)")}$`, "u").test(full)) return undefined;
  const span = full.slice(parts[0]?.length ?? 0, full.length - (parts.at(-1)?.length ?? 0));
  const spoken = studyPronunciationTargetSchema.safeParse(span);
  const realised = spoken.success ? studyLexicalTarget(spoken.data) : undefined;
  return spoken.success &&
    realised?.text === spoken.data &&
    studyLexicalTargetMatches(target, spoken.data)
    ? spoken.data
    : undefined;
}
