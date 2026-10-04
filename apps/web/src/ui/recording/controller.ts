import type { Recording, RecordingStore } from "./store";

export type CaptureState = {
  recording: Recording | null;
  phase: "idle" | "starting" | "recording" | "paused" | "saving" | "saved" | "failed";
  error: string | null;
  accountDeletionBlocked: boolean;
};
export interface CaptureDependencies {
  getStream(): Promise<MediaStream>;
  makeRecorder(stream: MediaStream): MediaRecorder;
  clock(): number;
}
export function supportedMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}
const defaults: CaptureDependencies = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  makeRecorder: (stream) => {
    const mime = supportedMime();
    return new MediaRecorder(
      stream,
      mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined,
    );
  },
  clock: () => performance.now(),
};

/** Starts from a user gesture and persists chunks while the network is unavailable (REC/D32). */
export class RecordingController {
  state: CaptureState = {
    recording: null,
    phase: "idle",
    error: null,
    accountDeletionBlocked: false,
  };
  private listeners = new Set<() => void>();
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private queue: Promise<void> = Promise.resolve();
  private activeStarted = 0;
  private activeElapsed = 0;
  private persistenceFailed = false;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private accountDeleted = false;
  constructor(
    readonly userId: string,
    readonly store: RecordingStore,
    private deps = defaults,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(next: Partial<CaptureState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  elapsed() {
    return (
      this.activeElapsed +
      (this.state.phase === "recording" ? Math.max(0, this.deps.clock() - this.activeStarted) : 0)
    );
  }
  async start(sessionId: string | null = null) {
    if (this.state.accountDeletionBlocked)
      throw new Error("Account deletion is in progress. Recording cannot start.");
    if (["starting", "recording", "paused", "saving"].includes(this.state.phase))
      throw new Error("A recording is already active");
    this.update({ phase: "starting", error: null });
    this.persistenceFailed = false;
    this.activeElapsed = 0;
    this.stopPromise = null;
    try {
      this.stream = await this.deps.getStream();
      this.recorder = this.deps.makeRecorder(this.stream);
      const now = new Date().toISOString();
      const recording: Recording = {
        id: crypto.randomUUID(),
        userId: this.userId,
        sessionId,
        creationKey: crypto.randomUUID(),
        sourceAssetId: null,
        mimeType: this.recorder.mimeType,
        status: "recording",
        activeMs: 0,
        chunks: 0,
        bytes: 0,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.put(recording);
      this.update({ recording });
      this.stopPromise = new Promise((resolve) => {
        this.resolveStop = resolve;
      });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const activeMs = this.elapsed();
        this.queue = this.queue
          .then(async () => {
            if (!this.state.recording) return;
            const saved = await this.store.append(
              { ...this.state.recording, activeMs, updatedAt: new Date().toISOString() },
              event.data,
            );
            this.update({ recording: saved });
          })
          .catch(() => {
            this.persistenceFailed = true;
            this.fail(
              "The latest audio could not be saved on this device. Stop and save the recoverable parts.",
            );
          });
      };
      this.recorder.onstop = () => {
        void this.finalize();
      };
      this.recorder.onerror = () =>
        this.fail("Recording stopped unexpectedly. The saved parts are still on this device.");
      for (const track of this.stream.getAudioTracks()) {
        track.onended = () =>
          this.fail("The microphone stopped. Check permission and save the recoverable parts.");
        track.onmute = () =>
          this.fail(
            "The microphone was interrupted. Recording stopped; check and export the saved parts.",
          );
      }
      this.activeStarted = this.deps.clock();
      this.recorder.start(5000);
      this.update({ phase: "recording" });
      return recording.id;
    } catch {
      this.cleanup();
      this.resolveStop?.();
      this.resolveStop = null;
      this.stopPromise = null;
      this.update({
        phase: "failed",
        error:
          "Recording could not start. Check microphone permission and local storage, or upload an audio file.",
      });
      throw new Error(this.state.error ?? "Recording could not start");
    }
  }
  pause() {
    if (this.state.phase !== "recording" || !this.recorder) return;
    this.activeElapsed = this.elapsed();
    this.recorder.requestData();
    this.recorder.pause();
    this.update({
      phase: "paused",
      recording: this.state.recording ? { ...this.state.recording, status: "paused" } : null,
    });
  }
  resume() {
    if (this.state.phase !== "paused" || !this.recorder) return;
    this.recorder.resume();
    this.activeStarted = this.deps.clock();
    this.update({
      phase: "recording",
      recording: this.state.recording ? { ...this.state.recording, status: "recording" } : null,
    });
  }
  async attachSession(sessionId: string) {
    if (this.state.accountDeletionBlocked)
      throw new Error("Account deletion is in progress. The recording cannot be changed.");
    this.queue = this.queue.then(async () => {
      if (!this.state.recording) return;
      const manifest = {
        ...this.state.recording,
        sessionId,
        activeMs: this.elapsed(),
        updatedAt: new Date().toISOString(),
      };
      await this.store.put(manifest);
      this.update({ recording: manifest });
    });
    await this.queue;
  }
  stop(): Promise<void> {
    if (!this.recorder || this.recorder.state === "inactive") return this.stopPromise ?? this.queue;
    this.activeElapsed = this.elapsed();
    this.update({ phase: "saving" });
    this.recorder.stop();
    return this.stopPromise ?? this.queue;
  }
  /** Freeze new gestures/attachments, then drain late final saves before device cleanup. */
  async prepareAccountDeletion(): Promise<void> {
    if (["starting", "recording", "paused", "saving"].includes(this.state.phase))
      throw new Error("Stop and save your active recording before deleting the account.");
    this.update({ accountDeletionBlocked: true });
    await this.stop();
    await this.queue.catch(() => {});
  }
  releaseAccountDeletion(): void {
    if (!this.accountDeleted) this.update({ accountDeletionBlocked: false });
  }
  completeAccountDeletion(): void {
    this.accountDeleted = true;
    this.update({ recording: null, phase: "idle", error: null, accountDeletionBlocked: true });
  }
  private fail(message: string) {
    this.activeElapsed = this.elapsed();
    this.update({ phase: "failed", error: message });
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }
  private async finalize() {
    await this.queue.catch(() => {
      this.persistenceFailed = true;
    });
    this.cleanup();
    if (this.state.recording) {
      const interrupted =
        this.persistenceFailed || this.state.phase === "failed" || this.state.recording.bytes === 0;
      const next: Recording = {
        ...this.state.recording,
        activeMs: this.activeElapsed,
        status: interrupted ? "interrupted" : "saved",
        updatedAt: new Date().toISOString(),
      };
      try {
        await this.store.put(next);
        this.update({
          recording: next,
          phase: interrupted ? "failed" : "saved",
          ...(next.bytes === 0
            ? { error: "No audio was saved. Check the microphone and try again." }
            : {}),
        });
      } catch {
        this.update({
          phase: "failed",
          error: "The final save failed. Recover the parts already saved on this device.",
        });
      }
    }
    this.resolveStop?.();
    this.resolveStop = null;
  }
  private cleanup() {
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.onmute = null;
      track.stop();
    }
    this.stream = null;
    this.recorder = null;
  }
  dispose() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.activeElapsed = this.elapsed();
      this.update({ phase: "failed", error: "Recording was interrupted." });
      this.recorder.stop();
    } else this.cleanup();
  }
}
