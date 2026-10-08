import { describe, expect, it, vi } from "vitest";
import type { VoiceEngine } from "./voice-engine";
import { embeddingSpans, qualifySegments } from "./voice-engine-quality.mjs";

const decoded = vi.hoisted(() => ({ samples: new Float32Array(0) }));
vi.mock("./audio-preparer", () => ({
  decodeVoiceAudio: async () => ({
    samples: decoded.samples,
    sampleRate: 16000,
    durationMs: Math.ceil(decoded.samples.length / 16),
  }),
}));
const { prepareVoiceSample } = await import("./voice-sample");

/**
 * Synthetic engine for this unit test only: each run of equal non-zero amplitude is one voice
 * turn, then the production turn rules (qualifySegments, embeddingSpans) decide what counts.
 */
function fakeEngine(): VoiceEngine {
  return {
    modelRevision: "unit-test-engine",
    async diarize(samples) {
      const raw: { start: number; end: number; speaker: number }[] = [];
      let start = -1;
      for (let index = 0; index <= samples.length; index++) {
        const value = samples[index] ?? 0;
        const previous = index ? (samples[index - 1] ?? 0) : 0;
        if (value !== previous) {
          if (previous !== 0)
            raw.push({ start: start / 16000, end: index / 16000, speaker: previous > 0.4 ? 1 : 0 });
          start = index;
        }
      }
      const segments = qualifySegments(raw, samples.length / 16);
      const speakers = [...new Set(segments.map((segment) => segment.speakerId))].flatMap(
        (speakerId) => {
          const spans = embeddingSpans(segments, speakerId);
          const cleanSpeechMs = spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
          return spans.length
            ? [{ speakerId, embedding: Array(16).fill(0.25), cleanSpeechMs }]
            : [];
        },
      );
      return { modelRevision: "unit-test-engine", segments, speakers };
    },
    async embed() {
      return Array(16).fill(0.25);
    },
  };
}
const speech = (seconds: number, amplitude = 0.25) =>
  new Float32Array(seconds * 16000).fill(amplitude);

describe("VOICE-AC-02 FR-VOC-001: a valid sample is processed; an invalid one never succeeds", () => {
  it("accepts speech that starts at once and runs up to the automatic stop", async () => {
    decoded.samples = speech(30);
    const sample = await prepareVoiceSample(async () => fakeEngine(), new Uint8Array(100));
    expect(sample).toEqual({
      embedding: Array(16).fill(0.25),
      durationMs: 30000,
      modelRevision: "unit-test-engine",
    });
  });
  it("still requires exactly one voice and enough clean speech", async () => {
    decoded.samples = new Float32Array([...speech(15), ...speech(15, 0.5)]);
    await expect(
      prepareVoiceSample(async () => fakeEngine(), new Uint8Array(100)),
    ).rejects.toMatchObject({ details: { fields: { audio: ["one_clear_voice_required"] } } });
    decoded.samples = new Float32Array([...new Float32Array(16000 * 20), ...speech(10)]);
    await expect(
      prepareVoiceSample(async () => fakeEngine(), new Uint8Array(100)),
    ).rejects.toMatchObject({ details: { fields: { audio: ["one_clear_voice_required"] } } });
  });
  it("rejects a sample outside 15–35 seconds, an empty upload and an unavailable engine", async () => {
    decoded.samples = speech(12);
    await expect(
      prepareVoiceSample(async () => fakeEngine(), new Uint8Array(100)),
    ).rejects.toMatchObject({ details: { fields: { audio: ["voice_sample_duration"] } } });
    await expect(
      prepareVoiceSample(async () => fakeEngine(), new Uint8Array(0)),
    ).rejects.toMatchObject({ details: { fields: { audio: ["voice_sample_size"] } } });
    await expect(
      prepareVoiceSample(() => Promise.reject(new Error("missing")), new Uint8Array(100)),
    ).rejects.toMatchObject({ details: { fields: { voice: ["voice_engine_unavailable"] } } });
  });
});
