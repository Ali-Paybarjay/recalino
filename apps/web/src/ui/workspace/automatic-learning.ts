import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { pendingClassRecordings } from "../recording/processing-readiness";
import type { LocalPhoto, Recording, RecordingStore } from "../recording/store";
import { workspaceRequest } from "./api";
import { retryUploadRequest, type UploadRecovery, uploadWithConfirmation } from "./upload";

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
type UploadOptions = {
  signal?: AbortSignal;
  checkAllowed?: () => void;
  onProgress?: (message: string) => void;
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
  options: UploadOptions & { store: Pick<PhotoStore, "savePhoto"> },
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.checkAllowed?.();
  };
  check();
  if (photo.sourceAssetId) return;
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
  const hash = async (blob: Blob) => {
    check();
    const value = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    check();
    return value;
  };
  const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
  for (let offset = 0; offset < photo.blob.size; offset += contract.partBytes) {
    const part = photo.blob.slice(offset, offset + contract.partBytes);
    parts.push({ index: parts.length, sizeBytes: part.size, sha256: await hash(part) });
  }
  const source = await request<{ assetId: string; uploadId: string }>(
    "/api/sources",
    "POST",
    {
      sessionId: recording.sessionId,
      kind: "image",
      mimeType: photo.blob.type,
      sizeBytes: photo.blob.size,
      sha256: await hash(photo.blob),
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
  const manifest = await request<{
    state?: string;
    parts: { index: number; verifiedAt: string | null }[];
  }>(`/api/sources/uploads/${source.uploadId}`, "GET");
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

/** A failed recording-photo batch remains open until its saved photos resume successfully. */
export async function prepareAutomaticRecordingPhotos(
  userId: string,
  material: NonNullable<Awaited<ReturnType<typeof automaticRecordingMaterial>>>,
  contract: InputContract,
  options: UploadOptions & { store: PhotoStore },
) {
  const key = `recalino:learning-photos:${userId}:${material.sessionId}`;
  let batchId: string | null = null;
  try {
    batchId = localStorage.getItem(key);
  } catch {
    /* Server batch guards also persist. */
  }
  if (!material.photos.some((photo) => !photo.sourceAssetId) && !batchId) return;
  const request = options.request ?? workspaceRequest;
  const check = () => {
    options.signal?.throwIfAborted();
    options.checkAllowed?.();
  };
  check();
  batchId = await openAutomaticBatch(material.sessionId, key, request, options);
  for (const photo of material.photos) {
    check();
    const recording = material.recordings.find((recording) => recording.id === photo.recordingId);
    if (!recording) throw new Error("A board photo's recording is unavailable on this device.");
    await uploadAutomaticPhoto(recording, photo, contract, options);
  }
  check();
  await request(
    `/api/classes/${material.sessionId}/learning`,
    "POST",
    { action: "complete", batchId },
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
  const hash = async (blob: Blob) => {
    check();
    const value = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    check();
    return value;
  };
  check();
  const rows = await options.store.list(options.userId);
  for (const source of snapshot.sources.filter(
    (source) => source.kind === "audio" && !source.contentVersionId && !source.objectId,
  )) {
    check();
    const local = rows.find(
      (row) => row.sourceAssetId === source.sourceId || row.id === source.sourceId,
    );
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
    const blob = await options.store.blob(options.userId, local.id);
    if ((await hash(blob)) !== source.sha256)
      throw new Error("The local recording does not match this class material.");
    const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
    for (let offset = 0; offset < blob.size; offset += contract.partBytes) {
      const part = blob.slice(offset, offset + contract.partBytes);
      parts.push({ index: parts.length, sizeBytes: part.size, sha256: await hash(part) });
    }
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
    if (manifest.state === "verifying" || manifest.state === "verified") continue;
    for (const part of parts) {
      check();
      if (manifest.parts.some((stored) => stored.index === part.index && stored.verifiedAt))
        continue;
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
            : fetch(link.url, {
                method: "PUT",
                headers: { "content-type": source.mimeType },
                signal,
                body: bytes,
              });
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
        { ...recovery, confirmBeforeWrite: true, confirmSuccess: true },
      );
    }
    await request(
      `/api/sources/${source.sourceId}/audio`,
      "POST",
      { action: "complete", runId: run.id, uploadId: started.uploadId },
      `audio-complete:${run.id}:${source.sourceId}`,
    );
  }
  options.onProgress?.("Audio uploaded. Preparing your notes and flashcards…");
}
