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
])("extracts a conservative lexical target from %s", (en, text, parts) => {
  expect(studyLexicalTarget(en as string)).toEqual({ text, parts });
});

it.each([
  "look forward to + verb or mystery",
  "wear and tear / take off",
  "kit sth out +",
  "lose (lost, lost)",
  "look forward to (preposition to + noun or -ing form)",
  "past participle (lost, seen, gone, done)",
  "have/has + past participle",
  "look <b>forward</b> to",
  "واژه",
])("declines unsupported or ambiguous target notation: %s", (en) => {
  expect(studyLexicalTarget(en)).toBeUndefined();
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
