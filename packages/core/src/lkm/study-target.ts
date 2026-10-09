export interface StudyLexicalTarget {
  /** Spoken headword without dictionary object slots or grammatical complement notation. */
  text: string;
  /** Lexical chunks separated by an explicit sb/sth object slot, in their original order. */
  parts: string[];
}

/**
 * The complete closed set of complement notations accepted after " + ". Generation prompts quote
 * this list so instructions and the parser cannot drift; any other notation is unsupported.
 */
export const studyComplementNotations = [
  "-ing form",
  "-ing",
  "noun",
  "base verb",
  "verb",
  "person",
  "place",
  "sb",
  "sth",
  "someone",
  "somebody",
  "something",
] as const;

const placeholder = /^(?:sb|sth|someone|somebody|something)$/iu;
// A spelled-out slot word standing alone cannot be a slot: it is the taught word itself.
const literalPronoun = /^(?:someone|somebody|something)$/iu;
const lexical = /^[\p{Script=Latin}\p{Mark}\p{Number}\s'’-]+$/u;
const grammarWord = /\b(?:noun|verb|adjective|adverb|adj|adv|participle|ing)\b/iu;
// "ing"/"ing form" without the hyphen remain accepted spellings of the listed -ing notations.
const complement = `(?:-?ing(?: form)?|${studyComplementNotations
  .filter((notation) => !notation.startsWith("-ing"))
  .join("|")})`;
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
  // These complete suffixes label usage; arbitrary parenthetical grammar/definitions are unsupported.
  value = value.replace(
    /\s+\((?:pronunciation|sl|n|v|adj|adv|formal|informal|British English)\)$/iu,
    "",
  );
  // Checked before slot unwrapping, so "(somebody)", "sb" and "sth" alone stay unsupported.
  if (literalPronoun.test(value)) return { text: value, parts: [value] };
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
