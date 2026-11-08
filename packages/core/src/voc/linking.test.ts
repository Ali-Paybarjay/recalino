import { expect, it } from "vitest";
import { type LinkableVoice, linkClassVoices, speakerLinksByAnalysis } from "./linking";

/** Unit vector at `degrees` in the plane: cosine between two is cos(difference). */
const at = (degrees: number) => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];
const v = (
  analysisId: string,
  speakerId: string,
  degrees: number,
  model = "v1",
): LinkableVoice => ({
  analysisId,
  speakerId,
  modelVersion: model,
  vector: at(degrees),
});
const groups = (voices: LinkableVoice[], options?: { threshold?: number; margin?: number }) =>
  linkClassVoices(voices, options)
    .map((voice) => ({
      ambiguous: voice.ambiguous,
      members: voice.members.map((member) => member.speakerId).sort(),
    }))
    .sort((a, b) => (a.members[0] ?? "").localeCompare(b.members[0] ?? ""));

it("PRD-SPK-02 links the same voice across three recording parts and keeps others apart", () => {
  // Teacher about 0°, learner about 80°: within a person cos ≥ 0.98, across people about 0.17.
  const result = groups([
    v("part-1", "p1-teacher", 0),
    v("part-1", "p1-learner", 80),
    v("part-2", "p2-teacher", 5),
    v("part-2", "p2-learner", 84),
    v("part-3", "p3-teacher", 3),
  ]);
  expect(result).toEqual([
    { ambiguous: false, members: ["p1-learner", "p2-learner"] },
    { ambiguous: false, members: ["p1-teacher", "p2-teacher", "p3-teacher"] },
  ]);
});

it("FR-VOC-002 never links two voices of the same part, however alike", () => {
  const result = groups([v("part-1", "a", 0), v("part-1", "b", 1)]);
  expect(result).toEqual([
    { ambiguous: false, members: ["a"] },
    { ambiguous: false, members: ["b"] },
  ]);
});

it("FR-VOC-002 complete linkage: a chain of resemblances does not join both ends", () => {
  // a~b and b~c pass 0.65 (cos 45° ≈ 0.71) but a~c does not (cos 90° = 0).
  const result = groups([v("p1", "a", 0), v("p2", "b", 45), v("p3", "c", 90)], { margin: 0 });
  expect(result.some((group) => group.members.includes("a") && group.members.includes("c"))).toBe(
    false,
  );
});

it("FR-VOC-002 a voice like two voices of another part is not linked and stays ambiguous", () => {
  // Part 2 has two voices almost equally like part 1's voice: no guess is made.
  const result = groups([v("p1", "x", 0), v("p2", "y", 10), v("p2", "z", -11)]);
  expect(result).toEqual([
    { ambiguous: true, members: ["x"] },
    { ambiguous: true, members: ["y"] },
    { ambiguous: true, members: ["z"] },
  ]);
});

it("FR-VOC-002 a conflict resolved by a later join leaves no stale ambiguous flag", () => {
  // Round 1: a (p1) is almost equally like b and c (both p2), so a~b and a~c are ambiguous;
  // c~d (p3) then joins. Round 2: a~b has no close rival left (a~{c,d} ≈ 0.87) and joins.
  // Neither final group has a close rival in the last round, so neither is ambiguous.
  const result = groups([v("p1", "a", 0), v("p2", "b", 10), v("p2", "c", -11), v("p3", "d", -30)]);
  expect(result).toEqual([
    { ambiguous: false, members: ["a", "b"] },
    { ambiguous: false, members: ["c", "d"] },
  ]);
});

it("FR-VOC-002 voices below the threshold or of another model revision stay apart", () => {
  expect(groups([v("p1", "a", 0), v("p2", "b", 60)])).toEqual([
    { ambiguous: false, members: ["a"] },
    { ambiguous: false, members: ["b"] },
  ]);
  expect(groups([v("p1", "a", 0, "v1"), v("p2", "b", 0, "v2")])).toEqual([
    { ambiguous: false, members: ["a"] },
    { ambiguous: false, members: ["b"] },
  ]);
});

it("FR-VOC-002 linking is deterministic and the class voice id is a member's own id", () => {
  const voices = [v("p2", "s2", 2), v("p1", "s1", 0), v("p3", "s3", 1)];
  const first = linkClassVoices(voices);
  expect(linkClassVoices([...voices].reverse())).toEqual(first);
  expect(first).toHaveLength(1);
  expect(first[0]?.id).toBe("s1");
  const links = speakerLinksByAnalysis(first);
  expect(links.get("p3")).toEqual({ s3: { voiceId: "s1", ambiguous: false } });
});
