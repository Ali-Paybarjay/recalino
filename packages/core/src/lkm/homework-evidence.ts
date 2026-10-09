import { studyHomeworkMarkers } from "./study-locale";

type Markers = ReturnType<typeof studyHomeworkMarkers>;

/**
 * Source text that sets work for after class. A deterministic, deliberately lexical test: it errs
 * towards "not an assignment", because the generation projection only moves an unsupported
 * homework claim to the class summary and never deletes or rejects it. Source text is data only.
 */
const englishMarker =
  /(?<![\p{L}\p{N}])(?:(home[ -]?works?|home[ -]?tasks?|hw|h\/w|h\.w\.?)|assign(?:ed|ments?)?|due|(?:for|before|by|until) +(?:(?:the|our|your) +)?next +(?:class|lesson|session|week|time|meeting)s?)(?![\p{L}\p{N}])/giu;
const englishLabel = new RegExp(englishMarker.source, "iu");
const negator = /^(?:no|not|never|without|nor|none|nothing|cannot)$|n't$/u;
const notWord = /^not$|n't$/u;
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
// After the marker only quantity words and "not optional" are exempt: "Homework not done" negates.
const trailingNegatorException = new Set(["much", "only", "just", "optional"]);
// In announced content "Homework: not optional" and "HW: don't forget ..." still set work.
const announcedNegatorException = new Set(["forget", "fail", "much", "only", "just", "optional"]);
// After a comma or "(" a "not" contrasts ("homework, not classwork", "Homework (not optional!)")
// unless it states absence: "Homework, not this week", "HW (not set)".
const absentAfterNot = new Set([
  "this",
  "today",
  "tonight",
  "tomorrow",
  "now",
  "yet",
  "set",
  "given",
  "assigned",
  "required",
  "needed",
  "necessary",
  "due",
  "done",
  "applicable",
]);
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

/** A short label line whose content follows it: "Homework", "HW:", "Tonight's homework:", "تکالیف". */
function labelLine(line: string, markers: Markers): boolean {
  const label = line.replace(/^\s*(?:[-*•▪◦·]|\p{N}+[.)])?\s*/u, "").replace(/[\s:：–—-]+$/u, "");
  const words = label.split(/\s+/u).filter(Boolean);
  // "Homework: page twelve" already carries its content on the line.
  if (!words.length || words.length > 4 || /[\p{N}?？؟:：]|\s[-–—]/u.test(label)) return false;
  return englishLabel.test(label) || containsWord(label, markers.labels, markers.unspaced);
}

/**
 * Sentences end at ! ? ; and line breaks, and at a full stop that ends a sentence (not "p. 12").
 * A label line does not end one: "Homework:\nNone this week." is a single statement.
 */
function sentenceAround(text: string, start: number, end: number, markers: Markers) {
  const boundary = (index: number) => {
    const character = text[index] ?? "";
    if (character === "\n") {
      const head = text.slice(0, index).trimEnd();
      return !labelLine(head.slice(head.lastIndexOf("\n") + 1), markers);
    }
    if (/[!?;。！？；؟؛۔]/u.test(character)) return true;
    return character === "." && /^(?:\s+[^\s\p{Ll}\p{N}]|\s*$)/u.test(text.slice(index + 1));
  };
  let from = start;
  while (from > 0 && !boundary(from - 1)) from -= 1;
  let to = end;
  while (to < text.length && !boundary(to)) to += 1;
  return { from, to, question: /[?？؟]/u.test(text[to] ?? "") };
}

/**
 * English negators and the explanation language's code-owned negators: whole words in spaced
 * scripts; in unspaced scripts substrings, but only where the caller allows them.
 */
function isNegator(word: string, markers: Markers, substrings: boolean): boolean {
  if (negator.test(word)) return true;
  if (markers.unspaced) return substrings && markers.negators.some((entry) => word.includes(entry));
  return markers.negators.some((entry) => entry.toLocaleLowerCase("en") === word);
}

function negates(
  words: readonly Token[],
  index: number,
  exceptions: ReadonlySet<string>,
  markers: Markers,
): boolean {
  const word = words[index];
  if (!word || !isNegator(word.text, markers, true)) return false;
  const next = words[index + 1]?.text ?? "";
  return !exceptions.has(next) && !/^\p{N}/u.test(next);
}

function announcedNegation(
  words: readonly Token[],
  index: number,
  contrast: boolean,
  markers: Markers,
): boolean {
  const word = words[index];
  if (!word || !isNegator(word.text, markers, false)) return false;
  const next = words[index + 1]?.text;
  if (next === undefined) return true;
  if (contrast && notWord.test(word.text)) return absentAfterNot.has(next);
  return !announcedNegatorException.has(next) && !/^\p{N}/u.test(next);
}

/**
 * The content a heading announces says there is no work: "none", "not this week", "ندارید",
 * "なし". Apart from none/nothing/nil only its edges count (or every word of a short content), so
 * "Do not use a dictionary for exercise 3" and "تمرین ۳ را بدون دیکشنری حل کنید" still set work.
 * Unspaced scripts count only short content or a leading negator, never "使わないで" mid-way.
 */
function announcesNothing(content: string, contrast: boolean, markers: Markers): boolean {
  if (markers.unspaced) {
    const compact = content.replace(/[^\p{L}\p{N}]/gu, "");
    const short = Array.from(compact).length <= 8;
    if (
      markers.negators.some(
        (entry) =>
          (short && compact.includes(entry)) ||
          (Array.from(entry).length > 1 && compact.startsWith(entry)),
      )
    )
      return true;
  }
  const words = tokens(content);
  // "Homework: -" and "HW: —" announce nothing.
  if (!words.length) return /^[\s\p{P}]*[-–—][\s\p{P}]*$/u.test(content);
  const absent = words.some(
    (word, index) =>
      /^(?:none|nothing|nil)$/u.test(word.text) &&
      !/^(?:but|except)$/u.test(words[index + 1]?.text ?? ""),
  );
  if (absent) return true;
  if (words.length <= 4)
    return words.some((_, index) => announcedNegation(words, index, contrast, markers));
  return (
    announcedNegation(words, 0, contrast, markers) ||
    announcedNegation(words, words.length - 1, contrast, markers)
  );
}

/**
 * A negator scopes over the marker within its clause: a clause word or a contrast ends it. A
 * heading marker ("Homework:", "HW (", "Homework for Monday:", a label line) is judged with the
 * content it announces; when that content has its own marker, that marker decides instead.
 */
function negated(
  text: string,
  from: number,
  to: number,
  start: number,
  end: number,
  heading: boolean,
  markers: Markers,
): boolean {
  if (/(?<![\p{L}\p{N}])n\/a(?![\p{L}\p{N}])/iu.test(text.slice(from, to))) return true;
  const before = tokens(text.slice(from, start), from);
  for (let index = 0; index < before.length; index += 1)
    if (
      negates(before, index, leadingNegatorException, markers) &&
      !before.slice(index + 1).some((word) => clauseWord.has(word.text))
    )
      return true;
  const following = text.slice(end, to);
  if (heading) {
    const label =
      /^((?:[^\S\n]+[\p{L}\p{N}']+){0,3})[^\S\n]*(?:[:：]|[^\S\n][-–—]+(?=\s|$)|(?=\n))/u.exec(
        following,
      );
    const open = label ? null : /^[^\S\n]*[,(]/u.exec(following);
    const separator = label ?? open;
    if (separator) {
      const content = following.slice(separator[0].length);
      if (englishLabel.test(content)) return true;
      const words = tokens(label?.[1] ?? "");
      return (
        words.some((_, index) => negates(words, index, trailingNegatorException, markers)) ||
        announcesNothing(content, !!open, markers)
      );
    }
  }
  // "Homework not done" is negated; "for next class, not exercise 4" and "due on Friday, not
  // Monday" are not.
  const contrast = following.search(/[,(]/u);
  const after = tokens(contrast < 0 ? following : following.slice(0, contrast), end);
  for (let index = 0; index < after.length; index += 1) {
    if (clauseWord.has(after[index]?.text ?? "")) break;
    if (negates(after, index, trailingNegatorException, markers)) return true;
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

function affirmative(
  text: string,
  start: number,
  end: number,
  marker: { homeworkWord: boolean; heading: boolean },
  markers: Markers,
): boolean {
  const { from, to, question } = sentenceAround(text, start, end, markers);
  if (question) return false;
  // A labelled example sentence illustrates usage; it does not set work.
  if (/(?<![\p{L}\p{N}])(?:examples?\s*:|e\.g\.)/iu.test(text.slice(from, start))) return false;
  if (marker.homeworkWord && describesWork(text, from, start, end)) return false;
  return !negated(text, from, to, start, end, marker.heading, markers);
}

/** Localized labels count only as a heading: "تکالیف جلسه بعد: ...", "宿題：...", or alone. */
function localizedHeading(text: string, markers: Markers): boolean {
  const { labels, negators, unspaced } = markers;
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
    // A negator in the label voids it ("Keine Hausaufgaben:"); negated() judges the content.
    if (!heading || containsWord(label, negators, unspaced)) continue;
    const start = lineStart + line.indexOf(label);
    const marker = { homeworkWord: false, heading: true };
    if (affirmative(text, start, start + label.length, marker, markers)) return true;
  }
  return false;
}

/** True when the text affirmatively sets work for after class. */
export function statesAssignment(source: string, explanationLanguage: string): boolean {
  const text = source.normalize("NFC").replace(/[’‘ʼ]/gu, "'");
  const markers = studyHomeworkMarkers(explanationLanguage);
  for (const match of text.matchAll(englishMarker)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const following = text.slice(end);
    if (/^due$/iu.test(match[0]) && /^\s+to(?![\p{L}\p{N}])/iu.test(following)) continue;
    // "assigned to groups" and "assign roles to" organise class work; they set nothing.
    if (/^assign(?:ed)?$/iu.test(match[0]) && /^\s+to(?![\p{L}\p{N}])/iu.test(following)) continue;
    const homeworkWord = match[1] !== undefined;
    const heading = homeworkWord || /^assignments?$/iu.test(match[0]);
    if (affirmative(text, start, end, { homeworkWord, heading }, markers)) return true;
  }
  return localizedHeading(text, markers);
}

/** A short label block that can announce the blocks after it, such as "Homework" or "HW:". */
export function isAnnouncingHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || Array.from(trimmed).length > 80) return false;
  if (/[:：]$/u.test(trimmed)) return true;
  return trimmed.split(/\s+/u).length <= 4 && !/[.!?。！？؟]$/u.test(trimmed);
}
