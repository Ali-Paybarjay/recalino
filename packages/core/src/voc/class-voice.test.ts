import { expect, it } from "vitest";
import { classVoiceEntries, scoreTargetTurns } from "./analysis";
import type { VoiceAnalysisView, VoiceCandidate, VoiceUtterance } from "./contracts";

const clip = { startMs: 1000, endMs: 7000, text: "" };
const candidate = (id: string, cleanSpeechMs: number, score: number | null = null) =>
  ({
    id,
    label: `Voice ${id}`,
    score,
    cleanSpeechMs,
    clips: [clip],
    lines: [],
  }) satisfies VoiceCandidate;
const part = (
  id: string,
  candidates: VoiceCandidate[],
  links: Record<string, string>,
  extra: Partial<VoiceAnalysisView> = {},
): VoiceAnalysisView => ({
  id,
  version: 1,
  sourceId: `source-${id}`,
  status: "unverified",
  candidateId: null,
  verifiedSpeakerId: null,
  verificationMethod: null,
  reason: null,
  candidates,
  shortCandidateIds: candidates.filter((item) => item.cleanSpeechMs < 20000).map((item) => item.id),
  speakerLinks: Object.fromEntries(
    Object.entries(links).map(([speakerId, voiceId]) => [
      speakerId,
      { voiceId, ambiguous: voiceId.endsWith("?") },
    ]),
  ),
  ...extra,
});

it("PRD-SPK-02 one class voice per linked person, suggested once for the whole class", () => {
  // Six parts of the 2026-10-12 class: the dominant voice is "speaker 1" in each part.
  const parts = Array.from({ length: 6 }, (_, index) =>
    part(
      `part-${index}`,
      [candidate(`p${index}-dominant`, 45000), candidate(`p${index}-fragment`, 900)],
      { [`p${index}-dominant`]: "p0-dominant" },
    ),
  );
  const view = classVoiceEntries(parts);
  expect(view.voices).toEqual([
    {
      id: "p0-dominant",
      label: "Voice 1",
      ambiguous: false,
      cleanSpeechMs: 270000,
      members: parts.map((item, index) => ({
        analysisId: item.id,
        speakerId: `p${index}-dominant`,
      })),
    },
  ]);
  expect(view.candidateId).toBe("p0-dominant");
});

it("FR-VOC-004 workstream 4: the class suggestion is the best-scored voice; none once decided", () => {
  const parts = [
    part("a", [candidate("a1", 60000, 0.4), candidate("a2", 25000, 0.8)], { a1: "a1", a2: "a2" }),
    part("b", [candidate("b1", 30000, 0.5), candidate("b2", 21000, 0.7)], { b1: "a1", b2: "a2" }),
  ];
  const view = classVoiceEntries(parts);
  expect(view.voices.map((voice) => [voice.id, voice.label])).toEqual([
    ["a2", "Voice 1"],
    ["a1", "Voice 2"],
  ]);
  expect(view.candidateId).toBe("a2");
  expect(
    classVoiceEntries(parts.map((item) => ({ ...item, status: "verified" as const }))).candidateId,
  ).toBeNull();
});

it("FR-VOC-002 workstream 4: an ambiguous link stays visible on its class voice", () => {
  const view = classVoiceEntries([part("a", [candidate("a1", 30000)], { a1: "a1?" })]);
  expect(view.voices[0]?.ambiguous).toBe(true);
});

it("draft FR-VOC v3: turns are scored against the learner's own sample only, never stored", () => {
  const utterances: VoiceUtterance[] = [
    { id: "u1", speakerId: "s1", startMs: 0, endMs: 1800, text: "I goed", eligible: false },
    { id: "u2", speakerId: "s2", startMs: 5000, endMs: 9000, text: "Hello", eligible: true },
    {
      id: "u3",
      speakerId: "s2",
      startMs: 9000,
      endMs: 9900,
      text: "ok",
      eligible: false,
      targetScore: 0.9,
    },
  ];
  const enrollment = {
    embeddings: [
      { vector: [1, 0], modelVersion: "v1", analysisId: null, createdAt: "x" },
      // A confirmed class reference is not the sample; turns are compared with the sample.
      { vector: [0, 1], modelVersion: "v1", analysisId: "lesson", createdAt: "x" },
    ],
  };
  const scored = scoreTargetTurns(
    utterances,
    [
      { utteranceId: "u1", vector: [1, 0] },
      { utteranceId: "u2", vector: [0, 1] },
      { utteranceId: "u2", vector: [0.6, 0.8] },
    ],
    enrollment,
    "v1",
  );
  expect(scored.map((item) => item.targetScore)).toEqual([1, 0.6, undefined]);
  // Another model revision has no sample to compare with: nothing is scored.
  expect(
    scoreTargetTurns(utterances, [{ utteranceId: "u1", vector: [1, 0] }], enrollment, "v2").map(
      (item) => item.targetScore,
    ),
  ).toEqual([undefined, undefined, undefined]);
});

it("diagnosis 2026-10-12: a dominant voice scoring 0.70–0.77 does not flood the proposed lines", () => {
  // Unit vectors with a chosen cosine to the sample e0: [c, sqrt(1 - c²), 0, …].
  const at = (c: number) => [c, Math.sqrt(1 - c * c), ...Array<number>(14).fill(0)];
  const sample = at(1);
  const utterances: VoiceUtterance[] = [
    {
      id: "t1",
      speakerId: "teacher",
      startMs: 0,
      endMs: 3000,
      text: "Open your books.",
      eligible: true,
    },
    {
      id: "t2",
      speakerId: "teacher",
      startMs: 5000,
      endMs: 8000,
      text: "Page ten.",
      eligible: true,
    },
    // The learner's own turn, merged into the teacher's voice by the diarizer.
    {
      id: "l1",
      speakerId: "teacher",
      startMs: 20000,
      endMs: 22000,
      text: "I goes there.",
      eligible: true,
    },
    // The learner's turn in a fragment voice without a voiceprint: the plain score counts.
    {
      id: "l2",
      speakerId: "fragment",
      startMs: 40000,
      endMs: 42000,
      text: "Yes, I goes.",
      eligible: true,
    },
  ];
  const scored = scoreTargetTurns(
    utterances,
    [
      { utteranceId: "t1", vector: at(0.72) },
      { utteranceId: "t2", vector: at(0.77) },
      { utteranceId: "l1", vector: at(0.8) },
      { utteranceId: "l2", vector: at(0.65) },
    ],
    { embeddings: [{ vector: sample, modelVersion: "v1", analysisId: null, createdAt: "x" }] },
    "v1",
    // The teacher's pooled voiceprint scores 0.75 against the near-field sample (far microphone).
    [{ speakerId: "teacher", vector: at(0.75) }],
  );
  expect(scored.map((item) => item.targetScore?.toFixed(2))).toEqual([
    undefined,
    "0.77",
    "0.80",
    "0.65",
  ]);
  // At the 0.6 floor: the learner's two turns and one teacher turn that beat the teacher's own
  // voiceprint; the teacher's typical turn is not proposed. Recall 2/2, precision 2/3 here.
  expect(scored.filter((item) => (item.targetScore ?? -1) >= 0.6).map((item) => item.id)).toEqual([
    "t2",
    "l1",
    "l2",
  ]);
});
