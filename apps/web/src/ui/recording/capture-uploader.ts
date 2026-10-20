import { workspaceRequest } from "../workspace/api";
import { prepareFileHashes } from "../workspace/file-hashes";
import { retryUploadRequest, uploadWithConfirmation } from "../workspace/upload";
import { concurrentUploads } from "../workspace/upload-concurrency";
import { uploadWithProgress } from "../workspace/upload-progress";
import type { CaptureState, RecordingController } from "./controller";
import { registerRecordingRow } from "./source-sync";
import type { IndexedRecordingStore, Recording, RecordingStore } from "./store";

/**
 * D60 and D61 (owner decisions 2026-10-12): while a class is being recorded, each sealed part is
 * registered and its temporary server copy uploaded silently, so after Stop only the last part is
 * left to send and transcription can already be under way. Nothing here is ever shown during
 * capture (PRD-REC-02): a part that cannot be staged is simply sent by the usual upload after
 * Stop, whose own messages then apply. Real capture failures stay the controller's (PRD-REC-03).
 */
type Controller = Pick<RecordingController, "snapshot" | "subscribe" | "attachSession"> & {
  report?: (part: number, result: StagingResult, durationMs?: number) => void;
};
export type StagingResult = "staged" | "skipped" | "failed";
type Store = Pick<RecordingStore, "get" | "list" | "blob"> &
  Pick<IndexedRecordingStore, "updateRegistration">;
export type CaptureFlags = { earlyUpload: boolean; earlyTranscription: boolean };
export type CaptureUploaderDependencies = {
  request: typeof workspaceRequest;
  online(): boolean;
  partBytes(): Promise<number>;
  put: (
    url: string,
    body: Blob,
    contentType: string,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; status: number }>;
  hash: typeof prepareFileHashes;
  now(): number;
  /** Repeats `task` every `ms`; returns a function that stops it. */
  repeat(task: () => void, ms: number): () => void;
  /** Time a staged part may still take after Stop before the usual upload takes over. */
  settleMs: number;
  pollMs: number;
};
const ACTIVE = new Set<CaptureState["phase"]>([
  "starting",
  "recording",
  "recovering",
  "paused",
  "saving",
]);
const LEASE_RENEW_MS = 5 * 60 * 1000;

const defaults: CaptureUploaderDependencies = {
  request: workspaceRequest,
  online: () => typeof navigator === "undefined" || navigator.onLine,
  partBytes: async () =>
    (await workspaceRequest<{ contract: { partBytes: number } }>("/api/sources/contract", "GET"))
      .contract.partBytes,
  put: (url, body, contentType, signal) =>
    uploadWithProgress(url, body, contentType, () => {}, signal),
  hash: prepareFileHashes,
  now: () => Date.now(),
  repeat: (task, ms) => {
    const id = setInterval(task, ms);
    return () => clearInterval(id);
  },
  settleMs: 60000,
  pollMs: 2000,
};

export class CaptureUploader {
  private deps: CaptureUploaderDependencies;
  private unsubscribe: (() => void) | null = null;
  private captureId: string | null = null;
  private sessionId: string | null = null;
  private flags: CaptureFlags | null = null;
  private stopRenewing: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private abort: AbortController | null = null;
  private staged = new Map<string, { path: string; uploadId: string }>();
  private partSize: number | null = null;
  private failed = new Set<string>();
  private stoppedAt: number | null = null;
  private disposed = false;
  constructor(
    readonly userId: string,
    private store: Store,
    private controller: Controller,
    deps: Partial<CaptureUploaderDependencies> = {},
  ) {
    this.deps = { ...defaults, ...deps };
  }
  start() {
    this.unsubscribe ??= this.controller.subscribe(() => this.changed());
    this.changed();
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.abort?.abort();
    this.stopLease();
  }
  /**
   * On unmount (D104): keeps watching until the capture's Stop has settled and the lease is
   * closed, then disposes. Disposing first would leave the lease to lapse on its own.
   */
  async disposeAfter(stopped: Promise<unknown>): Promise<void> {
    await stopped.catch(() => {});
    while (this.running && !this.disposed) await this.running;
    this.dispose();
  }
  /** Settles staging after Stop, then lets automatic learning start (closes the lease). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }
  private changed() {
    if (this.disposed) return;
    const state = this.controller.snapshot();
    if (state.accountDeletionBlocked) {
      this.abort?.abort();
      return;
    }
    const recording = state.recording;
    const active = ACTIVE.has(state.phase);
    if (active && recording) {
      const captureId = recording.captureId ?? recording.id;
      if (captureId !== this.captureId) {
        this.captureId = captureId;
        this.sessionId = null;
        this.flags = null;
        this.staged.clear();
        this.failed.clear();
        this.stoppedAt = null;
      }
      this.sessionId = recording.sessionId ?? this.sessionId;
    } else if (this.captureId && this.stoppedAt === null) {
      this.stoppedAt = this.deps.now();
    }
    this.kick();
  }
  private kick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    const running = this.run().finally(() => {
      if (this.running === running) this.running = null;
      if (this.rerun && !this.disposed) {
        this.rerun = false;
        this.kick();
      }
    });
    this.running = running;
  }
  private async run() {
    const captureId = this.captureId;
    const sessionId = this.sessionId;
    if (!captureId || !sessionId || !this.deps.online()) return this.finishIfStopped();
    try {
      if (!this.flags) {
        this.flags = await this.lease(sessionId, "open");
        if (this.flags.earlyUpload && this.stoppedAt === null) this.startLease(sessionId);
      }
      if (!this.flags.earlyUpload) return this.finishIfStopped();
      const rows = (await this.store.list(this.userId))
        .filter((row) => (row.captureId ?? row.id) === captureId)
        .sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
      for (const row of rows) {
        if (this.disposed || this.captureId !== captureId) return;
        // After Stop, the usual upload sends what staging has not started; never two transfers.
        if (this.stoppedAt !== null && this.deps.now() - this.stoppedAt > this.deps.settleMs) break;
        if (!sealed(row) || this.staged.has(row.id) || this.failed.has(row.id)) continue;
        await this.stage(row);
      }
    } catch {
      /* Staging is an optimisation; the usual upload after Stop covers anything left. */
    }
    return this.finishIfStopped();
  }
  private async finishIfStopped() {
    if (this.stoppedAt === null || !this.captureId) return;
    this.stopLease();
    // A run created while a staged copy is still being verified would transfer it again.
    for (const { path, uploadId } of this.staged.values()) {
      while (!this.disposed && this.deps.now() - this.stoppedAt < this.deps.settleMs) {
        const manifest = await this.deps
          .request<{ state: string }>(`${path}?uploadId=${uploadId}`, "GET")
          .catch(() => null);
        if (manifest?.state !== "pending") break;
        await new Promise((resolve) => setTimeout(resolve, this.deps.pollMs));
      }
    }
    const sessionId = this.sessionId;
    this.captureId = null;
    if (sessionId && this.flags?.earlyUpload)
      await this.lease(sessionId, "close").catch(() => {
        /* The lease lapses on its own within 15 minutes. */
      });
  }
  private async lease(sessionId: string, action: "open" | "close") {
    return this.deps.request<CaptureFlags & { openUntil: string | null }>(
      `/api/classes/${sessionId}/capture`,
      "POST",
      { action },
    );
  }
  private startLease(sessionId: string) {
    this.stopLease();
    this.stopRenewing = this.deps.repeat(() => {
      if (this.stoppedAt === null) void this.lease(sessionId, "open").catch(() => {});
    }, LEASE_RENEW_MS);
  }
  private stopLease() {
    this.stopRenewing?.();
    this.stopRenewing = null;
  }
  private async stage(row: Recording) {
    const abort = new AbortController();
    this.abort = abort;
    const started = this.deps.now();
    try {
      const registered = row.sourceAssetId
        ? row
        : await registerRecordingRow(row, this.store, this.controller, {
            request: this.deps.request,
            online: this.deps.online,
            signal: abort.signal,
            sealedDuringCapture: true,
          });
      const assetId = registered.sourceAssetId;
      if (!assetId) throw new Error("not registered");
      const path = `/api/sources/${assetId}/audio/staged`;
      const request = <T>(method: string, url: string, body?: unknown, key?: string) =>
        retryUploadRequest(
          (signal) => this.deps.request<T>(url, method, body, key, { signal }),
          "Staging was interrupted.",
          { attempts: 3, signal: abort.signal },
        );
      const blob = await this.store.blob(this.userId, registered.id);
      this.partSize ??= await this.deps.partBytes();
      const partBytes = this.partSize;
      const prepared = await this.deps.hash(blob, partBytes, true, abort.signal);
      const begun = await request<{ uploadId: string; state: string }>(
        "POST",
        path,
        { action: "start", parts: prepared.parts },
        `staged-start:${registered.id}`,
      );
      if (begun.state !== "pending") {
        this.staged.set(row.id, { path, uploadId: begun.uploadId });
        this.controller.report?.(
          row.segment ?? 1,
          begun.state === "verified" ? "staged" : "skipped",
        );
        return;
      }
      const manifest = await request<{ parts: { index: number; verifiedAt: string | null }[] }>(
        "GET",
        `${path}?uploadId=${begun.uploadId}`,
      );
      const mimeType = registered.mimeType.split(";")[0] ?? registered.mimeType;
      await concurrentUploads(
        prepared.parts.filter(
          (part) =>
            !manifest.parts.some((stored) => stored.index === part.index && stored.verifiedAt),
        ),
        2,
        async (part) => {
          await uploadWithConfirmation(
            async (signal) => {
              const link = await this.deps.request<{ url: string }>(
                `${path}?uploadId=${begun.uploadId}&index=${part.index}`,
                "GET",
                undefined,
                undefined,
                { signal },
              );
              const bytes = blob.slice(
                part.index * partBytes,
                Math.min(blob.size, (part.index + 1) * partBytes),
              );
              return this.deps.put(link.url, bytes, mimeType, signal ?? abort.signal);
            },
            (signal) =>
              this.deps.request(
                path,
                "POST",
                { action: "confirm_part", uploadId: begun.uploadId, index: part.index },
                undefined,
                { signal },
              ),
            "Staging was interrupted.",
            { attempts: 3, signal: abort.signal, confirmBeforeWrite: true, confirmSuccess: true },
          );
        },
      );
      await request(
        "POST",
        path,
        { action: "complete", uploadId: begun.uploadId },
        `staged-complete:${registered.id}`,
      );
      this.staged.set(row.id, { path, uploadId: begun.uploadId });
      this.controller.report?.(row.segment ?? 1, "staged", Math.round(this.deps.now() - started));
    } catch {
      this.failed.add(row.id);
      this.controller.report?.(row.segment ?? 1, "failed", Math.round(this.deps.now() - started));
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }
}

/** Finished and complete on this device, but not yet part of a stopped capture. */
function sealed(row: Recording) {
  return (
    row.autoRegister === true &&
    ["saved", "interrupted"].includes(row.status) &&
    !row.awaitingFinalData &&
    row.bytes > 0
  );
}
