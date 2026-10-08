import { expect, it } from "vitest";
import type { VoiceUtterance } from "./contracts";
import { findRepeatedVoiceEvidence, hasRepeatableVoiceEvidence } from "./spoken-evidence";

const first: VoiceUtterance = {
  id: "one",
  speakerId: "learner",
  startMs: 1000,
  endMs: 4000,
  text: "I am agree with you.",
  eligible: true,
};
const second: VoiceUtterance = { ...first, id: "two", startMs: 20000, endMs: 25000 };
const mistake = {
  utteranceId: "one",
  said: "I **am agree** with you.",
  correct: "I agree with you.",
};

it("requires an independent, temporally separated eligible quote from the same speaker", () => {
  expect(findRepeatedVoiceEvidence([first, second], mistake, "learner")).toBe(second);
  expect(findRepeatedVoiceEvidence([first], mistake, "learner")).toBeNull();
  for (const change of [
    { speakerId: "classmate" },
    { eligible: false },
    { id: first.id },
    { startMs: 3000, endMs: 5000 },
    { startMs: 5000, endMs: 8000 },
    { text: "I agree with you." },
  ]) {
    expect(
      findRepeatedVoiceEvidence([first, { ...second, ...change }], mistake, "learner"),
    ).toBeNull();
  }
  expect(
    findRepeatedVoiceEvidence([{ ...first, eligible: false }, second], mistake, "learner"),
  ).toBeNull();
});

it("does not count tiny fragments, word substrings, quoted speech or same-breath corrections", () => {
  for (const said of ["a", "go", "I am"]) {
    expect(findRepeatedVoiceEvidence([first, second], { ...mistake, said }, "learner")).toBeNull();
  }
  const unrelated = [first, second].map((item) => ({ ...item, text: "We forego homeowners." }));
  expect(
    findRepeatedVoiceEvidence(
      unrelated,
      { ...mistake, said: "go home", correct: "went home" },
      "learner",
    ),
  ).toBeNull();
  const repaired = { ...first, text: "I am agree with you. Sorry, I agree with you." };
  expect(findRepeatedVoiceEvidence([repaired, second], mistake, "learner")).toBeNull();
  const quoted = { ...second, text: 'The handout says "I am agree with you."' };
  expect(findRepeatedVoiceEvidence([first, quoted], mistake, "learner")).toBeNull();
});

it("PRD-COST-02: reports repeatable evidence only when a paid correction could be corroborated", () => {
  expect(hasRepeatableVoiceEvidence([first, second])).toBe(true);
  expect(hasRepeatableVoiceEvidence([second, first])).toBe(true);
  // One stored turn, as in a sampled long class, can never supply a second occurrence.
  expect(hasRepeatableVoiceEvidence([first])).toBe(false);
  expect(hasRepeatableVoiceEvidence([])).toBe(false);
  for (const change of [
    { speakerId: "classmate" },
    { eligible: false },
    { id: first.id },
    { startMs: 5000, endMs: 8000 },
    { startMs: 20000, endMs: 21000 },
    { text: "Sorry, I mean I agree with you." },
    { text: "She said “I am agree with you.”" },
  ])
    expect(hasRepeatableVoiceEvidence([first, { ...second, ...change }])).toBe(false);
});
