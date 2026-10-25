import { expect, it } from "vitest";
import { studyLexicalTarget, studyLexicalTargetMatches } from "./study-target";

it.each([
  ["wear and tear", "wear and tear", ["wear and tear"]],
  ["look forward to + -ing / noun", "look forward to", ["look forward to"]],
  ["look forward to + noun or -ing", "look forward to", ["look forward to"]],
  ["get on with + person", "get on with", ["get on with"]],
  ["get on with sb", "get on with", ["get on with"]],
  ["get on with (sb)", "get on with", ["get on with"]],
  ["clamp down on (sth/sb)", "clamp down on", ["clamp down on"]],
  ["kit sb/sth out", "kit out", ["kit", "out"]],
  ["kit sth out / kit sth out with", "kit out", ["kit", "out"]],
  ["manager (pronunciation)", "manager", ["manager"]],
  ["sick and tired of + noun/-ing", "sick and tired of", ["sick and tired of"]],
  ["be taken in by sb/sth", "be taken in by", ["be taken in by"]],
  ["gig (noun)", "gig", ["gig"]],
  ["donkey's years (noun phrase)", "donkey's years", ["donkey's years"]],
  ["kit out (separable phrasal verb)", "kit out", ["kit", "out"]],
  ["remind sb of sth", "remind of", ["remind", "of"]],
  ["remind somebody of something", "remind of", ["remind", "of"]],
  ["get on with (somebody)", "get on with", ["get on with"]],
  ["somebody", "somebody", ["somebody"]],
  ["someone", "someone", ["someone"]],
  ["something", "something", ["something"]],
  ["Somebody", "Somebody", ["Somebody"]],
  ["somebody (pronunciation)", "somebody", ["somebody"]],
])("extracts a conservative lexical target from %s", (en, text, parts) => {
  expect(studyLexicalTarget(en as string)).toEqual({ text, parts });
});

it.each([
  "look forward to + verb or mystery",
  "wear and tear / take off",
  "kit sth out +",
  "lose (lost, lost)",
  "look forward to (preposition to + noun or -ing form)",
  "gig (noun or verb)",
  "donkey's years (British English: a very long time)",
  "kit out (a separable phrasal verb)",
  "look forward to (separable phrasal verb)",
  "kit mystery (separable phrasal verb)",
  "somebody (separable phrasal verb)",
  "sb",
  "sth",
  "sb/sth",
  "(somebody)",
  "(sb/sth)",
  "past participle (lost, seen, gone, done)",
  "have/has + past participle",
  "look <b>forward</b> to",
  "واژه",
])("declines unsupported or ambiguous target notation: %s", (en) => {
  expect(studyLexicalTarget(en)).toBeUndefined();
});

it("keeps annotated dictionary targets hidden across separated object slots", () => {
  const target = studyLexicalTarget("kit out (separable phrasal verb)");
  const noun = studyLexicalTarget("gig (noun)");
  if (!target || !noun) throw new Error("Missing dictionary-label fixture");
  expect(studyLexicalTargetMatches(target, "They kit the office out.")).toBe(true);
  expect(studyLexicalTargetMatches(target, "They kit ______ out.")).toBe(true);
  expect(studyLexicalTargetMatches(target, "They ______ the office ______.")).toBe(false);
  expect(studyLexicalTargetMatches(noun, "I have a gig on Saturday.")).toBe(true);
  expect(studyLexicalTargetMatches(noun, "I have a ______ on Saturday.")).toBe(false);
});

it("AC-D46-01 hides a taught indefinite pronoun while slot words in a frame stay slots", () => {
  const pronoun = studyLexicalTarget("somebody");
  const frame = studyLexicalTarget("remind sb of sth");
  if (!pronoun || !frame) throw new Error("Missing indefinite pronoun fixture");
  expect(studyLexicalTargetMatches(pronoun, "Somebody left an umbrella on the bus.")).toBe(true);
  expect(studyLexicalTargetMatches(pronoun, "I think somebody's at the door.")).toBe(true);
  expect(studyLexicalTargetMatches(pronoun, "______ left an umbrella on the bus.")).toBe(false);
  expect(studyLexicalTargetMatches(pronoun, "Everybody takes a singular verb.")).toBe(false);
  expect(studyLexicalTargetMatches(pronoun, "Nobody came to the party.")).toBe(false);
  expect(studyLexicalTargetMatches(frame, "Please remind somebody of the meeting.")).toBe(true);
  expect(studyLexicalTargetMatches(frame, "Please ______ somebody ______ the meeting.")).toBe(
    false,
  );
});

it("detects exposed lexical chunks without mistaking an unrelated gap complement for the target", () => {
  const lexical = studyLexicalTarget("look forward to + -ing / noun");
  const separable = studyLexicalTarget("kit sth out");
  if (!lexical || !separable) throw new Error("Missing lexical fixture");
  expect(studyLexicalTargetMatches(lexical, "I look forward to ______ my new neighbours.")).toBe(
    true,
  );
  expect(studyLexicalTargetMatches(lexical, "meeting")).toBe(false);
  expect(studyLexicalTargetMatches(lexical, "I ______ meeting my new neighbours.")).toBe(false);
  expect(studyLexicalTargetMatches(separable, "We need to kit it out.")).toBe(true);
  expect(studyLexicalTargetMatches(separable, "We need to kit the new office out.")).toBe(true);
  expect(studyLexicalTargetMatches(separable, "We need to kit ______ out.")).toBe(true);
  expect(studyLexicalTargetMatches(separable, "We need to ______ it ______.")).toBe(false);
});

it.each([
  ["someone else", "someone else", ["someone else"]],
  ["Someone else", "Someone else", ["Someone else"]],
  ["something like that", "something like that", ["something like that"]],
  ["someone else (pronunciation)", "someone else", ["someone else"]],
  ["do something about sth", "do something about", ["do something about"]],
  ["do something about (sth)", "do something about", ["do something about"]],
  ["have something to do with sb/sth", "have something to do with", ["have something to do with"]],
])(
  "AC-D46-01 keeps a leading or sb/sth-marked spelled-out pronoun literal in %s",
  (en, text, parts) => {
    expect(studyLexicalTarget(en as string)).toEqual({ text, parts });
  },
);

it.each([
  ["let somebody down", "let down", ["let", "down"]],
  ["remind somebody of (something)", "remind of", ["remind", "of"]],
  ["remind sb of (something)", "remind of", ["remind", "of"]],
  ["kit somebody out (separable phrasal verb)", "kit out", ["kit", "out"]],
])("AC-D46-01 keeps spelled-out or parenthesised object slots in %s", (en, text, parts) => {
  expect(studyLexicalTarget(en as string)).toEqual({ text, parts });
});

it.each(["someone off (separable phrasal verb)", "something out (separable phrasal verb)"])(
  "AC-D46-01 declines a separable label whose verb would be a pronoun: %s",
  (en) => {
    expect(studyLexicalTarget(en)).toBeUndefined();
  },
);

it("AC-D46-01 matches a literal pronoun phrase only as one complete chunk", () => {
  const other = studyLexicalTarget("someone else");
  const about = studyLexicalTarget("do something about sth");
  const like = studyLexicalTarget("something like that");
  if (!other || !about || !like) throw new Error("Missing literal pronoun fixture");
  expect(studyLexicalTargetMatches(other, "Please ask someone else to lock up.")).toBe(true);
  expect(studyLexicalTargetMatches(other, "Please ask ______ to lock up.")).toBe(false);
  expect(studyLexicalTargetMatches(other, "Is there anything else to lock up?")).toBe(false);
  expect(studyLexicalTargetMatches(about, "We must do something about the noise.")).toBe(true);
  expect(studyLexicalTargetMatches(about, "We must ______ the noise.")).toBe(false);
  expect(studyLexicalTargetMatches(about, "What do you think about the noise?")).toBe(false);
  expect(studyLexicalTargetMatches(like, "It cost ten pounds or something like that.")).toBe(true);
  expect(studyLexicalTargetMatches(like, "It cost ten pounds or ______.")).toBe(false);
});
