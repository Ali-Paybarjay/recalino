import { describe, expect, it } from "vitest";
import { assessPhotoFile, photoQuality } from "./photo-quality-client";

// D72: the check is advice only, so a browser that cannot decode or draw shows nothing.
describe("photo readability on the device", () => {
  it("returns nothing instead of throwing when the browser cannot judge the photo", async () => {
    // Node has neither Worker, OffscreenCanvas nor createImageBitmap.
    await expect(assessPhotoFile(new Blob(["not an image"], { type: "image/png" }))).resolves.toBe(
      undefined,
    );
  });

  it("judges each local photo once per page", () => {
    const blob = new Blob([], { type: "image/png" });
    const id = crypto.randomUUID();
    expect(photoQuality(id, blob)).toBe(photoQuality(id, blob));
    expect(photoQuality(crypto.randomUUID(), blob)).not.toBe(photoQuality(id, blob));
  });
});
