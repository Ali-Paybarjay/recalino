import { expect, it } from "vitest";
import type { VoiceCandidate } from "./contracts";
import {
  rankVoiceCandidates,
  suggestedVoice,
  suggestibleVoice,
  VOICE_SUGGESTION_MIN_SPEECH_MS,
} from "./matching";
import { VOICE_REFERENCE_MIN_SPEECH_MS } from "./policy";

const clip = { startMs: 1000, endMs: 7000, text: "" };
const voice = (id: string, cleanSpeechMs: number, clips = 1): VoiceCandidate => ({
  id,
  label: id,
  score: null,
  cleanSpeechMs,
  clips: Array.from({ length: clips }, () => clip),
  lines: [],
});
const noSample = { enabled: true, version: 1, modelVersion: null, embeddings: [] };

it("FR-VOC-003 workstream 4: an unscored tie is ranked by clean speech, never by its hash id", () => {
  // 2026-10-12 class: the stored suggestion was a 0 s voice that sorted first by its hash id.
  const ranked = rankVoiceCandidates(
    [voice("speaker:a:000", 0, 0), voice("speaker:a:fff", 42500), voice("speaker:a:111", 3000)],
    [],
    noSample,
    "v1",
  );
  expect(ranked.map((item) => item.id)).toEqual([
    "speaker:a:fff",
    "speaker:a:111",
    "speaker:a:000",
  ]);
});

it("FR-VOC-003 workstream 4: scored voices still lead, by score", () => {
  const ranked = rankVoiceCandidates(
    [voice("loud", 90000), voice("quiet", 21000)],
    [
      { speakerId: "loud", vector: [0, 1] },
      { speakerId: "quiet", vector: [1, 0] },
    ],
    {
      enabled: true,
      version: 1,
      modelVersion: "v1",
      embeddings: [{ vector: [1, 0], modelVersion: "v1", analysisId: null, createdAt: "x" }],
    },
    "v1",
  );
  expect(ranked.map((item) => item.id)).toEqual(["quiet", "loud"]);
});

it("FR-VOC-004 workstream 4: a fragment is never the suggested voice", () => {
  expect(VOICE_SUGGESTION_MIN_SPEECH_MS).toBe(VOICE_REFERENCE_MIN_SPEECH_MS);
  // No voiceprint (under 20 s clean speech), no excerpt, or no acoustic check at all.
  expect(suggestibleVoice(voice("short", 19999), true)).toBe(false);
  expect(suggestibleVoice(voice("silent", 59700, 0), true)).toBe(false);
  expect(suggestibleVoice(voice("labels", 59700), false)).toBe(false);
  expect(suggestibleVoice(voice("clear", 20000), true)).toBe(true);
  const ranked = [voice("fragment-a", 0, 0), voice("fragment-b", 8400), voice("clear", 59900)];
  expect(suggestedVoice(ranked, true)?.id).toBe("clear");
  expect(suggestedVoice(ranked, true, ["clear"])).toBeNull();
  expect(suggestedVoice(ranked, false)).toBeNull();
});
