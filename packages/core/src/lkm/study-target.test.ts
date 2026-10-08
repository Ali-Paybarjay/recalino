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
