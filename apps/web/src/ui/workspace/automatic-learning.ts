import type { ProcessingReview, ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { Amounts } from "@recalino/core/quota";
import type { InputContract } from "@recalino/core/src";
import { pendingClassRecordings } from "../recording/processing-readiness";
import type { LocalPhoto, Recording, RecordingStore } from "../recording/store";
import { workspaceRequest } from "./api";
import { prepareFileHashes } from "./file-hashes";
import { retryUploadRequest, type UploadRecovery, uploadWithConfirmation } from "./upload";
import { concurrentUploads } from "./upload-concurrency";
import { uploadWithProgress } from "./upload-progress";

export interface AutomaticUploadProgress {
  runId: string;
  sentBytes: number;
  totalBytes: number;
  files: {
    sourceId: string;
    displayName: string;
    sentBytes: number;
    totalBytes: number;
    phase: "queued" | "checking" | "uploading" | "verifying" | "complete";
  }[];
}

export interface AutomaticLearningStatus {
  state: "idle" | "waiting_sources" | "waiting_upload" | "processing" | "ready" | "blocked";
  revision: number;
  batchId: string | null;
  run: ProcessingRun | null;
  snapshot: RunSnapshot | null;
  lastError: string | null;
  message: string;
  notesReady: boolean;
  cardsReady: boolean;
  processingReview?: ProcessingReview | null;
  /** FR-QUOTA-007: for a learner-allowance block, what this class needs and what is left now. */
  allowance?: { active: boolean; required: Amounts; available: Amounts } | null;
}

export function automaticResultNeedsRefresh(
  current: AutomaticLearningStatus,
  before?: AutomaticLearningStatus,
  observedAtStart?: AutomaticLearningStatus,
) {
  if (current.state !== "ready") return false;
  const identity = (status: AutomaticLearningStatus) =>
    `${status.state}:${status.revision}:${status.run?.outputVersionId}:${status.notesReady}:${status.cardsReady}`;
  return [before, observedAtStart].some((prior) => prior && identity(prior) !== identity(current));
}

export function notifyAutomaticLearning(sessionId: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("recalino:learning-changed", { detail: sessionId }));
}

function batchStorageKey(userId: string, sessionId: string) {
  return `recalino:learning-batch:${userId}:${sessionId}`;
}

export function pendingLearningBatch(userId: string, sessionId: string): string | null {
  try {
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(batchStorageKey(userId, sessionId));
  } catch {
    return null;
  }
}

async function openAutomaticBatch(
  sessionId: string,
  storageKey: string,
  request: typeof workspaceRequest,
  options?: { signal?: AbortSignal; checkAllowed?: () => void },
) {
  let batchId: string | null = null;
  try {
    batchId = localStorage.getItem(storageKey);
  } catch {
    /* Server guard remains durable. */
  }
  batchId ??= crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    options?.signal?.throwIfAborted();
    options?.checkAllowed?.();
    try {
      localStorage.setItem(storageKey, batchId);
    } catch {
      /* Server guard remains durable. */
    }
    const status = await request<Partial<AutomaticLearningStatus>>(
      `/api/classes/${sessionId}/learning`,
      "POST",
      { action: "begin", batchId },
      undefined,
      { signal: options?.signal },
    );
    if (!status || !("batchId" in status) || status.batchId === batchId) return batchId;
    // A lost completion acknowledgement can leave a closed local batch token. New uploads need a new fence.
    batchId = crypto.randomUUID();
  }
  throw new Error("The upload batch could not be opened. Your files remain on this device.");
}

/** Closing is explicit after all picker files settle; an interrupted browser never silently closes it. */
export async function inAutomaticLearningBatch<T>(
  userId: string,
  sessionId: string,
  upload: () => Promise<T>,
  request: typeof workspaceRequest = workspaceRequest,
  options?: { onCompleted?: (status: AutomaticLearningStatus) => void },
) {
  const batchId = await openAutomaticBatch(sessionId, batchStorageKey(userId, sessionId), request);
  try {
    return await upload();
  } finally {
    const status = await request<AutomaticLearningStatus>(
      `/api/classes/${sessionId}/learning`,
      "POST",
      { action: "complete", batchId },
    );
    try {
      localStorage.removeItem(batchStorageKey(userId, sessionId));
    } catch {
      /* Replayed completion is safe. */
    }
    notifyAutomaticLearning(sessionId);
    options?.onCompleted?.(status);
  }
}

/** Only finalized captures authorize a new automatic request; imported files use their upload batch. */
export function automaticRecordingClasses(rows: readonly Recording[]) {
  const sessions = new Set(
    rows
      .filter((row) => row.autoRegister && row.autoGenerate && row.completedAt && row.sessionId)
      .map((row) => row.sessionId as string),
  );
  return [...sessions].flatMap((sessionId) => {
    if (pendingClassRecordings(rows, sessionId).length) return [];
    const sources = rows.filter(
      (row) =>
        row.sessionId === sessionId &&
        row.autoRegister &&
        row.autoGenerate &&
        row.completedAt &&
        row.sourceAssetId &&
        row.bytes > 0 &&
        !row.awaitingFinalData,
    );
    return sources.length
      ? [
          {
            sessionId,
            fingerprint: sources
              .map((row) => row.sourceAssetId)
              .sort()
              .join(":"),
          },
        ]
      : [];
  });
}

type AudioStore = Pick<RecordingStore, "list" | "blob">;
type PhotoStore = {
  photos(userId: string, recordingId: string): Promise<LocalPhoto[]>;
  savePhoto(photo: LocalPhoto): Promise<void>;
};
type PhotoSource = { assetId: string; uploadId: string; sha256?: string };
type PhotoBatchJournal = {
  batchId: string;
  fileIds: string[];
  sources: Record<string, PhotoSource>;
  legacy?: boolean;
};
type PhotoBatchReceipt = {
  id: string;
  closed: boolean;
  source?: PhotoSource;
  saveSource(source: PhotoSource): void;
};
type UploadOptions = {
  signal?: AbortSignal;
  checkAllowed?: () => void;
  onProgress?: (message: string) => void;
  onTransferProgress?: (progress: AutomaticUploadProgress) => void;
  request?: typeof workspaceRequest;
  put?: (
    url: string,
    blob: Blob,
    mimeType: string,
    signal?: AbortSignal,
  ) => Promise<Pick<Response, "ok" | "status">>;
};

/** Photos are part of the stopped capture; live or unregistered parts cannot start preparation. */
export async function automaticRecordingMaterial(
  userId: string,
  sessionId: string,
  rows: readonly Recording[],
  store: Pick<PhotoStore, "photos">,
) {
  const capture = automaticRecordingClasses(rows.filter((row) => row.userId === userId)).find(
    (capture) => capture.sessionId === sessionId,
  );
  if (!capture) return null;
  const recordings = rows.filter(
    (row) =>
      row.userId === userId && row.sessionId === sessionId && row.autoGenerate && row.sourceAssetId,
  );
  const photos = (await Promise.all(recordings.map((row) => store.photos(userId, row.id)))).flat();
  return {
    ...capture,
    recordings,
    photos,
    fingerprint: `${capture.fingerprint}:photos:${photos
      .map((photo) => photo.id)
      .sort()
      .join(":")}`,
  };
}

/** The local original is retained; stable source and completion keys make interrupted writes resumable. */
export async function uploadAutomaticPhoto(
  recording: Recording,
  photo: LocalPhoto,
  contract: InputContract,
  options: UploadOptions & { store: Pick<PhotoStore, "savePhoto">; photoBatch?: PhotoBatchReceipt },
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.checkAllowed?.();
  };
  check();
  if (photo.sourceAssetId && !options.photoBatch) return;
  if (
    (!recording.completedAt && !["saved", "interrupted"].includes(recording.status)) ||
    recording.awaitingFinalData ||
    !recording.sourceAssetId ||
    !recording.sessionId
  )
    throw new Error("Stop and save every recording part before uploading board photos.");
  const label = `Board photo at ${Math.floor(photo.offsetMs / 60_000)}:${String(Math.floor(photo.offsetMs / 1000) % 60).padStart(2, "0")}`;
  const failureMessage = `${label} could not be uploaded. The original is saved on this device.`;
  const recovery: UploadRecovery = {
    attempts: 3,
    signal: options.signal,
    onRetry: (attempt) =>
      options.onProgress?.(`Retrying ${label.toLowerCase()} (${attempt} of 3)…`),
    onOffline: () =>
      options.onProgress?.(
        "Board photos are saved on this device. Upload resumes when you reconnect.",
      ),
  };
  const api = options.request ?? workspaceRequest;
  const request = <T>(path: string, method: string, body?: unknown, key?: string) =>
    retryUploadRequest(
      async (signal) => {
        check();
        const result = await api<T>(path, method, body, key, { signal });
        check();
        return result;
      },
      failureMessage,
      recovery,
    );
  const prepared = await prepareFileHashes(photo.blob, contract.partBytes, true, options.signal);
  check();
  const parts = prepared.parts;
  let source = options.photoBatch?.source;
  if (source && !source.sha256) {
    const owned = await request<{ sha256: string }>(`/api/sources/${source.assetId}`, "GET");
    source = { ...source, sha256: owned.sha256 };
  }
  if (source?.sha256 && source.sha256 !== prepared.sha256)
    throw new Error(
      `${label}'s saved bytes no longer match its upload. Keep the original and check the saved photo.`,
    );
  if (!source && (photo.sourceAssetId || options.photoBatch?.closed)) {
    // A sealed group's lost local acknowledgement is recovered by its exact source identity.
    // Reading a checksum match never attaches another source or creates new paid intent.
    const matches = await request<{ id: string; operation_key: string; uploadId: string | null }[]>(
      `/api/sources?checksum=${prepared.sha256}`,
      "GET",
    );
    const matched = matches.find((candidate) =>
      photo.sourceAssetId
        ? candidate.id === photo.sourceAssetId
        : candidate.operation_key === `recorded-photo:${photo.id}`,
    );
    const attached = await request<{ assetId: string }[]>(
      `/api/classes/${recording.sessionId}/sources`,
      "GET",
    );
    if (!matched?.uploadId || !attached.some((candidate) => candidate.assetId === matched.id))
      throw new Error(
        `${label} is no longer available in this session. The original is saved on this device.`,
      );
    source = { assetId: matched.id, uploadId: matched.uploadId, sha256: prepared.sha256 };
  }
  if (!source)
    source = await request<PhotoSource>(
      "/api/sources",
      "POST",
      {
        sessionId: recording.sessionId,
        ...(options.photoBatch ? { batchId: options.photoBatch.id, fileId: photo.id } : {}),
        kind: "image",
        mimeType: photo.blob.type,
        sizeBytes: photo.blob.size,
        sha256: prepared.sha256,
        displayName: label,
        captureAnchor: {
          sourceId: recording.sourceAssetId,
          offsetMs: Math.ceil(photo.offsetMs),
          state: photo.captureState,
        },
        parts,
      },
      `recorded-photo:${photo.id}`,
    );
  check();
  source = { ...source, sha256: prepared.sha256 };
  options.photoBatch?.saveSource(source);
  if (options.photoBatch && !options.photoBatch.closed)
    await request(`/api/classes/${recording.sessionId}/learning`, "POST", {
      action: "register_file",
      batchId: options.photoBatch.id,
      fileId: photo.id,
      sourceId: source.assetId,
    });
  const manifest = await request<{
    assetId?: string;
    state?: string;
    parts: { index: number; verifiedAt: string | null }[];
  }>(`/api/sources/uploads/${source.uploadId}`, "GET");
  if (manifest.assetId && manifest.assetId !== source.assetId)
    throw new Error(
      `${label}'s upload receipt does not match its source. The original is saved on this device.`,
    );
  if (manifest.state && !["pending", "verifying", "verified"].includes(manifest.state))
    throw new Error(
      `${label} needs attention before processing. The original is saved on this device.`,
    );
  if (options.photoBatch?.closed && !["verifying", "verified"].includes(manifest.state ?? ""))
    throw new Error(
      `${label}'s server receipt could not be confirmed. The original is saved on this device.`,
    );
  if (manifest.state !== "verifying" && manifest.state !== "verified") {
    for (const part of parts) {
      check();
      if (manifest.parts.some((saved) => saved.index === part.index && saved.verifiedAt)) continue;
      options.onProgress?.(
        `Uploading ${label.toLowerCase()}, part ${part.index + 1} of ${parts.length}…`,
      );
      await uploadWithConfirmation(
        async (signal) => {
          check();
          const link = await api<{ url: string }>(
            `/api/sources/uploads/${source.uploadId}/parts/${part.index}`,
            "GET",
            undefined,
            undefined,
            { signal },
          );
          check();
          const bytes = photo.blob.slice(
            part.index * contract.partBytes,
            (part.index + 1) * contract.partBytes,
          );
          return options.put
            ? options.put(link.url, bytes, photo.blob.type, signal)
            : fetch(link.url, {
                method: "PUT",
                headers: { "content-type": photo.blob.type },
                body: bytes,
                signal,
              });
        },
        async (signal) => {
          check();
          return api(
            `/api/sources/uploads/${source.uploadId}/parts/${part.index}`,
            "POST",
            undefined,
            undefined,
            { signal },
          );
        },
        failureMessage,
        { ...recovery, confirmBeforeWrite: true, confirmSuccess: true },
      );
    }
    await request(
      `/api/sources/uploads/${source.uploadId}/complete`,
      "POST",
      {},
      `photo-complete:${photo.id}`,
    );
  }
  check();
  await options.store.savePhoto({ ...photo, sourceAssetId: source.assetId });
  check();
}

/** A declared photo group seals on the server; local journals only resume bytes and lost receipts. */
export async function prepareAutomaticRecordingPhotos(
  userId: string,
  material: NonNullable<Awaited<ReturnType<typeof automaticRecordingMaterial>>>,
  contract: InputContract,
  options: UploadOptions & { store: PhotoStore },
) {
  const key = `recalino:learning-photos:${userId}:${material.sessionId}`;
  let journal: PhotoBatchJournal | null = null;
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      if (/^[a-f0-9-]{36}$/i.test(saved))
        journal = {
          batchId: saved,
          fileIds: material.photos.map((photo) => photo.id),
          sources: {},
          legacy: true,
        };
      else journal = JSON.parse(saved) as PhotoBatchJournal;
    }
  } catch {
    throw new Error(
      "Saved board-photo upload details could not be read. The originals remain on this device.",
    );
  }
  if (!journal) {
    const fileIds = material.photos
      .filter((photo) => !photo.sourceAssetId)
      .map((photo) => photo.id);
    if (!fileIds.length) return;
    journal = { batchId: crypto.randomUUID(), fileIds, sources: {} };
  }
  const group = journal;
  const photos = group.fileIds.map((id) => {
    const photo = material.photos.find((candidate) => candidate.id === id);
    const recording = material.recordings.find((candidate) => candidate.id === photo?.recordingId);
    if (
      !photo ||
      !recording ||
      photo.userId !== userId ||
      recording.userId !== userId ||
      !recording.autoGenerate
    )
      throw new Error("A board photo's approved recording is unavailable on this device.");
    return { photo, recording };
  });
  if (!group.fileIds.length || new Set(group.fileIds).size !== group.fileIds.length)
    throw new Error(
      "Saved board-photo upload details are invalid. The originals remain on this device.",
    );
  // Keep the immutable declaration and every source receipt before the next network write.
  const saveJournal = () => localStorage.setItem(key, JSON.stringify(group));
  saveJournal();
  const request = options.request ?? workspaceRequest;
  const check = () => {
    options.signal?.throwIfAborted();
    options.checkAllowed?.();
  };
  check();
  const begun = await request<Partial<AutomaticLearningStatus>>(
    `/api/classes/${material.sessionId}/learning`,
    "POST",
    {
      action: "begin",
      batchId: group.batchId,
      ...(!group.legacy ? { expectedFileIds: group.fileIds } : {}),
    },
    undefined,
    { signal: options.signal },
  );
  check();
  if (begun?.lastError === "upload_batch_cancelled")
    throw new Error("This board-photo upload was cancelled. The originals remain on this device.");
  const closed = begun?.batchId === null;
  for (const { photo, recording } of photos) {
    check();
    await uploadAutomaticPhoto(recording, photo, contract, {
      ...options,
      ...(!group.legacy || closed
        ? {
            photoBatch: {
              id: group.batchId,
              closed,
              source: group.sources[photo.id],
              saveSource: (source: PhotoSource) => {
                group.sources[photo.id] = source;
                saveJournal();
              },
            },
          }
        : {}),
    });
  }
  check();
  // Only pre-upgrade, undeclared photo groups still need their legacy explicit closure.
  if (group.legacy && !closed)
    await request(
      `/api/classes/${material.sessionId}/learning`,
      "POST",
      { action: "complete", batchId: group.batchId },
      undefined,
      { signal: options.signal },
    );
  check();
  try {
    localStorage.removeItem(key);
  } catch {
    /* Replayed completion is safe. */
  }
  notifyAutomaticLearning(material.sessionId);
  if (material.photos.some((photo) => !photo.sourceAssetId && !group.fileIds.includes(photo.id)))
    throw new Error(
      "Additional board photos are saved. Their upload resumes after this group finishes verification.",
    );
}

export async function uploadAutomaticAudio(
  run: ProcessingRun,
  snapshot: RunSnapshot,
  contract: InputContract,
  options: UploadOptions & {
    userId: string;
    store: AudioStore;
  },
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.checkAllowed?.();
  };
  if (run.state !== "awaiting_upload") return;
  const recovery: UploadRecovery = {
    attempts: 3,
    signal: options.signal,
    onRetry: (attempt) => options.onProgress?.(`Retrying audio upload (${attempt} of 3)…`),
    onOffline: () =>
      options.onProgress?.("Saved on this device. Upload resumes when you reconnect."),
  };
  const api = options.request ?? workspaceRequest;
  const request = <T>(path: string, method: string, body?: unknown, key?: string) =>
    retryUploadRequest(
      async (signal) => {
        check();
        const value = await api<T>(path, method, body, key, { signal });
        check();
        return value;
      },
      "Audio upload was interrupted. The original is saved on this device.",
      recovery,
    );
  check();
  const rows = await options.store.list(options.userId);
  const sources = snapshot.sources.filter(
    (source) => source.kind === "audio" && !source.contentVersionId && !source.objectId,
  );
  const localFor = (sourceId: string) =>
    rows.find((row) => row.sourceAssetId === sourceId || row.id === sourceId);
  const files: AutomaticUploadProgress["files"] = sources.map((source, index) => ({
    sourceId: source.sourceId,
    displayName: `Audio file ${index + 1}`,
    sentBytes: 0,
    totalBytes: localFor(source.sourceId)?.bytes ?? 0,
    phase: "queued",
  }));
  const reportTransfer = () => {
    check();
    options.onTransferProgress?.({
      runId: run.id,
      sentBytes: files.reduce((sum, file) => sum + file.sentBytes, 0),
      totalBytes: files.reduce((sum, file) => sum + file.totalBytes, 0),
      files: files.map((file) => ({ ...file })),
    });
  };
  reportTransfer();
  for (const [sourceIndex, source] of sources.entries()) {
    check();
    const file = files[sourceIndex];
    if (!file) continue;
    const local = localFor(source.sourceId);
    if (!local) {
      const files = await request<{ assetId: string; displayName: string }[]>(
        `/api/classes/${run.sessionId}/sources`,
        "GET",
      );
      const name =
        files.find((file) => file.assetId === source.sourceId)?.displayName ??
        `Audio file ${snapshot.sources.indexOf(source) + 1}`;
      throw new Error(
        `${name} is not on this device. Open the device that saved it to resume the upload.`,
      );
    }
    file.phase = "checking";
    reportTransfer();
    options.onProgress?.(
      `Checking audio file ${sourceIndex + 1} of ${sources.length} before upload…`,
    );
    const blob = await options.store.blob(options.userId, local.id);
    file.totalBytes = blob.size;
    reportTransfer();
    const prepared = await prepareFileHashes(blob, contract.partBytes, true, options.signal);
    if (prepared.sha256 !== source.sha256)
      throw new Error("The local recording does not match this session material.");
    const parts = prepared.parts;
    const started = await request<{ uploadId: string }>(
      `/api/sources/${source.sourceId}/audio`,
      "POST",
      { action: "start", runId: run.id, reservationId: run.reservationId, parts },
      `audio-start:${run.id}:${source.sourceId}`,
    );
    const manifest = await request<{
      state?: string;
      parts: { index: number; verifiedAt: string | null }[];
    }>(`/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}`, "GET");
    if (manifest.state === "verifying" || manifest.state === "verified") {
      file.sentBytes = blob.size;
      file.phase = manifest.state === "verified" ? "complete" : "verifying";
      reportTransfer();
      continue;
    }
    const sentParts = new Map(
      parts.map((part) => [
        part.index,
        manifest.parts.some((stored) => stored.index === part.index && stored.verifiedAt)
          ? part.sizeBytes
          : 0,
      ]),
    );
    const reportPart = (index: number, sentBytes: number) => {
      sentParts.set(index, sentBytes);
      file.sentBytes = Math.min(
        blob.size,
        [...sentParts.values()].reduce((sum, sent) => sum + sent, 0),
      );
      reportTransfer();
    };
    file.phase = "uploading";
    file.sentBytes = [...sentParts.values()].reduce((sum, sent) => sum + sent, 0);
    reportTransfer();
    await concurrentUploads(
      parts.filter(
        (part) =>
          !manifest.parts.some((stored) => stored.index === part.index && stored.verifiedAt),
      ),
      3,
      async (part) => {
        check();
        options.onProgress?.(`Uploading audio part ${part.index + 1} of ${parts.length}…`);
        await uploadWithConfirmation(
          async (signal) => {
            check();
            const link = await api<{ url: string }>(
              `/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}&index=${part.index}`,
              "GET",
              undefined,
              undefined,
              { signal },
            );
            check();
            const bytes = blob.slice(
              part.index * contract.partBytes,
              Math.min(blob.size, (part.index + 1) * contract.partBytes),
            );
            return options.put
              ? options.put(link.url, bytes, source.mimeType, signal)
              : uploadWithProgress(
                  link.url,
                  bytes,
                  source.mimeType,
                  (sentBytes) => reportPart(part.index, sentBytes),
                  signal,
                );
          },
          async (signal) => {
            check();
            return api(
              `/api/sources/${source.sourceId}/audio`,
              "POST",
              {
                action: "confirm_part",
                runId: run.id,
                uploadId: started.uploadId,
                index: part.index,
              },
              undefined,
              { signal },
            );
          },
          "Audio upload was interrupted. The original is saved on this device.",
          {
            ...recovery,
            onRetry: (attempt) => {
              reportPart(part.index, 0);
              recovery.onRetry?.(attempt);
            },
            confirmBeforeWrite: true,
            confirmSuccess: true,
          },
        );
        reportPart(part.index, part.sizeBytes);
      },
    );
    file.phase = "verifying";
    reportTransfer();
    await request(
      `/api/sources/${source.sourceId}/audio`,
      "POST",
      { action: "complete", runId: run.id, uploadId: started.uploadId },
      `audio-complete:${run.id}:${source.sourceId}`,
    );
  }
  options.onProgress?.("Audio uploaded. Preparing your notes and flashcards…");
}
