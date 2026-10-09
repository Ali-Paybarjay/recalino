import type { Recording } from "../recording/store";

/** What the server registered for a class recording; the only evidence a file is the same. */
export interface RegisteredOriginal {
  sourceId: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  durationMs: number | null;
}

export type RelinkFailure =
  | "no_checksum"
  | "size_mismatch"
  | "content_mismatch"
  | "recording_active"
  | "local_read_failed"
  | "storage_full"
  | "local_write_failed"
  | "verify_failed";
export class RelinkError extends Error {
  constructor(readonly code: RelinkFailure) {
    super(code);
    this.name = "RelinkError";
  }
}

export interface RelinkStore {
  list(userId: string): Promise<Recording[]>;
  blob(userId: string, id: string): Promise<Blob>;
  replaceOriginal(input: {
    userId: string;
    sourceId: string;
    recordingId: string;
    blob: Blob;
    mimeType: string;
    activeMs: number;
  }): Promise<Recording>;
}

/** The row every local player uses for a source: an imported file or a registered recording. */
export function localOriginalRow(rows: readonly Recording[], sourceId: string) {
  return rows.find((row) => (row.sourceAssetId ?? row.id) === sourceId) ?? null;
}

const CHECKSUM = /^[a-f0-9]{64}$/;

/**
 * Attach a file the learner selects to an existing class source, on this device only. The file
 * must have the exact size and SHA-256 the server registered; nothing is uploaded, no source,
 * run or processing is created, and a mismatching file never replaces anything.
 */
export async function relinkOriginalRecording(
  deps: {
    store: RelinkStore;
    hash: (blob: Blob, signal?: AbortSignal) => Promise<string>;
  },
  input: {
    userId: string;
    expected: RegisteredOriginal;
    file: Blob;
    signal?: AbortSignal;
  },
): Promise<"linked" | "already_linked"> {
  const { expected, file, signal } = input;
  if (
    !CHECKSUM.test(expected.sha256) ||
    /^0+$/.test(expected.sha256) ||
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes <= 0
  )
    throw new RelinkError("no_checksum");
  // The size is free to compare; a different size cannot be the registered original.
  if (file.size !== expected.sizeBytes) throw new RelinkError("size_mismatch");
  if ((await deps.hash(file, signal)) !== expected.sha256)
    throw new RelinkError("content_mismatch");
  signal?.throwIfAborted();
  let rows: Recording[];
  try {
    rows = await deps.store.list(input.userId);
  } catch {
    // A store that cannot be read is not the same as a missing original; write nothing.
    throw new RelinkError("local_read_failed");
  }
  const existing = localOriginalRow(rows, expected.sourceId);
  if (existing && (existing.status === "recording" || existing.status === "paused"))
    throw new RelinkError("recording_active");
  if (existing?.bytes === expected.sizeBytes) {
    const intact = await deps.store
      .blob(input.userId, existing.id)
      .then((blob) => deps.hash(blob, signal))
      .then((sha256) => sha256 === expected.sha256)
      .catch(() => false);
    if (intact) return "already_linked";
  }
  signal?.throwIfAborted();
  try {
    await deps.store.replaceOriginal({
      userId: input.userId,
      sourceId: expected.sourceId,
      recordingId: existing?.id ?? expected.sourceId,
      blob: file,
      mimeType: existing?.mimeType ?? expected.mimeType,
      activeMs: expected.durationMs ?? 0,
    });
  } catch (error) {
    throw new RelinkError(
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "storage_full"
        : "local_write_failed",
    );
  }
  // Read the saved copy back: playback must come from exactly the registered bytes.
  const saved = await deps.store
    .blob(input.userId, existing?.id ?? expected.sourceId)
    .then((blob) => deps.hash(blob))
    .catch(() => null);
  if (saved !== expected.sha256) throw new RelinkError("verify_failed");
  return "linked";
}
