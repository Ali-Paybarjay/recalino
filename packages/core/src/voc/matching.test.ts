import { expect, it } from "vitest";
import type { VoiceCandidate } from "./contracts";
import {
  autoAcceptVoice,
  calibrateVoiceAcceptance,
  rankVoiceCandidates,
  voiceCosine,
} from "./matching";

const candidates: [VoiceCandidate, VoiceCandidate] = [
  { id: "quiet", label: "Quiet learner", score: null, cleanSpeechMs: 22000, clips: [], lines: [] },
  { id: "loud", label: "Main speaker", score: null, cleanSpeechMs: 900000, clips: [], lines: [] },
];
it("Part6: acoustic similarity ranks a non-dominant learner; incompatible/invalid vectors never match", () => {
  const ranked = rankVoiceCandidates(
    candidates,
    [
      { speakerId: "quiet", vector: [1, 0] },
      { speakerId: "loud", vector: [0, 1] },
    ],
    {
      enabled: true,
      version: 1,
      modelVersion: "v1",
      embeddings: [
        { vector: [1, 0], modelVersion: "v1", analysisId: null, createdAt: "2026-10-06T00:00:00Z" },
      ],
    },
    "v1",
  );
  expect(ranked[0]?.id).toBe("quiet");
  expect(ranked[0]?.score).toBe(1);
  expect(voiceCosine([0, 0], [1, 0])).toBeNull();
  expect(voiceCosine([1], [1, 0])).toBeNull();
  expect(autoAcceptVoice(ranked, null, "v1", 12)).toBeNull();
});
it("Part6: first lesson, sparse/overlapping calibration and small runner-up margins always ask", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({
      sessionId: `lesson-${index}`,
      score: 0.9,
      margin: 0.3,
      accepted: true,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      sessionId: `lesson-${index}`,
      score: 0.7,
      margin: 0.1,
      accepted: false,
    })),
  ];
  const policy = calibrateVoiceAcceptance("v1", rows);
  expect(policy).not.toBeNull();
  expect(calibrateVoiceAcceptance("v1", rows.slice(0, 25))).toBeNull();
  expect(
    calibrateVoiceAcceptance("v1", [
      ...rows,
      { sessionId: "lesson-0", score: 0.95, margin: 0.2, accepted: false },
    ]),
  ).toBeNull();
  const ranked: [VoiceCandidate, VoiceCandidate] = [
    { ...candidates[0], score: 0.95 },
    { ...candidates[1], score: 0.6 },
  ];
  expect(autoAcceptVoice(ranked, policy, "v1", 0)).toBeNull();
  expect(autoAcceptVoice(ranked, policy, "v1", 5)).toBe("quiet");
  expect(
    autoAcceptVoice(
      [
        { ...ranked[0], score: 0.95 },
        { ...ranked[1], score: 0.9 },
      ],
      policy,
      "v1",
      5,
    ),
  ).toBeNull();
  expect(autoAcceptVoice(ranked, policy, "v2", 5)).toBeNull();
});
it("repeated analyses of one lesson cannot create calibration coverage", () => {
  const repeated = Array.from({ length: 30 }, () => [
    { sessionId: "one-lesson", score: 0.95, margin: 0.4, accepted: true },
    { sessionId: "one-lesson", score: 0.5, margin: 0, accepted: false },
  ]).flat();
  expect(calibrateVoiceAcceptance("v1", repeated)).toBeNull();
});
