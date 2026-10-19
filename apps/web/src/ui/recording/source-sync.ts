import { userMessage, WorkspaceRequestError, workspaceRequest } from "../workspace/api";
import { retryUploadRequest } from "../workspace/upload";
import type { RecordingController } from "./controller";
import type { IndexedRecordingStore, Recording, RecordingStore } from "./store";

type SyncController = Pick<RecordingController, "snapshot" | "subscribe" | "attachSession">;
type SyncStore = Pick<RecordingStore, "get" | "list" | "blob"> &
  Pick<IndexedRecordingStore, "updateRegistration">;
export type SourceSyncDependencies = {
  request: typeof workspaceRequest;
  online(): boolean;
};
export type SourceSyncState = {
  phase: "idle" | "syncing" | "waiting" | "failed";
  pending: number;
  count: number;
  error: string | null;
  captureId: string | null;
};
const defaults: SourceSyncDependencies = {
  request: workspaceRequest,
  online: () => typeof navigator === "undefined" || navigator.onLine,
};
class RegistrationCancelled extends Error {}
class RecordingNotReady extends Error {}
function finalized(row: Recording) {
  return ["saved", "interrupted"].includes(row.status) && !row.awaitingFinalData && row.bytes > 0;
}
function automatic(row: Recording) {
  return row.autoRegister === true && Boolean(row.completedAt) && finalized(row);
}
function recordingOrder(left: Recording, right: Recording) {
  if ((left.captureId ?? left.id) === (right.captureId ?? right.id))
    return (
      (left.segment ?? 1) - (right.segment ?? 1) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
function earlierPendingPart(rows: readonly Recording[], recording: Recording) {
  if (!recording.autoRegister) return false;
  return rows.some(
    (row) =>
      row.id !== recording.id &&
      row.autoRegister === true &&
      !row.sourceAssetId &&
      (!row.completedAt || row.awaitingFinalData || row.bytes > 0) &&
      ((row.captureId ?? row.id) === (recording.captureId ?? recording.id) ||
        (row.sessionId !== null && row.sessionId === recording.sessionId)) &&
      recordingOrder(row, recording) < 0,
  );
}
const waitingForEarlierParts =
  "Waiting for earlier recorded parts to finish saving and be added to this session.";
function permanentlyRejected(error: unknown) {
  return (
    error instanceof WorkspaceRequestError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status)
  );
}
async function checksum(blob: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Registers metadata only. Original audio stays local until processing is confirmed, or, for a
 * sealed in-app part under D60, until the capture uploader stages its temporary server copy.
 */
export async function registerRecordingRow(
  recording: Recording,
  store: SyncStore,
  controller: SyncController,
  dependencies: Partial<SourceSyncDependencies> & {
    signal?: AbortSignal;
    cancelled?: () => boolean;
    /** D60: a sealed part of a capture still in progress may be registered before Stop. */
    sealedDuringCapture?: boolean;
  } = {},
): Promise<Recording> {
  const deps = { ...defaults, ...dependencies };
  const check = () => {
    if (controller.snapshot().accountDeletionBlocked || deps.cancelled?.() || deps.signal?.aborted)
      throw new RegistrationCancelled("Recording registration was cancelled.");
  };
  const request = async <T>(path: string, body: unknown, key: string) => {
    check();
    if (!deps.online())
      throw new TypeError("An internet connection is needed to add session sources.");
    const result = await retryUploadRequest(
      (signal) => deps.request<T>(path, "POST", body, key, { signal }),
      "Adding session sources was interrupted. The recording remains saved on this device.",
      { attempts: 1, signal: deps.signal, timeoutMs: 30000 },
    );
    check();
    return result;
  };
  check();
  let current = await store.get(recording.userId, recording.id);
  check();
  if (!current) throw new Error("The recording is missing on this device.");
  if (current.sourceAssetId) return current;
  if (
    !finalized(current) ||
    (current.autoRegister && !current.completedAt && !dependencies.sealedDuringCapture)
  )
    throw new RecordingNotReady("Stop and save the recording before adding its final audio parts.");
  if (earlierPendingPart(await store.list(current.userId), current))
    throw new RecordingNotReady(waitingForEarlierParts);
  check();
  const captureId = current.captureId ?? current.id;
  let sessionId = current.sessionId;
  if (!sessionId) {
    const siblings = await store.list(current.userId);
    check();
    sessionId =
      siblings.find((row) => (row.captureId ?? row.id) === captureId && row.sessionId)?.sessionId ??
      null;
    if (!sessionId) {
      const created = await request<{ id: string }>("/api/classes", {}, current.creationKey);
      sessionId = created.id;
    }
    check();
    await controller.attachSession(sessionId, captureId);
    check();
  }
  const blob = await store.blob(current.userId, current.id);
  const sha256 = await checksum(blob);
  check();
  current = await store.get(current.userId, current.id);
  check();
  if (!current) throw new Error("The recording is missing on this device.");
  if (current.sourceAssetId) return current;
  if (!finalized(current) || current.bytes !== blob.size)
    throw new RecordingNotReady(
      "The final audio parts are still being saved. Registration will retry.",
    );
  if (earlierPendingPart(await store.list(current.userId), current))
    throw new RecordingNotReady(waitingForEarlierParts);
  check();
  const result = await request<{ assetId: string }>(
    "/api/recordings",
    {
      sessionId,
      kind: "audio",
      mimeType: current.mimeType.split(";")[0],
      sizeBytes: blob.size,
      sha256,
      displayName: `Session recording ${current.createdAt.slice(0, 10)}${current.autoRegister || (current.segment ?? 1) > 1 ? ` · Part ${current.segment ?? 1}` : ""}`,
      // The measured audio plus a one-second margin, so the server's decode never exceeds it.
      durationMs: Math.max(1, Math.round(current.activeMs) + 1000),
      parts: [],
    },
    `recorded-source:${current.id}`,
  );
  check();
  await store.updateRegistration(current.userId, current.id, {
    sessionId,
    sourceAssetId: result.assetId,
    syncError: null,
  });
  check();
  const saved = await store.get(current.userId, current.id);
  if (!saved) throw new Error("The recording is missing on this device.");
  return saved;
}

/** Resumes the durable metadata queue after Stop, reconnect, and subsequent page visits. */
export class RecordingSourceSync {
  private state: SourceSyncState = {
    phase: "idle",
    pending: 0,
    count: 0,
    error: null,
    captureId: null,
  };
  private listeners = new Set<() => void>();
  private started = false;
  private generation = 0;
  private running: Promise<void> | null = null;
  private rerun = false;
  private unsubscribe: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private attempts = 0;
  private attemptRowId: string | null = null;
  private permanentFailure = false;
  private blockedFailure = false;
  private failedRows = new Map<string, { message: string; permanent: boolean }>();
  private deps: SourceSyncDependencies;
  constructor(
    readonly userId: string,
    private store: SyncStore,
    private controller: SyncController,
    deps: Partial<SourceSyncDependencies> = {},
  ) {
    this.deps = { ...defaults, ...deps };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<SourceSyncState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
  private cancelled(generation: number) {
    return (
      !this.started ||
      generation !== this.generation ||
      this.controller.snapshot().accountDeletionBlocked
    );
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.generation++;
    this.unsubscribe = this.controller.subscribe(() => {
      if (this.controller.snapshot().accountDeletionBlocked) {
        this.generation++;
        this.clearRetry();
        this.abort?.abort();
        this.update({ phase: "idle", pending: 0, error: null });
      } else {
        this.kick();
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.checkOnline);
      window.addEventListener("offline", this.checkOnline);
      document.addEventListener("visibilitychange", this.becameVisible);
    }
    this.kick();
  }
  private becameVisible = () => {
    if (document.visibilityState === "visible") this.checkOnline();
  };
  checkOnline = () => {
    if (!this.started || this.controller.snapshot().accountDeletionBlocked) return;
    if (!this.deps.online()) {
      this.clearRetry();
      this.abort?.abort();
      if (this.state.pending)
        this.update({
          phase: "waiting",
          error: "Waiting for an internet connection. Audio is saved on this device.",
        });
      return;
    }
    this.clearRetry();
    this.attempts = 0;
    this.blockedFailure = false;
    for (const [id, failure] of this.failedRows) {
      if (!failure.permanent) this.failedRows.delete(id);
    }
    this.kick();
  };
  retry = () => {
    this.clearRetry();
    this.attempts = 0;
    this.permanentFailure = false;
    this.blockedFailure = false;
    this.failedRows.clear();
    this.kick();
  };
  private kick() {
    if (
      !this.started ||
      this.controller.snapshot().accountDeletionBlocked ||
      (this.blockedFailure && this.failedRows.size === 0) ||
      this.retryTimer !== null
    )
      return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    const generation = this.generation;
    const running = this.run(generation).finally(() => {
      if (this.running !== running) return;
      this.running = null;
      this.abort = null;
      const again = this.rerun;
      this.rerun = false;
      if (again && this.started && !this.controller.snapshot().accountDeletionBlocked) this.kick();
    });
    this.running = running;
  }
  private async run(generation: number) {
    let current: Recording | null = null;
    try {
      const manifests = await this.store.list(this.userId);
      const all = manifests.filter(automatic);
      if (this.cancelled(generation)) return;
      const ids = new Set(all.map((row) => row.id));
      for (const id of this.failedRows.keys()) if (!ids.has(id)) this.failedRows.delete(id);
      const missing = all.filter((row) => !row.sourceAssetId);
      const pending = all
        .filter(
          (row) =>
            !row.sourceAssetId &&
            !this.failedRows.has(row.id) &&
            !earlierPendingPart(manifests, row),
        )
        .sort(recordingOrder);
      this.update({ pending: missing.length, count: all.length - missing.length });
      if (!pending.length) {
        this.attempts = 0;
        this.update({
          phase: missing.length ? (this.failedRows.size ? "failed" : "waiting") : "idle",
          error: missing.length
            ? this.failedRows.size
              ? this.failureMessage()
              : waitingForEarlierParts
            : null,
        });
        return;
      }
      if (!this.deps.online()) {
        this.update({
          phase: "waiting",
          error: "Waiting for an internet connection. Audio is saved on this device.",
        });
        return;
      }
      this.abort = new AbortController();
      this.update({ phase: "syncing", error: null });
      for (const row of pending) {
        if (this.cancelled(generation)) return;
        current = row;
        if (this.attemptRowId !== row.id) {
          this.attempts = 0;
          this.attemptRowId = row.id;
        }
        this.update({ captureId: row.captureId ?? row.id });
        await registerRecordingRow(row, this.store, this.controller, {
          ...this.deps,
          signal: this.abort.signal,
          cancelled: () => this.cancelled(generation),
        });
        if (this.cancelled(generation)) return;
        this.attempts = 0;
        this.attemptRowId = null;
        this.update({ pending: Math.max(0, this.state.pending - 1), count: this.state.count + 1 });
      }
      this.attempts = 0;
      // Register the next ordered sibling after the preceding durable acknowledgment.
      if (this.state.pending) this.rerun = true;
      this.update({
        phase: this.state.pending ? (this.failedRows.size ? "failed" : "waiting") : "idle",
        error: this.state.pending
          ? this.failedRows.size
            ? this.failureMessage()
            : waitingForEarlierParts
          : null,
      });
    } catch (error) {
      if (this.cancelled(generation)) return;
      if (error instanceof RecordingNotReady) {
        this.update({ phase: "waiting", error: error.message });
        return;
      }
      const message = userMessage(error, "Session material could not be updated.");
      if (current) {
        await this.store
          .updateRegistration(this.userId, current.id, { syncError: message })
          .catch(() => {});
        if (this.cancelled(generation)) return;
      }
      this.permanentFailure = permanentlyRejected(error);
      this.attempts++;
      this.blockedFailure = this.permanentFailure || this.attempts >= 5;
      if (this.blockedFailure && current) {
        this.failedRows.set(current.id, { message, permanent: this.permanentFailure });
        this.attempts = 0;
        this.attemptRowId = null;
        this.rerun = true;
      }
      this.update({
        phase: this.blockedFailure ? "failed" : "waiting",
        error: this.permanentFailure
          ? `${message} Audio is still saved on this device. Resolve this issue and retry adding session sources.`
          : "Session source registration was interrupted. Audio is saved on this device; it will retry when connected.",
      });
      if (!this.blockedFailure && this.deps.online()) {
        this.retryTimer = setTimeout(
          () => {
            this.retryTimer = null;
            this.kick();
          },
          Math.min(15000, 1000 * 2 ** (this.attempts - 1)),
        );
      }
    }
  }
  private failureMessage() {
    return `${this.failedRows.values().next().value?.message ?? "Some recorded parts could not be added."} Audio is saved on this device. Resolve this issue and retry adding session sources.`;
  }
  dispose() {
    this.started = false;
    this.generation++;
    this.clearRetry();
    this.abort?.abort();
    this.abort = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.running = null;
    this.rerun = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.checkOnline);
      window.removeEventListener("offline", this.checkOnline);
      document.removeEventListener("visibilitychange", this.becameVisible);
    }
  }
}
