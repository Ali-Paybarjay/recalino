import { createHash, randomUUID } from "node:crypto";
import { errors } from "@recalino/core/plt";
import type { VoiceDiarizer } from "@recalino/core/proc";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  live: vi.fn(),
  decode: vi.fn(),
  diarize: vi.fn(),
}));
vi.mock("./storage", () => ({ getObjectStore: () => ({}) }));
vi.mock("./audio-preparer", () => ({ decodeVoiceAudioWindows: mocks.decode }));
vi.mock("./voice-engine", () => ({ loadVoiceEngine: async () => ({ diarize: mocks.diarize }) }));
vi.mock("@recalino/core/src", async (original) => ({
  ...(await original<typeof import("@recalino/core/src")>()),
  liveTemporaryAudioObject: mocks.live,
}));
vi.mock("@recalino/core/plt", async (original) => ({
  ...(await original<typeof import("@recalino/core/plt")>()),
  readOwnedObject: mocks.read,
}));

import { diarizeSourceVoice, voiceFailureCode } from "./voice-processing";

const bytes = new Uint8Array([1, 2, 3]);
const source: Parameters<VoiceDiarizer>[0]["source"] = {
  sourceId: randomUUID(),
  kind: "audio",
  objectId: randomUUID(),
  durationMs: 7675883,
  contentVersionId: randomUUID(),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  mimeType: "audio/mpeg",
  pageCount: null,
  captureAnchor: null,
  ranges: [],
  units: [],
  blocks: [],
};
const input = {
  db: {} as Parameters<VoiceDiarizer>[0]["db"],
  ctx: { userId: randomUUID(), requestId: randomUUID() },
  source,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.live.mockResolvedValue(true);
  mocks.read.mockImplementation(async () => Uint8Array.from(bytes));
});

it("checks a longer-than-two-hour source with one bounded native pass and restores original timestamps", async () => {
  const samples = new Float32Array(22000 * 16).fill(0.1);
  mocks.decode.mockResolvedValue({
    samples,
    sampleRate: 16000,
    windows: [
      { sourceStartMs: 100000, compositeStartMs: 0, compositeEndMs: 10000 },
      { sourceStartMs: 7500000, compositeStartMs: 12000, compositeEndMs: 22000 },
    ],
  });
  mocks.diarize.mockImplementation(async (pcm, options) => {
    expect(pcm.length).toBeLessThanOrEqual(480000 * 16);
    expect(options.boundaries).toEqual([0, 10000, 12000, 22000]);
    return {
      modelRevision: "same-enrollment-model",
      speakers: [{ speakerId: "global-1", embedding: [1, 0], cleanSpeechMs: 24000 }],
      segments: [
        {
          speakerId: "global-1",
          startMs: 1000,
          endMs: 8000,
          overlap: false,
          boundaryUnsafe: false,
        },
        {
          speakerId: "global-1",
          startMs: 13000,
          endMs: 19000,
          overlap: false,
          boundaryUnsafe: false,
        },
        {
          speakerId: "global-1",
          startMs: 9000,
          endMs: 14000,
          overlap: false,
          boundaryUnsafe: true,
        },
      ],
    };
  });
  const result = await diarizeSourceVoice(input);
  expect(mocks.diarize).toHaveBeenCalledTimes(1);
  // The adopted plan: eight 58-second excerpts across the selection.
  expect(mocks.decode.mock.calls[0]?.[1]).toHaveLength(8);
  expect(result.sampled).toBe(true);
  expect(result.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
    [101000, 108000],
    [7501000, 7507000],
  ]);
  expect(result.modelRevision).toBe("same-enrollment-model");
  expect(samples.every((sample) => sample === 0)).toBe(true);
});

// FR-VOC-002, PRD-PRIV-06
it("discloses skipped excerpts of a short recording as partial, not sampled, and logs only counts", async () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const samples = new Float32Array(10000 * 16).fill(0.1);
  const coverage = {
    plannedWindows: 2,
    usedWindows: 1,
    refusedWindows: 1,
    shortWindows: 0,
    plannedMs: 300000,
    usedMs: 10000,
  };
  mocks.decode.mockResolvedValue({
    samples,
    sampleRate: 16000,
    windows: [{ sourceStartMs: 0, compositeStartMs: 0, compositeEndMs: 10000 }],
    partial: true,
    coverage,
  });
  mocks.diarize.mockResolvedValue({ modelRevision: "model", speakers: [], segments: [] });
  let result: Awaited<ReturnType<VoiceDiarizer>>;
  try {
    result = await diarizeSourceVoice({ ...input, source: { ...source, durationMs: 300000 } });
  } finally {
    spy.mockRestore();
  }
  expect(mocks.decode.mock.calls[0]?.[1]).toEqual([{ start: 0, end: 300000 }]);
  expect(result.sampled).toBeUndefined();
  expect(result.partial).toBe(true);
  // Diagnostics stay in the log; they are not part of the stored diarization.
  expect(result).not.toHaveProperty("coverage");
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      event: "voice_check_diarized",
      code: "partial_audio",
      windows_planned: 2,
      windows_used: 1,
      windows_refused: 1,
      windows_short: 0,
      audio_planned_ms: 300000,
      audio_used_ms: 10000,
    }),
  ]);
  expect(lines.join("\n")).not.toContain("dropped_fields");
});

// FR-VOC-002, PRD-PRIV-06
it("logs one allow-listed failure code for a failed check and never audio, paths or text", async () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    mocks.decode.mockRejectedValue(errors.validationFailed({ audio: ["voice_audio_unusable"] }));
    await expect(diarizeSourceVoice(input)).rejects.toMatchObject({ code: "validation_failed" });
    mocks.decode.mockResolvedValue({
      samples: new Float32Array(5000 * 16),
      sampleRate: 16000,
      windows: [{ sourceStartMs: 0, compositeStartMs: 0, compositeEndMs: 5000 }],
      partial: false,
    });
    mocks.diarize.mockRejectedValue(new Error("/var/task/native.so: undefined symbol"));
    await expect(diarizeSourceVoice(input)).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  const records = lines.map((line) => JSON.parse(line));
  expect(records.map((record) => [record.event, record.code, record.module])).toEqual([
    ["voice_check_failed", "voice_audio_unusable", "voc"],
    ["voice_check_failed", "unexpected", "voc"],
  ]);
  expect(records.every((record) => record.request_id === input.ctx.requestId)).toBe(true);
  expect(lines.join("\n")).not.toContain("/var/task");
});

// PRD-PRIV-06
it("maps every decoder, engine and worker failure to a short safe code", () => {
  expect(voiceFailureCode(errors.validationFailed({ voice: ["source_integrity_mismatch"] }))).toBe(
    "source_integrity_mismatch",
  );
  expect(voiceFailureCode(errors.notFound())).toBe("not_found");
  expect(voiceFailureCode(new Error("voice_diarization_output_invalid"))).toBe(
    "voice_diarization_output_invalid",
  );
  expect(voiceFailureCode(new Error("ENOENT: /tmp/recalino-audio-x/input.audio"))).toBe(
    "unexpected",
  );
  expect(voiceFailureCode("not an error")).toBe("unexpected");
});

it("refuses an expired exact class original before reading bytes or dispatching native inference", async () => {
  mocks.live.mockResolvedValue(false);
  await expect(diarizeSourceVoice(input)).rejects.toMatchObject({
    details: { fields: { voice: ["original_audio_unavailable"] } },
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(mocks.diarize).not.toHaveBeenCalled();
});
