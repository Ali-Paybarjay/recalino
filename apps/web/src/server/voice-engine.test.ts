import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cosineSimilarity,
  loadVoiceEngine,
  poolEmbeddings,
  validateVoicePcm,
  workerFailureCode,
} from "./voice-engine";
import {
  embeddingSpans,
  markOverlaps,
  mergeVoices,
  qualifySegments,
} from "./voice-engine-quality.mjs";

describe("local speaker engine trust boundaries", () => {
  it("excludes splice-adjacent and splice-crossing turns before acoustic embeddings are pooled", () => {
    const segments = qualifySegments(
      [
        { start: 1, end: 7, speaker: 0 },
        { start: 8, end: 14, speaker: 0 },
        { start: 12.1, end: 16, speaker: 1 },
        { start: 17, end: 23, speaker: 1 },
      ],
      25000,
      0,
      [10000, 12000],
    );
    expect(segments.map((segment) => segment.boundaryUnsafe)).toEqual([false, true, true, false]);
    expect(embeddingSpans(segments, "speaker_0")).toEqual([{ startMs: 1200, endMs: 6800 }]);
    expect(embeddingSpans(segments, "speaker_1")).toEqual([{ startMs: 17200, endMs: 22800 }]);
  });
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
  it("clean-parts keeps only speech at least 200 ms away from any other voice; turn flags stay", () => {
    const segments = qualifySegments(
      [
        { start: 1, end: 12, speaker: 0 },
        { start: 3, end: 4, speaker: 1 },
        { start: 13, end: 20, speaker: 0 },
      ],
      21000,
    );
    // Spoken-mistake evidence still treats both touched turns as overlapped.
    expect(segments.map((item) => item.overlap)).toEqual([true, true, false]);
    expect(embeddingSpans(segments, "speaker_0")).toEqual([{ startMs: 13200, endMs: 19800 }]);
    expect(embeddingSpans(segments, "speaker_0", "clean-parts")).toEqual([
      { startMs: 4200, endMs: 11800 },
      { startMs: 13200, endMs: 19800 },
    ]);
    // The shorter voice has no clean part of two seconds and still yields nothing.
    expect(embeddingSpans(segments, "speaker_1", "clean-parts")).toEqual([]);
    // Clipped, splice-adjacent and short turns stay excluded in either mode.
    const clipped = qualifySegments([{ start: 0, end: 8, speaker: 0 }], 9000);
    expect(embeddingSpans(clipped, "speaker_0", "clean-parts")).toEqual([]);
  });
  it("merges an over-split voice by its pooled clean speech, never two voices heard together", () => {
    // Synthetic vectors: speaker_0 and speaker_2 are one person split by clustering.
    const person = [1, 0, 0],
      alike = [0.8, 0.6, 0],
      other = [0, 1, 0];
    const segments = qualifySegments(
      [
        { start: 1, end: 9, speaker: 0 },
        { start: 10, end: 18, speaker: 1 },
        { start: 19, end: 27, speaker: 2 },
        { start: 26.5, end: 30, speaker: 0 },
      ],
      31000,
    );
    const voiceOf = (span: { startMs: number }) =>
      span.startMs < 10000 || span.startMs >= 26500 ? person : span.startMs < 19000 ? other : alike;
    const merged = mergeVoices(segments, voiceOf, 0.6);
    expect([...new Set(merged.map((segment) => segment.speakerId))].sort()).toEqual([
      "speaker_0",
      "speaker_1",
    ]);
    // Same-voice contact is no longer simultaneous speech once the labels agree.
    expect(
      merged.filter((segment) => segment.speakerId === "speaker_0").map((s) => s.overlap),
    ).toEqual([false, false, false]);
    // Dissimilar voices, or voices heard together, keep their own labels.
    expect(new Set(mergeVoices(segments, voiceOf, 0.9).map((s) => s.speakerId)).size).toBe(3);
    // Identical voiceprints with eight clean seconds each: only simultaneous speech keeps them
    // apart. Ten shared seconds are well over a quarter of either voice's eighteen.
    const apart = [
      { start: 1, end: 9, speaker: 0 },
      { start: 10, end: 18, speaker: 1 },
    ];
    const together = qualifySegments(
      [...apart, { start: 20, end: 30, speaker: 0 }, { start: 20, end: 30, speaker: 1 }],
      31000,
    );
    expect(new Set(mergeVoices(together, () => person, 0.5).map((s) => s.speakerId)).size).toBe(2);
    expect(markOverlaps(together).map((segment) => segment.overlap)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // The same two voices, never heard together, are one person split by clustering.
    const separate = qualifySegments(apart, 31000);
    expect(new Set(mergeVoices(separate, () => person, 0.5).map((s) => s.speakerId)).size).toBe(1);
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
  // FR-VOC-002, PRD-PRIV-06
  it("passes only the worker's own fixed failure codes across the thread boundary", () => {
    expect(workerFailureCode("voice_diarization_output_invalid")).toBe(
      "voice_diarization_output_invalid",
    );
    expect(workerFailureCode("voice_speech_too_short")).toBe("voice_speech_too_short");
    for (const leaked of [
      "/var/task/tools/voice/models/model.onnx: cannot open",
      "voice_made_up_code",
      undefined,
      42,
    ])
      expect(workerFailureCode(leaked)).toBe("voice_inference_failed");
  });
});
