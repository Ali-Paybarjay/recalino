import { createHash, randomUUID } from "node:crypto";
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

import { diarizeSourceVoice } from "./voice-processing";

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
  expect(mocks.decode.mock.calls[0]?.[1]).toHaveLength(15);
  expect(result.sampled).toBe(true);
  expect(result.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
    [101000, 108000],
    [7501000, 7507000],
  ]);
  expect(result.modelRevision).toBe("same-enrollment-model");
  expect(samples.every((sample) => sample === 0)).toBe(true);
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
