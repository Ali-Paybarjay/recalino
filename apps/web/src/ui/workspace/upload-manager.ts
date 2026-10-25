import type { InputContract } from "@recalino/core/src";
import type { RecordingStore } from "../recording/store";
import { WorkspaceRequestError, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import type { SelectedFile } from "./file-selection";
import { createSourceUploadRequest } from "./source-upload";
import { uploadQueuedFile } from "./upload-file";
import type { UploadBatch, UploadEntry, UploadStore } from "./upload-store";

const settled = (entry: UploadEntry) =>
  ["local_saved", "verifying", "complete", "skipped"].includes(entry.phase);

/** The application layout owns this controller; source-page disposal has no effect on it. */
export class UploadManager {
  private batches: UploadBatch[] = [];
  private view: UploadBatch[] = [];
  private listeners = new Set<() => void>();
  private running = false;
  private disposed = false;
  private operation: AbortController | null = null;
  private revision = 0;
  private stopped = false;
  private activityRevision = 0;
  private restartRequested = false;
  private idleWaiters = new Set<() => void>();
  private cancelling = false;
  constructor(
    readonly userId: string,
    private store: UploadStore,
    private recordings: RecordingStore,
    private deps: {
      request?: typeof workspaceRequest;
      upload?: typeof uploadQueuedFile;
      allowed?: () => boolean;
      lock?: (name: string, effect: () => Promise<void>) => Promise<void>;
    } = {},
  ) {}
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.view = this.batches.map((batch) => ({
      ...batch,
      receipt: { ...batch.receipt, sourceIds: [...batch.receipt.sourceIds] },
      entries: batch.entries.map((entry) => ({ ...entry })),
    }));
    for (const listener of this.listeners) listener();
  }
  private reportProblem(failure: unknown, batchId?: string) {
    if (this.disposed || this.stopped) return;
    for (const batch of this.batches) {
      if (batchId && batch.id !== batchId) continue;
      if (batch.phase === "cancelled" || (batch.phase === "received" && !batchId)) continue;
      if (batch.phase !== "received") batch.phase = "attention";
      batch.problem =
        failure instanceof WorkspaceRequestError &&
        failure.fields?.batch?.includes("select_at_least_one")
          ? "This is the last file in the upload group. Cancel this saved upload before adding a replacement."
          : failure instanceof Error
            ? failure.message
            : "Saved uploads need attention. Retry when connected.";
    }
    this.publish();
  }
  private async lock(effect: () => Promise<void>, requireLease = false) {
    let executed = false;
    const guarded = async () => {
      executed = true;
      await effect();
    };
    if (this.deps.lock) await this.deps.lock(`recalino-uploads:${this.userId}`, guarded);
    else await guarded();
    if (requireLease && !executed)
      throw new Error(
        "This upload is active in another tab. Cancel it there or close that tab and retry.",
      );
  }
  private finishRunning() {
    this.running = false;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
  private idle() {
    return this.running
      ? new Promise<void>((resolve) => this.idleWaiters.add(resolve))
      : Promise.resolve();
  }
  async restore() {
    const revision = ++this.revision;
    const saved = await this.store.list(this.userId);
    if (this.disposed || revision !== this.revision) return;
    this.batches = saved.sort((a, b) => a.createdAt - b.createdAt);
    this.publish();
  }
  async enqueue(
    sessionId: string,
    files: readonly SelectedFile[],
    contract: InputContract,
    storageConfigured: boolean,
  ) {
    if (!files.length || files.some((file) => file.invalid))
      throw new Error("Choose valid files before uploading.");
    if (files.length > (contract.maxSourcesPerSession ?? 250))
      throw new Error("This group exceeds the class file limit. Choose fewer files.");
    if (
      this.batches.some(
        (batch) =>
          batch.sessionId === sessionId && !["received", "cancelled"].includes(batch.phase),
      )
    )
      throw new Error(
        "Finish or retry the saved upload for this class before adding another batch.",
      );
    if (this.deps.allowed?.() === false || this.disposed)
      throw new Error("Uploads are paused. Try again when the current operation finishes.");
    const createdAt = Date.now();
    const batch: UploadBatch = {
      id: crypto.randomUUID(),
      userId: this.userId,
      sessionId,
      contract,
      storageConfigured,
      createdAt,
      phase: "queued",
      entries: files.map(({ id, file }) => ({
        id,
        displayName: file.name,
        sizeBytes: file.size,
        lastModified: file.lastModified,
        mimeType: file.type,
        creationKey: crypto.randomUUID(),
        phase: "queued",
        sentBytes: 0,
        startedAt: createdAt,
        serverSeen: false,
      })),
      receipt: {
        revision: null,
        previousRunId: null,
        sourceIds: [],
        total: files.length,
        failed: 0,
        startedAt: createdAt,
      },
    };
    await this.store.save(
      batch,
      files.map(({ id, file }) => ({ id, blob: file })),
    );
    if (this.disposed) return;
    this.batches.push(batch);
    this.publish();
    void this.kick();
  }
  async retry(batchId: string, fileId?: string) {
    await this.mutate(batchId, async (batch) => {
      for (const entry of batch.entries)
        if (entry.phase === "failed" && (!fileId || entry.id === fileId)) {
          entry.phase = "queued";
          delete entry.problem;
        }
      batch.phase = "queued";
      delete batch.problem;
      delete batch.receipt.problem;
      batch.receipt.failed = batch.entries.filter((entry) => entry.phase === "failed").length;
      await this.store.save(batch);
    });
  }
  async skip(batchId: string, fileId: string) {
    let skipped = false;
    await this.mutate(
      batchId,
      async (batch, signal) => {
        const entry = batch.entries.find((row) => row.id === fileId);
        if (
          !entry ||
          entry.phase === "skipped" ||
          (batch.phase !== "received" && entry.phase !== "failed")
        )
          return;
        const request = createSourceUploadRequest(
          { signal },
          this.deps.request ?? workspaceRequest,
        );
        await request(`/api/classes/${batch.sessionId}/learning`, "POST", {
          action: "skip_file",
          batchId,
          fileId,
        });
        signal.throwIfAborted();
        entry.phase = "skipped";
        delete entry.problem;
        if (batch.phase !== "received") batch.phase = "queued";
        delete batch.problem;
        delete batch.receipt.problem;
        if (
          entry.source &&
          !batch.entries.some(
            (row) => row.phase !== "skipped" && row.source?.assetId === entry.source?.assetId,
          )
        )
          batch.receipt.sourceIds = batch.receipt.sourceIds.filter(
            (sourceId) => sourceId !== entry.source?.assetId,
          );
        batch.receipt.total = batch.entries.filter((row) => row.phase !== "skipped").length;
        batch.receipt.failed = batch.entries.filter((row) => row.phase === "failed").length;
        await this.store.save(batch);
        await this.store.removeFile(this.userId, batch.id, entry.id);
        skipped = true;
        notifyAutomaticLearning(batch.sessionId);
      },
      { received: true },
    );
    return skipped;
  }
  /** Drain active writers before cancelling the server fence and removing the local originals. */
  async cancel(batchId: string) {
    if (this.disposed || this.cancelling || this.deps.allowed?.() === false) return;
    this.cancelling = true;
    const wasStopped = this.stopped;
    this.pause();
    const activityRevision = this.activityRevision;
    await this.idle();
    const controller = new AbortController();
    this.operation = controller;
    this.running = true;
    try {
      await this.lock(async () => {
        controller.signal.throwIfAborted();
        if (this.disposed || this.deps.allowed?.() === false) return;
        const latest = (await this.store.list(this.userId)).find((row) => row.id === batchId);
        controller.signal.throwIfAborted();
        if (!latest || this.disposed || this.deps.allowed?.() === false) return;
        const batch = this.batches.find((row) => row.id === batchId);
        if (!batch) return;
        Object.assign(batch, latest);
        if (batch.phase === "cancelled") {
          for (const entry of batch.entries)
            await this.store.removeFile(this.userId, batch.id, entry.id);
          this.publish();
          return;
        }
        const request = createSourceUploadRequest(
          { signal: controller.signal },
          this.deps.request ?? workspaceRequest,
        );
        if (batch.phase === "received") {
          const status = await request<AutomaticLearningStatus>(
            `/api/classes/${batch.sessionId}/learning`,
            "GET",
          );
          controller.signal.throwIfAborted();
          batch.receipt.revision = status.revision;
          if (status.batchId !== batch.id) {
            delete batch.problem;
            delete batch.receipt.problem;
            this.publish();
            return;
          }
        }
        if (!batch.opened) {
          const begun = await request<AutomaticLearningStatus>(
            `/api/classes/${batch.sessionId}/learning`,
            "POST",
            {
              action: "begin",
              batchId: batch.id,
              expectedFileIds: batch.entries.map((entry) => entry.id),
            },
          );
          controller.signal.throwIfAborted();
          batch.opened = true;
          batch.receipt.revision = begun.revision;
          await this.store.save(batch);
        }
        await request(`/api/classes/${batch.sessionId}/learning`, "POST", {
          action: "cancel_batch",
          batchId,
        });
        controller.signal.throwIfAborted();
        batch.phase = "cancelled";
        delete batch.problem;
        batch.receipt.failed = 0;
        batch.entries = batch.entries.map((entry) => ({
          ...entry,
          phase: "skipped",
          problem: undefined,
        }));
        await this.store.save(batch);
        for (const entry of batch.entries)
          await this.store.removeFile(this.userId, batch.id, entry.id);
        this.publish();
        notifyAutomaticLearning(batch.sessionId);
      }, true);
    } catch (failure) {
      if (this.activityRevision === activityRevision) this.stopped = wasStopped;
      if (!controller.signal.aborted) this.reportProblem(failure, batchId);
    } finally {
      if (this.operation === controller) this.operation = null;
      this.finishRunning();
      this.cancelling = false;
      if (this.activityRevision === activityRevision) this.stopped = wasStopped;
    }
    await this.kick();
  }
  /** User retries and skips use the same fresh, account-locked checkpoints as transfers. */
  private async mutate(
    batchId: string,
    effect: (batch: UploadBatch, signal: AbortSignal) => Promise<void>,
    options: { received?: boolean } = {},
  ) {
    if (this.running || this.disposed || this.stopped || this.deps.allowed?.() === false) return;
    this.running = true;
    const controller = new AbortController();
    this.operation = controller;
    try {
      await this.lock(async () => {
        controller.signal.throwIfAborted();
        if (this.disposed || this.stopped || this.deps.allowed?.() === false) return;
        const latest = (await this.store.list(this.userId)).find((row) => row.id === batchId);
        controller.signal.throwIfAborted();
        if (!latest || this.disposed || this.stopped || this.deps.allowed?.() === false) return;
        const batch = this.batches.find((row) => row.id === batchId);
        if (!batch) return;
        Object.assign(batch, latest);
        let eligible = batch.phase !== "received" && batch.phase !== "cancelled";
        if (options.received && batch.phase === "received") {
          const request = createSourceUploadRequest(
            { signal: controller.signal },
            this.deps.request ?? workspaceRequest,
          );
          const status = await request<AutomaticLearningStatus>(
            `/api/classes/${batch.sessionId}/learning`,
            "GET",
          );
          controller.signal.throwIfAborted();
          batch.receipt.revision = status.revision;
          eligible = status.batchId === batch.id;
          if (!eligible) {
            delete batch.problem;
            delete batch.receipt.problem;
          }
        }
        if (eligible) await effect(batch, controller.signal);
        this.publish();
      }, true);
    } catch (failure) {
      if (!controller.signal.aborted) this.reportProblem(failure, batchId);
    } finally {
      if (this.operation === controller) this.operation = null;
      this.finishRunning();
    }
    await this.kick();
  }
  pause() {
    this.activityRevision++;
    this.stopped = true;
    this.restartRequested = false;
    this.operation?.abort(new DOMException("Uploads are paused.", "AbortError"));
  }
  resume() {
    if (this.disposed) return;
    this.activityRevision++;
    this.stopped = false;
    if (this.running) this.restartRequested = true;
    else void this.kick();
  }
  dispose() {
    this.disposed = true;
    this.pause();
    this.listeners.clear();
  }
  async kick() {
    if (this.running || this.disposed || this.stopped || this.deps.allowed?.() === false) return;
    this.running = true;
    try {
      for (const batch of this.batches) {
        if (this.disposed || this.stopped || this.deps.allowed?.() === false) break;
        if (["received", "cancelled", "attention"].includes(batch.phase)) continue;
        const effect = async () => {
          if (this.disposed || this.stopped || this.deps.allowed?.() === false) return;
          // Reload under the per-account lock so another tab's committed checkpoints win.
          const latest = (await this.store.list(this.userId)).find((row) => row.id === batch.id);
          if (this.disposed || this.stopped || this.deps.allowed?.() === false || !latest) return;
          Object.assign(batch, latest);
          this.publish();
          if (["received", "cancelled", "attention"].includes(latest.phase)) return;
          await this.process(batch);
        };
        await this.lock(effect);
      }
    } catch (failure) {
      this.reportProblem(failure);
    } finally {
      this.finishRunning();
      if (this.restartRequested && !this.stopped && !this.disposed) {
        this.restartRequested = false;
        void this.kick();
      }
    }
  }
  private async process(batch: UploadBatch) {
    const controller = new AbortController();
    this.operation = controller;
    const recovery = { signal: controller.signal, attempts: 3 };
    const request = createSourceUploadRequest(recovery, this.deps.request ?? workspaceRequest);
    try {
      batch.phase = "uploading";
      this.publish();
      if (!batch.opened) {
        const before = await request<AutomaticLearningStatus>(
          `/api/classes/${batch.sessionId}/learning`,
          "GET",
        );
        batch.receipt.previousRunId = before.run?.id ?? null;
        const begun = await request<AutomaticLearningStatus>(
          `/api/classes/${batch.sessionId}/learning`,
          "POST",
          {
            action: "begin",
            batchId: batch.id,
            expectedFileIds: batch.entries.map((entry) => entry.id),
          },
        );
        batch.receipt.revision = begun.revision;
        batch.opened = true;
        await this.store.save(batch);
      }
      for (const entry of batch.entries) {
        controller.signal.throwIfAborted();
        if (settled(entry)) {
          if (entry.source && entry.phase !== "skipped")
            batch.receipt.sourceIds = [
              ...new Set([...batch.receipt.sourceIds, entry.source.assetId]),
            ];
          await this.store.removeFile(this.userId, batch.id, entry.id);
          continue;
        }
        try {
          const blob = await this.store.file(this.userId, batch.id, entry.id);
          if (!blob)
            throw new Error(
              "The saved file is unavailable on this device. Skip it and add the original again.",
            );
          const assetId = await (this.deps.upload ?? uploadQueuedFile)(batch, entry, blob, {
            request,
            recordings: this.recordings,
            recovery,
            patch: async (patch, persist) => {
              controller.signal.throwIfAborted();
              Object.assign(entry, patch);
              this.publish();
              if (persist) await this.store.save(batch);
            },
          });
          batch.receipt.sourceIds = [...new Set([...batch.receipt.sourceIds, assetId])];
          await this.store.save(batch);
          await this.store.removeFile(this.userId, batch.id, entry.id);
        } catch (failure) {
          controller.signal.throwIfAborted();
          entry.phase = "failed";
          entry.problem =
            failure instanceof Error
              ? failure.message
              : "Upload interrupted. Retry this saved file.";
          entry.finishedAt = Date.now();
          await this.store.save(batch);
          this.publish();
        }
      }
      batch.receipt.failed = batch.entries.filter((entry) => entry.phase === "failed").length;
      if (batch.receipt.failed) {
        batch.phase = "attention";
        batch.problem =
          "Some saved files need attention. Retry them or explicitly skip them to continue.";
      } else {
        // Registered manifest batches seal on the server after verification. Bytes are
        // durably handed off now; an optional status read must not turn that into a failure.
        try {
          const status = await request<AutomaticLearningStatus>(
            `/api/classes/${batch.sessionId}/learning`,
            "GET",
          );
          batch.receipt.revision = status.revision;
          batch.receipt.confirmedRunId = status.state === "ready" ? status.run?.id : undefined;
        } catch {
          controller.signal.throwIfAborted();
        }
        batch.phase = "received";
        delete batch.problem;
      }
      await this.store.save(batch);
      this.publish();
      notifyAutomaticLearning(batch.sessionId);
    } catch (failure) {
      if (!controller.signal.aborted) {
        batch.phase = "attention";
        batch.problem =
          failure instanceof Error
            ? failure.message
            : "Your upload is saved. Retry when connected.";
        await this.store.save(batch);
        this.publish();
      }
    } finally {
      if (this.operation === controller) this.operation = null;
    }
  }
}
