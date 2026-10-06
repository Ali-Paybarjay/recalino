import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cosineSimilarity,
  loadVoiceEngine,
  poolEmbeddings,
  validateVoicePcm,
} from "./voice-engine";
import { embeddingSpans, qualifySegments } from "./voice-engine-quality.mjs";

describe("local speaker engine trust boundaries", () => {
  it("marks overlapping and contained turns so neither can produce a voiceprint", () => {
    const segments = qualifySegments(
      [
        { start: 1, end: 9, speaker: 0 },
        { start: 3, end: 6, speaker: 1 },
        { start: 10, end: 15, speaker: 0 },
      ],
      16000,
      100000,
    );
    expect(segments.map((item) => item.overlap)).toEqual([true, true, false]);
    expect(embeddingSpans(segments, "speaker_0")).toEqual([{ startMs: 110200, endMs: 114800 }]);
    expect(embeddingSpans(segments, "speaker_1")).toEqual([]);
  });
  it("withholds clipped and short speech and trims two hundred milliseconds on both turn boundaries", () => {
    const segments = qualifySegments(
      [
        { start: 0, end: 5, speaker: 0 },
        { start: 6, end: 8.3, speaker: 0 },
        { start: 9, end: 11.4, speaker: 0 },
        { start: 13, end: 16, speaker: 0 },
      ],
      16000,
    );
    expect(segments.map((item) => item.boundaryUnsafe)).toEqual([true, true, false, true]);
    expect(embeddingSpans(segments, "speaker_0")).toEqual([{ startMs: 9200, endMs: 11200 }]);
  });
  it("bounds the pool and samples speech throughout a long recording", () => {
    const segments = qualifySegments([{ start: 1, end: 601, speaker: 0 }], 602000);
    const spans = embeddingSpans(segments, "speaker_0");
    expect(spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0)).toBeLessThanOrEqual(
      60000,
    );
    expect(spans.at(-1)?.startMs).toBeGreaterThan(570000);
    expect(spans.every((span) => span.endMs - span.startMs >= 2000)).toBe(true);
  });
  it("rejects invalid native timestamps instead of silently trusting them", () => {
    expect(() => qualifySegments([{ start: 1, end: Number.NaN, speaker: 0 }], 5000)).toThrow();
    expect(() => qualifySegments([{ start: 1, end: 8, speaker: 0 }], 5000)).toThrow();
  });
  it("normalizes the weighted acoustic vector and rejects malformed embeddings", () => {
    const pooled = poolEmbeddings([
      { embedding: [4, 0], weight: 3 },
      { embedding: [0, 9], weight: 1 },
    ]);
    expect(pooled[0]).toBeCloseTo(3 / Math.sqrt(10));
    expect(cosineSimilarity(pooled, [3, 1])).toBeCloseTo(1);
    expect(() => poolEmbeddings([{ embedding: [0, 0], weight: 1 }])).toThrow();
    expect(() => cosineSimilarity([1, 0], [1])).toThrow();
    expect(() => cosineSimilarity([Number.NaN], [1])).toThrow();
  });
  it("rejects nonfinite, incorrectly sampled, too-short and out-of-range PCM before inference", () => {
    const pcm = new Float32Array(32000);
    expect(() => validateVoicePcm(pcm)).not.toThrow();
    expect(() => validateVoicePcm(pcm, 44100)).toThrow();
    expect(() => validateVoicePcm(pcm.subarray(1))).toThrow();
    pcm[100] = Number.NaN;
    expect(() => validateVoicePcm(pcm)).toThrow();
    pcm[100] = 1.1;
    expect(() => validateVoicePcm(pcm)).toThrow();
  });
  it("fails closed for absent configuration or substituted model bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recalino-voice-test-"));
    try {
      vi.stubEnv("VOICE_SEGMENTATION_MODEL_PATH", "");
      vi.stubEnv("VOICE_EMBEDDING_MODEL_PATH", "");
      await expect(loadVoiceEngine()).rejects.toThrow("voice_models_not_configured");
      const model = join(directory, "wrong.onnx");
      await writeFile(model, "substituted model");
      vi.stubEnv("VOICE_SEGMENTATION_MODEL_PATH", model);
      vi.stubEnv("VOICE_EMBEDDING_MODEL_PATH", model);
      await expect(loadVoiceEngine()).rejects.toThrow("voice_model_integrity_mismatch");
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
