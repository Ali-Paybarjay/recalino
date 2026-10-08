import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { prepareProcessingImage } from "./image-preparer";

it("bounds a high-detail camera photo below cloud base64 limits without changing the original", async () => {
  const width = 4000;
  const height = 3000;
  const pixels = Buffer.alloc(width * height * 3);
  let value = 1234567;
  for (let index = 0; index < pixels.length; index++) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    pixels[index] = value & 255;
  }
  const original = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  expect(original.length).toBeGreaterThan(4_000_000);
  const originalHash = createHash("sha256").update(original).digest("hex");
  const result = await prepareProcessingImage({ bytes: original, mimeType: "image/jpeg" });
  expect(result.mimeType).toBe("image/jpeg");
  expect(result.bytes.length).toBeLessThanOrEqual(3_000_000);
  expect(Buffer.from(result.bytes).toString("base64").length).toBeLessThanOrEqual(4_000_000);
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.format).toBe("jpeg");
  // This dense fixture needs the bounded second pass, beyond ordinary resizing.
  expect(metadata.width).toBeLessThanOrEqual(2048);
  expect(metadata.height).toBeLessThanOrEqual(2048);
  expect((metadata.width ?? 0) / (metadata.height ?? 1)).toBeCloseTo(width / height, 2);
  expect(createHash("sha256").update(original).digest("hex")).toBe(originalHash);
}, 30000);

it("applies EXIF orientation to a whole small image without enlarging it or retaining orientation metadata", async () => {
  const original = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#804020" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await prepareProcessingImage({ bytes: original, mimeType: "image/jpeg" });
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.width).toBe(80);
  expect(metadata.height).toBe(120);
  expect(metadata.orientation).toBeUndefined();
  expect(metadata.exif).toBeUndefined();
});

it("flattens transparent pixels onto white and emits a readable RGB JPEG", async () => {
  const original = await sharp({
    create: { width: 8, height: 6, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const result = await prepareProcessingImage({ bytes: original, mimeType: "image/png" });
  const decoded = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  expect(decoded.info).toMatchObject({ width: 8, height: 6, channels: 3 });
  expect(Array.from(decoded.data.subarray(0, 3))).toEqual([255, 255, 255]);
});

it("rejects mismatched MIME, truncated images and oversized decoded dimensions before provider dispatch", async () => {
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  await expect(prepareProcessingImage({ bytes, mimeType: "image/jpeg" })).rejects.toMatchObject({
    code: "unsupported_media",
  });
  await expect(
    prepareProcessingImage({ bytes: bytes.subarray(0, 8), mimeType: "image/png" }),
  ).rejects.toMatchObject({ code: "unsupported_media" });
  const bomb = Buffer.from(bytes);
  bomb.writeUInt32BE(100000, 16);
  bomb.writeUInt32BE(100000, 20);
  await expect(
    prepareProcessingImage({ bytes: bomb, mimeType: "image/png" }),
  ).rejects.toMatchObject({ code: "unsupported_media" });
});

it("rejects animated image sources instead of silently processing one frame", async () => {
  const pixels = Buffer.alloc(32, 255);
  for (let index = 16; index < pixels.length; index += 4) {
    pixels[index] = 0;
    pixels[index + 1] = 0;
    pixels[index + 2] = 0;
  }
  const animated = await sharp(pixels, {
    raw: { width: 2, height: 4, channels: 4, pageHeight: 2 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(
    prepareProcessingImage({ bytes: animated, mimeType: "image/webp" }),
  ).rejects.toMatchObject({ code: "unsupported_media" });
});
