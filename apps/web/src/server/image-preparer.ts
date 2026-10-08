import "server-only";
import { AppError, errors } from "@recalino/core/plt";
import { detectBinaryMime } from "@recalino/core/src";
import sharp from "sharp";

// Match the approved source contract's decode bounds. The transport copy is
// separate from the stored original, whose identity the worker verifies first.
const MAX_INPUT_BYTES = 20_000_000;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_TRANSPORT_BYTES = 3_000_000;

/** Whole-image, temporary in-memory copy that fits strict cloud vision routes. */
export async function prepareProcessingImage(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" }> {
  if (input.bytes.length > MAX_INPUT_BYTES) throw errors.payloadTooLarge();
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(input.mimeType) ||
    detectBinaryMime(input.bytes) !== input.mimeType
  )
    throw errors.unsupportedMedia();
  try {
    const image = sharp(input.bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "warning",
      animated: false,
    }).timeout({ seconds: 30 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
      throw errors.unsupportedMedia();
    const encode = (maxSide: number, quality: number) =>
      image
        .clone()
        .rotate()
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    let bytes = await encode(3072, 90);
    if (bytes.length > MAX_TRANSPORT_BYTES) bytes = await encode(2048, 85);
    if (bytes.length > MAX_TRANSPORT_BYTES) throw errors.payloadTooLarge();
    // Base64 expands this maximum to 4 MB, leaving room below the 5 MB cloud
    // image limit. No crop, persisted replacement, URL or source hash changes.
    return { bytes, mimeType: "image/jpeg" };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw errors.unsupportedMedia();
  }
}
