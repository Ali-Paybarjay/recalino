import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { expect, it } from "vitest";
import { audioVerifier } from "./audio-preparer";

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
