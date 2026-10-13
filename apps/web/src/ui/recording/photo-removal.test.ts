import { describe, expect, it, vi } from "vitest";
import { photoQuality } from "./photo-quality-client";
import { canRemoveLocalPhoto, removeLocalPhoto } from "./photo-removal";
import type { LocalPhoto } from "./store";

// Owner decision 2026-10-13 (D72 follow-up): only a photo that exists nowhere but this device.
function photo(overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    offsetMs: 5000,
    captureState: "recording",
    blob: new Blob([], { type: "image/png" }),
    createdAt: "2026-10-13T10:00:00.000Z",
    sourceAssetId: null,
    ...overrides,
  };
}

describe("removing a board photo from this device", () => {
  it("offers removal only for a photo that is neither uploaded nor in a pending upload group", () => {
    const local = photo();
    expect(canRemoveLocalPhoto(local, null)).toBe(true);
    expect(canRemoveLocalPhoto(local, JSON.stringify({ fileIds: [crypto.randomUUID()] }))).toBe(
      true,
    );
    expect(canRemoveLocalPhoto(photo({ sourceAssetId: crypto.randomUUID() }), null)).toBe(false);
    expect(
      canRemoveLocalPhoto(
        local,
        JSON.stringify({ batchId: "b", fileIds: [local.id], sources: {} }),
      ),
    ).toBe(false);
  });

  it("deletes only this photo, its cached verdict and its unsent diagnostics event", async () => {
    const local = photo();
    const store = { removePhoto: vi.fn(async () => {}) };
    const forgetDiagnostics = vi.fn();
    const verdict = photoQuality(local.id, local.blob);
    await expect(
      removeLocalPhoto(local, { store, uploadJournal: null, forgetDiagnostics }),
    ).resolves.toBe(true);
    expect(store.removePhoto).toHaveBeenCalledExactlyOnceWith(
      local.userId,
      local.recordingId,
      local.id,
    );
    expect(forgetDiagnostics).toHaveBeenCalledExactlyOnceWith(local.id);
    expect(photoQuality(local.id, local.blob)).not.toBe(verdict);
  });

  it("removes nothing once the photo is uploaded or an upload group names it", async () => {
    const store = { removePhoto: vi.fn(async () => {}) };
    const forgetDiagnostics = vi.fn();
    const uploaded = photo({ sourceAssetId: crypto.randomUUID() });
    const queued = photo();
    await expect(
      removeLocalPhoto(uploaded, { store, uploadJournal: null, forgetDiagnostics }),
    ).resolves.toBe(false);
    await expect(
      removeLocalPhoto(queued, {
        store,
        uploadJournal: JSON.stringify({ fileIds: [queued.id] }),
        forgetDiagnostics,
      }),
    ).resolves.toBe(false);
    expect(store.removePhoto).not.toHaveBeenCalled();
    expect(forgetDiagnostics).not.toHaveBeenCalled();
  });
});
