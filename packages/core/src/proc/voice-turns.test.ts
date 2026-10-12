import { expect, it } from "vitest";
import { DEFAULT_VOICE_SETTINGS } from "../voc";
import { scopedVoiceSpeakerId, turnEmbeddings, voiceDiarizationOptions } from "./voice-processing";

const sourceId = "12345678-1234-4234-8234-123456789abc";
const speaker = (label: string) => scopedVoiceSpeakerId(sourceId, "whole-source", label);
const vector = Array.from({ length: 16 }, (_, index) => (index === 0 ? 1 : 0));

it("draft FR-VOC v3: a turn voiceprint belongs only to the line of its own voice that holds it", () => {
  const utterances = [
    {
      id: "u1",
      speakerId: speaker("speaker_0"),
      startMs: 1000,
      endMs: 3000,
      text: "a",
      eligible: true,
    },
    {
      id: "u2",
      speakerId: speaker("speaker_1"),
      startMs: 3000,
      endMs: 4800,
      text: "b",
      eligible: false,
    },
  ];
  const result = turnEmbeddings(sourceId, utterances, {
    turns: [
      // Inside u1 and of its voice.
      { speakerId: "speaker_0", startMs: 1100, endMs: 2900, embedding: vector },
      // Inside u2's time, but another voice: not attributed to u2.
      { speakerId: "speaker_0", startMs: 3100, endMs: 4700, embedding: vector },
      // Mostly outside any line of its voice (under 80% inside).
      { speakerId: "speaker_1", startMs: 4000, endMs: 6500, embedding: vector },
      { speakerId: "speaker_1", startMs: 3100, endMs: 4700, embedding: vector },
    ],
  });
  expect(result.map((item) => item.utteranceId)).toEqual(["u1", "u2"]);
  expect(turnEmbeddings(sourceId, utterances, {})).toEqual([]);
});

it("workstream 4: only background checks widen coverage; turns follow their switch", () => {
  const off = { ...DEFAULT_VOICE_SETTINGS, targetTurns: false };
  expect(voiceDiarizationOptions(off, true)).toBeUndefined();
  expect(voiceDiarizationOptions(DEFAULT_VOICE_SETTINGS, false)).toEqual({ targetTurnMinMs: 1500 });
  const wide = {
    ...DEFAULT_VOICE_SETTINGS,
    backgroundCoverage: { windowMs: 58000, maxWindows: 16 },
    targetTurns: true,
  };
  expect(voiceDiarizationOptions(wide, false)).toEqual({ targetTurnMinMs: 1500 });
  expect(voiceDiarizationOptions(wide, true)).toEqual({
    plan: { windowMs: 58000, maxWindows: 16 },
    targetTurnMinMs: 1500,
  });
});
