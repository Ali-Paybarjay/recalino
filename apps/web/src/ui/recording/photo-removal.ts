import { forgetPhotoQuality } from "./photo-quality-client";
import type { IndexedRecordingStore, LocalPhoto } from "./store";

/**
 * Owner decision 2026-10-13 (D72 follow-up): a board photo that exists only on this device can be
 * removed from its row. A photo that is uploaded, or named in a pending upload group (its server
 * source may already exist), keeps the material-page deletion instead.
 */
export function canRemoveLocalPhoto(
  photo: Pick<LocalPhoto, "id" | "sourceAssetId">,
  uploadJournal: string | null,
): boolean {
  return !photo.sourceAssetId && !uploadJournal?.includes(photo.id);
}

/**
 * Deletes only this local photo, its cached readability verdict and its diagnostics event if that
 * has not been sent yet. Checked again here, since an upload may have started after the learner
 * opened the confirmation; then nothing is removed and false is returned.
 */
export async function removeLocalPhoto(
  photo: LocalPhoto,
  {
    store,
    uploadJournal,
    forgetDiagnostics,
  }: {
    store: Pick<IndexedRecordingStore, "removePhoto">;
    uploadJournal: string | null;
    forgetDiagnostics: (photoId: string) => void;
  },
): Promise<boolean> {
  if (!canRemoveLocalPhoto(photo, uploadJournal)) return false;
  await store.removePhoto(photo.userId, photo.recordingId, photo.id);
  forgetPhotoQuality(photo.id);
  forgetDiagnostics(photo.id);
  return true;
}
