import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import type { RecordingStore } from "../recording/store";
import { WorkspaceRequestError, workspaceRequest } from "./api";
import { uploadAutomaticAudio } from "./automatic-learning";
import type { ManualAudioStore, ManualAudioTransfer } from "./manual-audio-store";
import { isRetryableUploadFailure } from "./upload";

type RunRead = { run: ProcessingRun; snapshot: RunSnapshot | null };
/** Lifetime belongs to the application layout. A page merely persists an already-confirmed run. */
export class ManualAudioManager {
  private entries: ManualAudioTransfer[] = [];
  private view: ManualAudioTransfer[] = [];
  private listeners = new Set<() => void>();
  private running = false;
  private stopped = false;
  private operation: AbortController | null = null;
  private activeRunId: string | null = null;
  private removed = new Set<string>();
  private revision = 0;
  constructor(
    readonly userId: string,
    private store: ManualAudioStore,
    private recordings: RecordingStore,
    private deps: {
      request?: typeof workspaceRequest;
      upload?: typeof uploadAutomaticAudio;
      allowed?: () => boolean;
      lock?: (name: string, effect: () => Promise<void>) => Promise<void>;
      changed?: (sessionId: string) => void;
      failed?: (failure: unknown) => void;
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
    this.view = this.entries.map((entry) => ({ ...entry }));
    for (const listener of this.listeners) listener();
  }
  private allowed() {
    return !this.stopped && (this.deps.allowed?.() ?? true);
  }
  private async patch(entry: ManualAudioTransfer, patch: Partial<ManualAudioTransfer>) {
    if (this.removed.has(entry.runId)) return;
    Object.assign(entry, patch);
    await this.store.put(entry);
    if (this.removed.has(entry.runId)) return;
    this.entries = this.entries.map((item) => (item.runId === entry.runId ? entry : item));
    this.publish();
  }
  async restore() {
    const revision = ++this.revision;
    const saved = await this.store.list(this.userId);
    if (revision !== this.revision) return;
    this.entries = saved.sort((a, b) => a.createdAt - b.createdAt);
    this.publish();
  }
  async enqueue(run: ProcessingRun, snapshot: RunSnapshot, contract: InputContract) {
    if (
      run.state !== "awaiting_upload" ||
      !snapshot.sources.some((source) => source.kind === "audio")
    )
      return;
    ++this.revision;
    const prior = this.entries.find((entry) => entry.runId === run.id);
    const entry: ManualAudioTransfer = prior
      ? { ...prior, phase: "queued", problem: null }
      : {
          userId: this.userId,
          runId: run.id,
          sessionId: run.sessionId,
          contract,
          createdAt: Date.now(),
          phase: "queued",
          message: "Audio upload is saved. You can use other pages while it continues.",
          problem: null,
        };
    // Navigation is safe only after this transaction commits; no new processing run is created.
    const saved = await this.store.put(entry, true);
    this.entries = [...this.entries.filter((item) => item.runId !== entry.runId), saved];
    this.publish();
    void this.kick().catch((failure) => this.deps.failed?.(failure));
  }
  async retry(runId: string) {
    const entry = this.entries.find((item) => item.runId === runId);
    if (!entry) return;
    const change = async () => {
      if (!this.allowed() || this.removed.has(runId)) return;
      const latest = await this.store.get(this.userId, runId);
      if (!latest) {
        this.entries = this.entries.filter((item) => item.runId !== runId);
        this.publish();
        return;
      }
      if (latest.phase === "attention")
        await this.patch(latest, { phase: "queued", problem: null });
    };
    if (this.deps.lock)
      await this.deps.lock(`recalino-learning:${this.userId}:${entry.sessionId}`, change);
    else await change();
    await this.kick();
  }
  async forget(runId: string) {
    this.removed.add(runId);
    if (this.activeRunId === runId && this.operation) this.operation.abort();
    await this.store.remove(this.userId, runId);
    this.entries = this.entries.filter((entry) => entry.runId !== runId);
    this.publish();
  }
  async cancel(runId: string): Promise<ProcessingRun> {
    const canceled = await (this.deps.request ?? workspaceRequest)<ProcessingRun>(
      `/api/runs/${runId}`,
      "DELETE",
    );
    // A failed/lost acknowledgement leaves the existing durable upload eligible for recovery.
    await this.forget(runId);
    return canceled;
  }
  pause() {
    this.stopped = true;
    this.operation?.abort(new DOMException("Audio upload paused", "AbortError"));
  }
  resume() {
    this.stopped = false;
  }
  async kick() {
    if (this.running || !this.allowed()) return;
    this.running = true;
    try {
      for (const candidate of [...this.entries]) {
        if (!this.allowed()) break;
        const work = async () => {
          if (!this.allowed() || this.removed.has(candidate.runId)) return;
          const entry = await this.store.get(this.userId, candidate.runId);
          if (!entry) {
            this.entries = this.entries.filter((item) => item.runId !== candidate.runId);
            this.publish();
            return;
          }
          if (!this.allowed() || this.removed.has(candidate.runId)) return;
          this.entries = this.entries.map((item) => (item.runId === entry.runId ? entry : item));
          this.publish();
          const operation = new AbortController();
          this.operation = operation;
          this.activeRunId = entry.runId;
          const check = () => {
            operation.signal.throwIfAborted();
            if (!this.allowed() || this.removed.has(entry.runId))
              throw new DOMException("Audio upload paused", "AbortError");
          };
          const request = this.deps.request ?? workspaceRequest;
          try {
            check();
            // An earlier tab may already have activated/cancelled it. Never substitute today's selection.
            const current = await request<RunRead>(
              `/api/runs/${entry.runId}?includeSnapshot=1`,
              "GET",
              undefined,
              undefined,
              { signal: operation.signal },
            );
            check();
            if (current.run.id !== entry.runId || current.run.sessionId !== entry.sessionId)
              throw new Error("The confirmed session identity has changed.");
            if (current.run.state !== "awaiting_upload") {
              await this.forget(entry.runId);
              this.deps.changed?.(entry.sessionId);
              return;
            }
            if (entry.phase === "attention") return;
            if (!current.snapshot)
              throw new Error(
                "The confirmed audio selection is unavailable. Open processing and review it.",
              );
            if (entry.phase !== "verifying") {
              await this.patch(entry, { phase: "uploading", problem: null });
              await (this.deps.upload ?? uploadAutomaticAudio)(
                current.run,
                current.snapshot,
                entry.contract,
                {
                  userId: this.userId,
                  store: this.recordings,
                  signal: operation.signal,
                  checkAllowed: check,
                  request,
                  onProgress: (message) => {
                    if (
                      operation.signal.aborted ||
                      this.removed.has(entry.runId) ||
                      !this.allowed()
                    )
                      return;
                    entry.message = message;
                    this.publish();
                  },
                },
              );
              check();
              await this.patch(entry, {
                phase: "verifying",
                message: "Audio uploaded. Verification and processing continue on the server.",
                problem: null,
              });
            }
            // Reuse the existing activation operation if a verifier's wake-up was interrupted.
            try {
              const activated = await request<ProcessingRun>(
                `/api/runs/${entry.runId}`,
                "POST",
                { action: "activate" },
                undefined,
                { signal: operation.signal },
              );
              check();
              if (activated.state !== "awaiting_upload") {
                await this.forget(entry.runId);
                this.deps.changed?.(entry.sessionId);
              }
            } catch (error) {
              if (
                !(
                  error instanceof WorkspaceRequestError &&
                  error.fields?.upload?.includes("incomplete")
                )
              )
                throw error;
            }
          } catch (error) {
            if (error instanceof WorkspaceRequestError && error.code === "not_found") {
              await this.forget(entry.runId);
              return;
            }
            if (
              operation.signal.aborted ||
              (error instanceof DOMException && error.name === "AbortError")
            ) {
              if (this.entries.some((item) => item.runId === entry.runId))
                await this.patch(entry, {
                  phase: entry.phase === "verifying" ? "verifying" : "queued",
                }).catch((failure) => this.deps.failed?.(failure));
            } else {
              if (
                this.removed.has(entry.runId) ||
                !(await this.store.get(this.userId, entry.runId))
              ) {
                this.entries = this.entries.filter((item) => item.runId !== entry.runId);
                this.publish();
                return;
              }
              await this.patch(entry, {
                phase: isRetryableUploadFailure(error)
                  ? entry.phase === "verifying"
                    ? "verifying"
                    : "queued"
                  : "attention",
                problem:
                  error instanceof Error
                    ? error.message
                    : "The saved audio needs attention. Open processing or retry.",
              });
            }
          } finally {
            if (this.operation === operation) {
              this.operation = null;
              this.activeRunId = null;
            }
          }
        };
        if (this.deps.lock)
          await this.deps.lock(`recalino-learning:${this.userId}:${candidate.sessionId}`, work);
        else await work();
      }
    } finally {
      this.running = false;
    }
  }
}
