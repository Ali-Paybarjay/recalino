import { assessPhotoQuality, type PhotoQuality } from "./photo-quality";

/** Long edge of the copy that is judged; enough for 11 px writing, small enough for a phone. */
export const ASSESS_LONG_EDGE = 640;

type Context2D = Pick<CanvasRenderingContext2D, "drawImage" | "getImageData">;

/** Decodes, downscales to ≤ 640 px (as upload-file.ts does with createImageBitmap) and judges. */
export async function assessPhotoBlob(
  blob: Blob,
  canvas: (width: number, height: number) => Context2D | null,
): Promise<PhotoQuality | undefined> {
  let full: ImageBitmap | null = null;
  let small: ImageBitmap | null = null;
  try {
    full = await createImageBitmap(blob);
    const scale = Math.min(1, ASSESS_LONG_EDGE / Math.max(full.width, full.height));
    const width = Math.max(3, Math.round(full.width * scale));
    const height = Math.max(3, Math.round(full.height * scale));
    small = await createImageBitmap(full, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "medium",
    });
    const context = canvas(width, height);
    if (!context) return undefined;
    // Explicit size: a browser that ignores the resize options still draws the whole photo.
    context.drawImage(small, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return assessPhotoQuality({ width, height, data });
  } finally {
    full?.close();
    small?.close();
  }
}
