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
