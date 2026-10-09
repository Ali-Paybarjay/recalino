import { studyHomeworkMarkers } from "./study-locale";

/**
 * Source text that sets work for after class. A deterministic, deliberately lexical test: it errs
 * towards "not an assignment", because the generation projection only moves an unsupported
 * homework claim to the class summary and never deletes or rejects it. Source text is data only.
 */
const englishMarker =
  /(?<![\p{L}\p{N}])(?:(home[ -]?works?|home[ -]?tasks?|hw|h\/w|h\.w\.?)|assign(?:ed|ments?)?|due|(?:for|before|by|until) +(?:(?:the|our|your) +)?next +(?:class|lesson|session|week|time|meeting)s?)(?![\p{L}\p{N}])/giu;
const negator = /^(?:no|not|never|without|nor|none|nothing|cannot)$|n't$/u;
// "don't forget the homework", "haven't finished ..., finish it for next class", "not much
// homework, just ...", "without fail" and "no 4" do not negate a following assignment.
const leadingNegatorException = new Set([
  "forget",
  "fail",
  "finish",
  "finished",
  "complete",
  "completed",
  "done",
  "much",
  "only",
  "just",
]);
// After the marker only quantity words are exempt: "Homework not done" still negates.
const trailingNegatorException = new Set(["much", "only", "just"]);
// "and" is not a clause boundary: "no responses and assigned homework" stays negated.
const clauseWord = new Set([
  "so",
  "but",
  "then",
  "if",
  "because",
  "when",
  "while",
  "although",
  "though",
  "otherwise",
]);
const possessivePronoun = new Set(["my", "his", "her", "their", "our", "its"]);
// Contractions of "is" and time or lesson words are not a person who owns completed work.
const nonPersonPossessor = new Set([
  "that",
  "here",
  "it",
  "what",
  "there",
  "let",
  "who",
  "he",
  "she",
  "where",
  "how",
  "today",
  "tonight",
  "tomorrow",
  "yesterday",
  "day",
  "night",
  "morning",
  "evening",
  "week",
  "weekend",
  "month",
  "year",
  "term",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "class",
  "lesson",
  "session",
  "unit",
  "chapter",
]);
const doVerb = new Set(["do", "does", "did", "doing", "done"]);
// "Check your homework", "invent homework": the homework is the object of another activity.
const activityVerb = new Set([
  "check",
  "checked",
  "checking",
  "review",
  "reviewed",
  "reviewing",
  "correct",
  "corrected",
  "correcting",
  "mark",
  "marked",
  "marking",
  "compare",
  "compared",
  "comparing",
  "discuss",
  "discussed",
  "discussing",
  "invent",
  "invented",
  "inventing",
]);
const determiner = new Set(["the", "your", "this", "that", "these", "those", "a", "some"]);
// "homework answers/review" checks earlier work in class.
const checkingNoun = new Set([
  "answer",
  "answers",
  "review",
  "reviews",
  "check",
  "checks",
  "checking",
  "correction",
  "corrections",
  "feedback",
]);

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokens(text: string, offset = 0): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}']+/gu), (match) => ({
    text: match[0].toLocaleLowerCase("en"),
    start: offset + (match.index ?? 0),
    end: offset + (match.index ?? 0) + match[0].length,
  }));
}

/** Sentences end at ! ? ; and line breaks, and at a full stop that ends a sentence (not "p. 12"). */
function sentenceAround(text: string, start: number, end: number) {
  const boundary = (index: number) => {
    const character = text[index] ?? "";
    if (/[!?;\n。！？；؟؛۔]/u.test(character)) return true;
    return character === "." && /^(?:\s+[^\s\p{Ll}\p{N}]|\s*$)/u.test(text.slice(index + 1));
  };
  let from = start;
  while (from > 0 && !boundary(from - 1)) from -= 1;
  let to = end;
  while (to < text.length && !boundary(to)) to += 1;
  return { from, to, question: /[?？؟]/u.test(text[to] ?? "") };
}

function negates(words: readonly Token[], index: number, exceptions: ReadonlySet<string>): boolean {
  const word = words[index];
  if (!word || !negator.test(word.text)) return false;
  const next = words[index + 1]?.text ?? "";
  return !exceptions.has(next) && !/^\p{N}/u.test(next);
}

/** A negator scopes over the marker within its clause: a clause word or a contrast ends it. */
function negated(text: string, from: number, to: number, start: number, end: number): boolean {
  if (/(?<![\p{L}\p{N}])n\/a(?![\p{L}\p{N}])/iu.test(text.slice(from, to))) return true;
  const before = tokens(text.slice(from, start), from);
  for (let index = 0; index < before.length; index += 1)
    if (
      negates(before, index, leadingNegatorException) &&
      !before.slice(index + 1).some((word) => clauseWord.has(word.text))
    )
      return true;
  // "Homework: none" is negated; "for next class, not exercise 4" and "(not optional)" are not.
  const following = text.slice(end, to);
  const contrast = following.search(/[,(]/u);
  const after = tokens(contrast < 0 ? following : following.slice(0, contrast), end);
  for (let index = 0; index < after.length; index += 1) {
    if (clauseWord.has(after[index]?.text ?? "")) break;
    if (negates(after, index, trailingNegatorException)) return true;
  }
  return false;
}

/** "Wei's homework", "my homework", "do homework" and "check your homework" describe work. */
function describesWork(text: string, from: number, start: number, end: number): boolean {
  const before = tokens(text.slice(from, start), from);
  const adjacent: Token[] = [];
  let edge = start;
  for (const word of before.reverse()) {
    if (adjacent.length === 2 || text.slice(word.end, edge).trim()) break;
    adjacent.push(word);
    edge = word.start;
  }
  if (doVerb.has(adjacent[0]?.text ?? "")) return true;
  const verb = adjacent.find((word) => !determiner.has(word.text));
  if (verb && activityVerb.has(verb.text)) return true;
  if (
    adjacent.some((word) => {
      if (possessivePronoun.has(word.text)) return true;
      const owner = /^(.+?)(?:'s|s')$/u.exec(word.text)?.[1];
      return owner !== undefined && !nonPersonPossessor.has(owner);
    })
  )
    return true;
  const next = tokens(text.slice(end, end + 40), end)[0];
  return !!next && !text.slice(end, next.start).trim() && checkingNoun.has(next.text);
}

function affirmative(text: string, start: number, end: number, homeworkWord: boolean): boolean {
  const { from, to, question } = sentenceAround(text, start, end);
  if (question) return false;
  // A labelled example sentence illustrates usage; it does not set work.
  if (/(?<![\p{L}\p{N}])(?:examples?\s*:|e\.g\.)/iu.test(text.slice(from, start))) return false;
  if (homeworkWord && describesWork(text, from, start, end)) return false;
  return !negated(text, from, to, start, end);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, words: readonly string[], unspaced: boolean): boolean {
  if (!words.length) return false;
  const lower = text.toLocaleLowerCase();
  if (unspaced) return words.some((word) => lower.includes(word.toLocaleLowerCase()));
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${words.map(escapePattern).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

/** Localized labels count only as a heading: "تکالیف جلسه بعد: ...", "宿題：...", or alone. */
function localizedHeading(text: string, explanationLanguage: string): boolean {
  const { labels, negators, unspaced } = studyHomeworkMarkers(explanationLanguage);
  if (!labels.length) return false;
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const body = line.replace(/^\s*(?:[-*•▪◦·]|\p{N}+[.)])?\s*/u, "");
    const colon = body.search(/[:：]/u);
    const label = (colon < 0 ? body.replace(/[.!。！]+\s*$/u, "") : body.slice(0, colon)).trim();
    const words = label.split(/\s+/u).filter(Boolean);
    if (!words.length || words.length > 4 || Array.from(label).length > 40 || /\p{N}/u.test(label))
      continue;
    const lower = label.toLocaleLowerCase();
    const heading =
      colon < 0
        ? labels.some((entry) => entry.toLocaleLowerCase() === lower)
        : unspaced
          ? labels.some((entry) => lower.endsWith(entry.toLocaleLowerCase()))
          : containsWord(label, labels, false);
    if (!heading || containsWord(line, negators, unspaced)) continue;
    const start = lineStart + line.indexOf(label);
    if (affirmative(text, start, start + label.length, false)) return true;
  }
  return false;
}

/** True when the text affirmatively sets work for after class. */
export function statesAssignment(source: string, explanationLanguage: string): boolean {
  const text = source.normalize("NFC").replace(/[’‘ʼ]/gu, "'");
  for (const match of text.matchAll(englishMarker)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const following = text.slice(end);
    if (/^due$/iu.test(match[0]) && /^\s+to(?![\p{L}\p{N}])/iu.test(following)) continue;
    // "assigned to groups" and "assign roles to" organise class work; they set nothing.
    if (/^assign(?:ed)?$/iu.test(match[0]) && /^\s+to(?![\p{L}\p{N}])/iu.test(following)) continue;
    if (affirmative(text, start, end, match[1] !== undefined)) return true;
  }
  return localizedHeading(text, explanationLanguage);
}

/** A short label block that can announce the blocks after it, such as "Homework" or "HW:". */
export function isAnnouncingHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || Array.from(trimmed).length > 80) return false;
  if (/[:：]$/u.test(trimmed)) return true;
  return trimmed.split(/\s+/u).length <= 4 && !/[.!?。！？؟]$/u.test(trimmed);
}
