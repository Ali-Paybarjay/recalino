import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { MemoryObjectStore } from "@recalino/core/plt";
import type { AudioPreparer } from "@recalino/core/proc";
import ffmpegPath from "ffmpeg-static";
import { expect, it, vi } from "vitest";
import {
  audioVerifier,
  decodeVoiceAudio,
  decodeVoiceAudioWindows,
  prepareAudio,
} from "./audio-preparer";

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@recalino/core/plt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@recalino/core/plt")>()),
  readOwnedObject: storage.read,
  writeOwnedObject: storage.write,
}));

function syntheticWav(seconds: number) {
  const samples = 16000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    bytes.writeInt16LE(
      Math.round(Math.sin((index * Math.PI * 880) / 16000) * 2000),
      44 + index * 2,
    );
  return bytes;
}
it("decodes actual synthetic audio duration and rejects spoofed or corrupt containers", async () => {
  const verifier = audioVerifier();
  const result = await verifier.inspect(syntheticWav(2), "audio/wav");
  expect(result.audioOnly).toBe(true);
  expect(result.durationMs).toBeGreaterThanOrEqual(1990);
  expect(result.durationMs).toBeLessThanOrEqual(2010);
  await expect(verifier.inspect(syntheticWav(2), "audio/mpeg")).rejects.toMatchObject({
    code: "unsupported_media",
  });
  await expect(
    verifier.inspect(new Uint8Array([82, 73, 70, 70]), "audio/wav"),
  ).rejects.toMatchObject({ code: "unsupported_media" });
}, 30000);

it("decodes bounded mono PCM for the real voice engine without changing its duration or amplitude", async () => {
  const decoded = await decodeVoiceAudio(syntheticWav(2), 2000);
  expect(decoded.sampleRate).toBe(16000);
  expect(decoded.durationMs).toBe(2000);
  expect(decoded.samples.length).toBe(32000);
  expect(Math.max(...decoded.samples)).toBeCloseTo(2000 / 32768, 4);
  await expect(decodeVoiceAudio(syntheticWav(2), 1000)).rejects.toMatchObject({
    code: "validation_failed",
  });
}, 30000);

// FR-VOC-002
it("decodes selected original windows into bounded PCM with silent guards and rejects unusable audio", async () => {
  const decoded = await decodeVoiceAudioWindows(syntheticWav(8), [
    { start: 1000, end: 3000 },
    { start: 5000, end: 7000 },
  ]);
  expect(decoded.windows).toEqual([
    { sourceStartMs: 1000, compositeStartMs: 0, compositeEndMs: 2000 },
    { sourceStartMs: 5000, compositeStartMs: 4000, compositeEndMs: 6000 },
  ]);
  expect(decoded.partial).toBe(false);
  expect(decoded.samples.length).toBe(6000 * 16);
  expect(decoded.samples.subarray(2000 * 16, 4000 * 16).every((sample) => sample === 0)).toBe(true);
  expect(Math.max(...decoded.samples.subarray(0, 32000))).toBeCloseTo(2000 / 32768, 4);
  decoded.samples.fill(0);
  await expect(
    decodeVoiceAudioWindows(syntheticWav(8), [{ start: 7000, end: 10000 }]),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { audio: ["voice_audio_unusable"] } },
  });
}, 30000);

/**
 * MediaRecorder stamps each 60 ms Opus packet with its capture time, so packets in a real
 * Chrome recording land 51–69 ms apart. This synthetic file reproduces that 52/68 ms pattern.
 */
function browserClockWebm(seconds: number) {
  if (!ffmpegPath) throw new Error("Synthetic decoder is unavailable");
  const encoded = spawnSync(
    ffmpegPath,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-c:a",
      "libopus",
      "-b:a",
      "48k",
      "-frame_duration",
      "60",
      "-bsf:a",
      "setts=ts=PTS+if(eq(mod(N\\,4)\\,1)\\,0.008/TB\\,if(eq(mod(N\\,4)\\,3)\\,-0.008/TB\\,0))",
      "-live",
      "1",
      "-f",
      "webm",
      "pipe:1",
    ],
    { input: syntheticWav(seconds), windowsHide: true, timeout: 20000, maxBuffer: 20000000 },
  );
  expect(encoded.status, encoded.stderr.toString()).toBe(0);
  return encoded.stdout;
}

// FR-VOC-002: browser-recorded classes must not fail the acoustic check.
it("keeps excerpts from a browser recording whose packet clock jitters, cut exactly by samples", async () => {
  // Container-time seeks here decode 10.009 s for a 10 s window; that once failed the whole check.
  const decoded = await decodeVoiceAudioWindows(browserClockWebm(40), [
    { start: 2000, end: 12000 },
    { start: 20000, end: 30000 },
  ]);
  expect(decoded.windows).toEqual([
    { sourceStartMs: 2000, compositeStartMs: 0, compositeEndMs: 10000 },
    { sourceStartMs: 20000, compositeStartMs: 12000, compositeEndMs: 22000 },
  ]);
  expect(decoded.partial).toBe(false);
  expect(decoded.samples.length).toBe(22000 * 16);
  expect(decoded.samples.subarray(10000 * 16, 12000 * 16).every((sample) => sample === 0)).toBe(
    true,
  );
  expect(
    decoded.samples.subarray(0, 10000 * 16).reduce((peak, sample) => Math.max(peak, sample), 0),
  ).toBeGreaterThan(0.01);
  decoded.samples.fill(0);
}, 30000);

// FR-VOC-002
it("skips an excerpt that cannot hold a turn and discloses the partial coverage", async () => {
  const decoded = await decodeVoiceAudioWindows(syntheticWav(8), [
    { start: 1000, end: 4000 },
    { start: 6500, end: 9500 },
  ]);
  expect(decoded.windows).toEqual([
    { sourceStartMs: 1000, compositeStartMs: 0, compositeEndMs: 3000 },
  ]);
  expect(decoded.partial).toBe(true);
  expect(decoded.samples.length).toBe(3000 * 16);
  decoded.samples.fill(0);
}, 30000);

it.each([
  { label: "WebM", mimeType: "audio/webm", brand: null, args: ["-c:a", "libopus", "-f", "webm"] },
  {
    label: "MP4",
    mimeType: "audio/mp4",
    brand: null,
    args: ["-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"],
  },
  {
    label: "mobile MP4 (3gp4)",
    mimeType: "audio/mp4",
    brand: "3gp4",
    args: ["-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-brand", "3gp4", "-f", "mp4"],
  },
])(
  "decodes a streamed $label recording without finalized duration metadata",
  async ({ mimeType, brand, args }) => {
    if (!ffmpegPath) throw new Error("Synthetic decoder is unavailable");
    const encoded = spawnSync(
      ffmpegPath,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...args, "pipe:1"],
      { input: syntheticWav(2), windowsHide: true, timeout: 10000, maxBuffer: 1000000 },
    );
    expect(encoded.status, encoded.stderr.toString()).toBe(0);
    if (brand) expect(encoded.stdout.toString("ascii", 8, 12)).toBe(brand);
    const result = await audioVerifier().inspect(encoded.stdout, mimeType);
    expect(result.audioOnly).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(1990);
    // AAC can add priming and padding frames; count decoded samples rather than container metadata.
    expect(result.durationMs).toBeLessThanOrEqual(2200);
  },
  30000,
);

it("recognizes a mobile MP4 container without accepting its video track", async () => {
  if (!ffmpegPath) throw new Error("Synthetic decoder is unavailable");
  const encoded = spawnSync(
    ffmpegPath,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=1",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-brand",
      "3gp4",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { windowsHide: true, timeout: 10000, maxBuffer: 1000000 },
  );
  expect(encoded.status, encoded.stderr.toString()).toBe(0);
  expect(encoded.stdout.toString("ascii", 8, 12)).toBe("3gp4");
  const result = await audioVerifier().inspect(encoded.stdout, "audio/mp4");
  expect(result.durationMs).toBeGreaterThanOrEqual(990);
  expect(result.audioOnly).toBe(false);
}, 30000);

it("keeps transcription checkpoints distinct for independent audio sources in the same run", async () => {
  const original = syntheticWav(4);
  storage.read.mockResolvedValue(original);
  storage.write.mockImplementation(async () => randomUUID());
  const source: Parameters<AudioPreparer>[0]["source"] = {
    sourceId: randomUUID(),
    kind: "audio",
    sha256: createHash("sha256").update(original).digest("hex"),
    mimeType: "audio/wav",
    durationMs: 4000,
    pageCount: null,
    objectId: randomUUID(),
    contentVersionId: null,
    captureAnchor: null,
    ranges: [
      { start: 0, end: 1000 },
      { start: 2000, end: 4000 },
    ],
    units: [],
    blocks: [],
  };
  const input: Parameters<AudioPreparer>[0] = {
    db: {} as Parameters<AudioPreparer>[0]["db"],
    store: new MemoryObjectStore(),
    ctx: { userId: randomUUID(), requestId: randomUUID() },
    runId: randomUUID(),
    source,
    now: new Date("2026-10-06T14:00:00Z"),
  };
  const first = await prepareAudio(input);
  const second = await prepareAudio({
    ...input,
    source: { ...source, sourceId: randomUUID(), objectId: randomUUID() },
  });
  expect(first).toHaveLength(2);
  expect(second).toHaveLength(2);
  for (const chunks of [first, second])
    expect(chunks.map(({ offsetMs, durationMs }) => ({ offsetMs, durationMs }))).toEqual([
      { offsetMs: 0, durationMs: 1000 },
      { offsetMs: 2000, durationMs: 2000 },
    ]);
  // These are the actual worker's durable STT keys: an existing first-source checkpoint
  // must never cause a different recording source to skip its own transcription.
  const firstCheckpoints = new Set(first.map((chunk) => `stt:${chunk.id}`));
  expect(new Set([...first, ...second].map((chunk) => `stt:${chunk.id}`)).size).toBe(4);
  expect(second.every((chunk) => !firstCheckpoints.has(`stt:${chunk.id}`))).toBe(true);
  expect(first.every((chunk) => chunk.id.length <= 100)).toBe(true);
  const retry = await prepareAudio(input);
  expect(retry.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
  expect(retry.map((chunk) => chunk.objectId)).not.toEqual(first.map((chunk) => chunk.objectId));
}, 30000);
