import type { Recording, RecordingStore } from "./store";

export type CaptureState = {
  recording: Recording | null;
  phase:
    | "idle"
    | "starting"
    | "recording"
    | "recovering"
    | "paused"
    | "saving"
    | "saved"
    | "failed";
  error: string | null;
  accountDeletionBlocked: boolean;
};
export interface CaptureDependencies {
  getStream(): Promise<MediaStream>;
  makeRecorder(stream: MediaStream): MediaRecorder;
  clock(): number;
  segmentMs?: number;
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
type Capture = {
  recording: Recording;
  recorder: MediaRecorder;
  stream: MediaStream;
  ownsStream: boolean;
  manifestCommitted: boolean;
  startedAt: number | null;
  activeMs: number;
  lastDataAt: number;
  probeAt: number | null;
  stopSeen: boolean;
  acceptLateData: boolean;
  signalStop: (() => void) | null;
  interrupted: boolean;
  sealed: boolean;
  pending: { blob: Blob; activeMs: number }[];
  finalizing: Promise<boolean> | null;
  lateSaveTimer: ReturnType<typeof setTimeout> | null;
  lateSaving: boolean;
};

/** Each recorder run has its own container; never concatenate separate runs. */
export class RecordingController {
  state: CaptureState = {
    recording: null,
    phase: "idle",
    error: null,
    accountDeletionBlocked: false,
  };
  private listeners = new Set<() => void>();
  private capture: Capture | null = null;
  private captures: Capture[] = [];
  private queue: Promise<void> = Promise.resolve();
  private intent: "recording" | "paused" | "stopped" = "stopped";
  private session = 0;
  private completedMs = 0;
  private recovery: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private stopPromise: Promise<void> | null = null;
  private accountDeleted = false;
  private disposed = false;
  private lateCaptures = new Set<Capture>();
  private attachedSessions = new Map<string, string>();
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
  private captureElapsed(capture: Capture) {
    return (
      capture.activeMs +
      (capture.startedAt === null ? 0 : Math.max(0, this.deps.clock() - capture.startedAt))
    );
  }
  segmentElapsed() {
    return this.capture ? this.captureElapsed(this.capture) : (this.state.recording?.activeMs ?? 0);
  }
  elapsed() {
    return this.completedMs + (this.capture ? this.captureElapsed(this.capture) : 0);
  }
  private freeze(capture: Capture) {
    capture.activeMs = this.captureElapsed(capture);
    capture.startedAt = null;
  }
  private publish(capture: Capture) {
    if (
      this.capture === capture ||
      (this.intent === "stopped" && this.state.recording?.id === capture.recording.id)
    )
      this.update({ recording: capture.recording });
  }
  private releaseStream(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    }
  }
  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
  private stopMonitoring() {
    this.clearRetry();
    if (this.healthTimer !== null) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }
  private cancelled(session: number) {
    return session !== this.session || this.intent === "stopped";
  }
  private isPaused() {
    return this.intent === "paused";
  }
  async start(sessionId: string | null = null) {
    if (this.state.accountDeletionBlocked)
      throw new Error("Account deletion is in progress. Recording cannot start.");
    if (["starting", "recording", "recovering", "paused", "saving"].includes(this.state.phase))
      throw new Error("A recording is already active");
    const session = ++this.session;
    this.disposed = false;
    this.intent = "recording";
    this.completedMs = 0;
    this.captures = [];
    this.capture = null;
    this.stopPromise = null;
    this.retries = 0;
    this.recovery = null;
    this.update({ recording: null, phase: "starting", error: null });
    try {
      await this.openCapture(session, null, sessionId);
      if (!this.cancelled(session)) this.healthTimer = setInterval(() => this.checkHealth(), 1000);
      return this.state.recording?.id;
    } catch {
      if (!this.cancelled(session)) {
        this.intent = "stopped";
        this.stopMonitoring();
        if (this.capture) await this.finishCapture(this.capture, true);
        this.update({
          phase: "failed",
          error:
            "Recording could not start. Check microphone permission and local storage, or upload an audio file.",
        });
        throw new Error(this.state.error ?? "Recording could not start");
      }
      return undefined;
    }
  }
  private async openCapture(session: number, previous: Recording | null, sessionId: string | null) {
    const stream = await this.deps.getStream();
    if (this.cancelled(session) || this.isPaused()) {
      this.releaseStream(stream);
      return;
    }
    let capture: Capture | null = null;
    try {
      // Class creation can finish while microphone permission is pending.
      previous = this.captures.at(-1)?.recording ?? previous;
      sessionId = previous?.sessionId ?? sessionId;
      const recorder = this.deps.makeRecorder(stream);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const recording: Recording = {
        id,
        userId: this.userId,
        sessionId,
        captureId: previous?.captureId ?? previous?.id ?? id,
        segment: (previous?.segment ?? 0) + 1,
        creationKey: previous?.creationKey ?? crypto.randomUUID(),
        sourceAssetId: null,
        autoRegister: true,
        autoGenerate: true,
        mimeType: recorder.mimeType,
        status: this.isPaused() ? "paused" : "recording",
        activeMs: 0,
        chunks: 0,
        bytes: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.queue = this.queue.then(() => {
        recording.sessionId =
          this.attachedSessions.get(recording.captureId ?? id) ?? recording.sessionId;
        return this.store.put(recording);
      });
      await this.queue;
      if (this.cancelled(session) || this.isPaused()) {
        this.releaseStream(stream);
        await this.store.remove(this.userId, recording.id);
        return;
      }
      capture = {
        recording,
        recorder,
        stream,
        ownsStream: true,
        manifestCommitted: true,
        startedAt: null,
        activeMs: 0,
        lastDataAt: this.deps.clock(),
        probeAt: null,
        stopSeen: false,
        acceptLateData: false,
        signalStop: null,
        interrupted: false,
        sealed: false,
        pending: [],
        finalizing: null,
        lateSaveTimer: null,
        lateSaving: false,
      };
      this.capture = capture;
      this.captures.push(capture);
      this.publish(capture);
      this.bindCapture(capture, session);
      recorder.start(5000);
      capture.startedAt = this.deps.clock();
      if (this.isPaused()) {
        this.freeze(capture);
        recorder.pause();
      }
      this.retries = 0;
      this.update({ phase: this.isPaused() ? "paused" : "recording", error: null });
    } catch (failure) {
      this.queue = this.queue.catch(() => {});
      if (capture) await this.finishCapture(capture, true);
      else this.releaseStream(stream);
      throw failure;
    }
  }
  private bindCapture(capture: Capture, session: number) {
    const { recorder, stream } = capture;
    recorder.ondataavailable = (event) => {
      if (
        !event.data.size ||
        this.accountDeleted ||
        ((session !== this.session || capture.sealed) && !capture.acceptLateData)
      )
        return;
      capture.lastDataAt = this.deps.clock();
      capture.probeAt = null;
      const chunk = { blob: event.data, activeMs: this.captureElapsed(capture) };
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          if (capture.pending.length) {
            capture.pending.push(chunk);
            if (capture.sealed) this.saveLateCapture(capture);
            return;
          }
          try {
            capture.recording = await this.store.append(
              {
                ...capture.recording,
                activeMs: chunk.activeMs,
                updatedAt: new Date().toISOString(),
              },
              chunk.blob,
            );
            this.publish(capture);
          } catch {
            capture.pending.push(chunk);
            if (capture.sealed) this.saveLateCapture(capture);
            else
              this.interrupt(
                capture,
                "Audio could not be saved on this device. Retrying local storage before recording continues.",
              );
          }
        });
    };
    recorder.onstop = () => {
      const wasWaiting = capture.acceptLateData;
      capture.stopSeen = true;
      capture.acceptLateData = false;
      capture.signalStop?.();
      if (wasWaiting) this.saveLateCapture(capture);
      if (session !== this.session || capture.sealed) return;
      this.interrupt(
        capture,
        "Recording was interrupted. Saving this part and restarting automatically…",
      );
    };
    recorder.onerror = () =>
      this.interrupt(
        capture,
        "Recording was interrupted. Saving this part and restarting automatically…",
      );
    recorder.onpause = () => {
      if (this.intent === "recording")
        this.interrupt(capture, "Recording paused unexpectedly. Restarting automatically…");
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () =>
        this.interrupt(
          capture,
          "The microphone stopped. Reconnecting automatically; saved audio is safe on this device.",
        );
      track.onmute = () =>
        this.interrupt(
          capture,
          "The microphone was interrupted. Reconnecting automatically; saved audio is safe on this device.",
        );
      track.onunmute = () => this.checkHealth();
    }
  }
  private saveLateCapture(capture: Capture) {
    if (capture.lateSaving || this.disposed || this.accountDeleted) return;
    if (capture.lateSaveTimer !== null) clearTimeout(capture.lateSaveTimer);
    capture.lateSaveTimer = null;
    capture.lateSaving = true;
    this.lateCaptures.add(capture);
    const message =
      "The final audio part could not be saved. Retrying local storage automatically.";
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        try {
          while (capture.pending.length) {
            const chunk = capture.pending[0];
            if (!chunk) break;
            capture.recording = await this.store.append(
              {
                ...capture.recording,
                activeMs: capture.activeMs,
                updatedAt: new Date().toISOString(),
              },
              chunk.blob,
            );
            capture.pending.shift();
          }
          const saved = await this.store.get(this.userId, capture.recording.id);
          const manifest = {
            ...capture.recording,
            sessionId: saved?.sessionId ?? capture.recording.sessionId,
            sourceAssetId: saved?.sourceAssetId ?? capture.recording.sourceAssetId,
            awaitingFinalData: !capture.stopSeen,
            updatedAt: new Date().toISOString(),
          };
          await this.store.put(manifest);
          capture.recording = manifest;
          this.publish(capture);
          // Notify subscribers so the recoverable list refreshes after an older part changes.
          this.update({ ...(this.state.error === message ? { error: null } : {}) });
          if (capture.stopSeen) this.lateCaptures.delete(capture);
        } catch {
          this.update({ error: message });
          if (!this.disposed && !this.accountDeleted && capture.lateSaveTimer === null)
            capture.lateSaveTimer = setTimeout(() => {
              capture.lateSaveTimer = null;
              this.saveLateCapture(capture);
            }, 1000);
        } finally {
          capture.lateSaving = false;
          if (
            capture.stopSeen &&
            capture.recording.awaitingFinalData &&
            capture.lateSaveTimer === null &&
            !this.disposed &&
            !this.accountDeleted
          )
            this.saveLateCapture(capture);
        }
      });
  }
  private interrupt(capture: Capture, message: string) {
    if (this.capture !== capture || capture.sealed || this.intent === "stopped") return;
    this.freeze(capture);
    capture.interrupted = true;
    this.update({ phase: this.intent === "paused" ? "paused" : "recovering", error: message });
    void this.finishCapture(capture, true);
    if (this.intent === "recording") this.scheduleRecovery(0);
  }
  private scheduleRecovery(delay: number) {
    if (this.intent !== "recording" || this.retryTimer !== null || this.recovery) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.recover();
    }, delay);
  }
  private recover() {
    if (this.intent !== "recording" || this.recovery) return;
    const session = this.session;
    const recovery = Promise.resolve()
      .then(async () => {
        try {
          const previous = this.captures.at(-1);
          for (const part of [...this.captures]) {
            if (!part.sealed && !(await this.finishCapture(part, part.interrupted)))
              throw new Error("Local save failed");
          }
          if (session !== this.session || this.intent !== "recording") return;
          await this.openCapture(
            session,
            previous?.recording ?? null,
            previous?.recording.sessionId ?? null,
          );
        } catch {
          if (session === this.session && this.intent === "recording") {
            this.update({
              phase: "recovering",
              error:
                "Recording is interrupted. Retrying the microphone and local storage automatically. Check microphone permission and available space; you can still Stop and save.",
            });
            this.retries++;
          }
        }
      })
      .finally(() => {
        if (this.recovery !== recovery) return;
        this.recovery = null;
        if (
          session === this.session &&
          this.intent === "recording" &&
          this.state.phase === "recovering"
        )
          this.scheduleRecovery(Math.min(5000, 1000 * 2 ** Math.min(this.retries - 1, 3)));
      });
    this.recovery = recovery;
  }
  /** Also called when the page becomes active again after browser suspension. */
  checkHealth() {
    if (this.intent !== "recording") return;
    const capture = this.capture;
    if (!capture || capture.finalizing || capture.interrupted) {
      if (this.state.phase === "recovering") this.scheduleRecovery(0);
      return;
    }
    const tracks = capture.stream.getAudioTracks();
    if (
      !tracks.length ||
      tracks.some((track) => track.readyState === "ended" || track.muted) ||
      capture.recorder.state !== "recording"
    ) {
      this.interrupt(capture, "Recording was interrupted. Restarting automatically…");
      return;
    }
    if (this.captureElapsed(capture) >= (this.deps.segmentMs ?? 10 * 60 * 1000)) {
      this.rotate(capture);
      return;
    }
    // Timeslices can be delayed while the page is hidden/locked. Probe only a visible page.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const now = this.deps.clock();
    if (now - capture.lastDataAt < 20000) return;
    if (capture.probeAt === null) {
      capture.probeAt = now;
      try {
        capture.recorder.requestData();
      } catch {
        this.interrupt(capture, "Recording stopped producing audio. Restarting automatically…");
      }
    } else if (now - capture.probeAt >= 10000) {
      this.interrupt(capture, "Recording stopped producing audio. Restarting automatically…");
    }
  }
  private rotate(previous: Capture) {
    if (this.capture !== previous || this.intent !== "recording") return;
    try {
      const recorder = this.deps.makeRecorder(previous.stream);
      this.freeze(previous);
      previous.ownsStream = false;
      const now = new Date().toISOString();
      const recording: Recording = {
        ...previous.recording,
        id: crypto.randomUUID(),
        segment: (previous.recording.segment ?? 1) + 1,
        status: "recording",
        activeMs: 0,
        chunks: 0,
        bytes: 0,
        sourceAssetId: null,
        mimeType: recorder.mimeType,
        createdAt: now,
        updatedAt: now,
        awaitingFinalData: false,
        completedAt: undefined,
        syncError: null,
      };
      const capture: Capture = {
        recording,
        recorder,
        stream: previous.stream,
        ownsStream: true,
        manifestCommitted: false,
        startedAt: null,
        activeMs: 0,
        lastDataAt: this.deps.clock(),
        probeAt: null,
        stopSeen: false,
        acceptLateData: false,
        signalStop: null,
        interrupted: false,
        sealed: false,
        pending: [],
        finalizing: null,
        lateSaveTimer: null,
        lateSaving: false,
      };
      this.completedMs += previous.activeMs;
      this.capture = capture;
      this.captures.push(capture);
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          await this.store.put(recording);
          capture.manifestCommitted = true;
        })
        .catch(() => {
          this.interrupt(
            capture,
            "Audio could not be saved on this device. Retrying local storage before recording continues.",
          );
        });
      this.bindCapture(capture, this.session);
      // Release the old encoder, then immediately start the next on the same live microphone.
      // Final data and disk writes are bound to their own part and never delay the new encoder.
      previous.recorder.stop();
      const finished = this.finishCapture(previous, false);
      recorder.start(5000);
      capture.startedAt = this.deps.clock();
      this.publish(capture);
      void finished.then((saved) => {
        if (!saved && this.capture && this.intent === "recording")
          this.interrupt(
            this.capture,
            "An earlier audio part could not be saved. Retrying local storage.",
          );
      });
    } catch {
      const capture = this.capture;
      if (capture)
        this.interrupt(capture, "The next audio part could not start. Restarting automatically…");
    }
  }
  pause() {
    if (this.intent !== "recording") return;
    this.intent = "paused";
    this.clearRetry();
    const capture = this.capture;
    if (capture && !capture.interrupted && capture.recorder.state === "recording") {
      this.freeze(capture);
      capture.recording = { ...capture.recording, status: "paused" };
      try {
        capture.recorder.requestData();
        capture.recorder.pause();
      } catch {
        this.interrupt(
          capture,
          "The microphone was interrupted while paused. Resume to reconnect.",
        );
      }
    }
    this.update({ phase: "paused", recording: capture?.recording ?? this.state.recording });
  }
  resume() {
    if (this.intent !== "paused") return;
    this.intent = "recording";
    const capture = this.capture;
    if (capture && !capture.interrupted && capture.recorder.state === "paused") {
      try {
        capture.recorder.resume();
        capture.startedAt = this.deps.clock();
        capture.lastDataAt = this.deps.clock();
        capture.probeAt = null;
        capture.recording = { ...capture.recording, status: "recording" };
        this.update({ phase: "recording", recording: capture.recording, error: null });
        return;
      } catch {
        /* Reacquire below. */
      }
    }
    this.update({ phase: "recovering", error: "Reconnecting the microphone automatically…" });
    if (capture) this.interrupt(capture, "Reconnecting the microphone automatically…");
    this.scheduleRecovery(0);
  }
  async attachSession(
    sessionId: string,
    captureId = this.state.recording?.captureId ?? this.state.recording?.id,
  ) {
    if (this.state.accountDeletionBlocked)
      throw new Error("Account deletion is in progress. The recording cannot be changed.");
    if (!captureId) return;
    this.attachedSessions.set(captureId, sessionId);
    const attached = this.queue
      .catch(() => {})
      .then(async () => {
        const rows = (await this.store.list(this.userId)).filter(
          (row) => (row.captureId ?? row.id) === captureId,
        );
        for (const row of rows) {
          const capture = this.captures.find((part) => part.recording.id === row.id);
          const manifest = {
            ...(capture?.recording ?? row),
            sessionId,
            sourceAssetId: row.sourceAssetId ?? capture?.recording.sourceAssetId ?? null,
            activeMs: capture ? this.captureElapsed(capture) : row.activeMs,
            updatedAt: new Date().toISOString(),
          };
          await this.store.put(manifest);
          if (capture) {
            capture.recording = manifest;
            this.publish(capture);
          }
        }
      });
    this.queue = attached.catch(() => {});
    await attached;
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.intent === "stopped" && !this.captures.length) return this.queue;
    this.intent = "stopped";
    this.stopMonitoring();
    const capture = this.capture;
    if (capture) this.freeze(capture);
    if (capture) void this.finishCapture(capture, capture.interrupted);
    this.update({ phase: "saving" });
    this.stopPromise = Promise.resolve().then(async () => {
      const parts = [...this.captures];
      const last = parts.at(-1);
      let saved = true;
      for (const part of parts) saved = (await this.finishCapture(part, part.interrupted)) && saved;
      await this.queue.catch(() => {});
      const completedAt = new Date().toISOString();
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          for (const part of parts) {
            if (!part.sealed) continue;
            const stored = await this.store.get(this.userId, part.recording.id);
            if (!stored) continue;
            part.recording = { ...stored, completedAt };
            await this.store.put(part.recording);
            this.publish(part);
          }
        })
        .catch(() => {
          saved = false;
        });
      await this.queue;
      const hasAudio = parts.some((part) => part.recording.bytes > 0);
      if (!saved || !hasAudio) {
        this.update({
          phase: "failed",
          error: !hasAudio
            ? "No audio was saved. Check the microphone and try again."
            : "The final save failed. Recover the parts already saved on this device.",
        });
      } else {
        const exported = [...parts].reverse().find((part) => part.recording.bytes > 0) ?? last;
        this.update({
          phase: "saved",
          recording: exported?.recording ?? this.state.recording,
          error: last?.interrupted
            ? "Recording ended during an interruption. The recoverable parts are saved on this device."
            : null,
        });
      }
    });
    return this.stopPromise;
  }
  private finishCapture(capture: Capture, interrupted: boolean): Promise<boolean> {
    capture.interrupted ||= interrupted;
    if (capture.sealed) return Promise.resolve(true);
    if (capture.finalizing) return capture.finalizing;
    this.freeze(capture);
    // Defer so synchronous stop events see the finalizer already registered.
    capture.finalizing = Promise.resolve().then(async () => {
      if (!capture.stopSeen) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            capture.interrupted = true;
            capture.acceptLateData = true;
            resolve();
          }, 2000);
          capture.signalStop = () => {
            clearTimeout(timer);
            resolve();
          };
          try {
            if (capture.recorder.state !== "inactive") capture.recorder.stop();
          } catch {
            clearTimeout(timer);
            capture.interrupted = true;
            resolve();
          }
        });
        capture.signalStop = null;
      }
      if (capture.ownsStream) this.releaseStream(capture.stream);
      let saved = false;
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          try {
            if (!capture.manifestCommitted) {
              const stored = await this.store.get(this.userId, capture.recording.id);
              if (stored) capture.recording = stored;
              else await this.store.put(capture.recording);
              capture.manifestCommitted = true;
            }
            while (capture.pending.length) {
              const chunk = capture.pending[0];
              if (!chunk) break;
              capture.recording = await this.store.append(
                {
                  ...capture.recording,
                  activeMs: chunk.activeMs,
                  updatedAt: new Date().toISOString(),
                },
                chunk.blob,
              );
              capture.pending.shift();
            }
            const manifest: Recording = {
              ...capture.recording,
              activeMs: capture.activeMs,
              status: capture.interrupted || !capture.recording.bytes ? "interrupted" : "saved",
              awaitingFinalData: !capture.stopSeen,
              updatedAt: new Date().toISOString(),
            };
            await this.store.put(manifest);
            capture.recording = manifest;
            capture.sealed = true;
            this.publish(capture);
            if (this.capture === capture) {
              this.completedMs += capture.activeMs;
              this.capture = null;
            }
            saved = true;
          } catch {
            capture.finalizing = null;
          }
        });
      await this.queue;
      return saved;
    });
    return capture.finalizing;
  }
  /** Freeze gestures, then drain final saves before account-scoped device cleanup. */
  async prepareAccountDeletion(): Promise<void> {
    if (["starting", "recording", "recovering", "paused", "saving"].includes(this.state.phase))
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
    this.intent = "stopped";
    this.session++;
    this.stopMonitoring();
    this.captures = [];
    this.capture = null;
    this.attachedSessions.clear();
    for (const capture of this.lateCaptures) {
      if (capture.lateSaveTimer !== null) clearTimeout(capture.lateSaveTimer);
    }
    this.lateCaptures.clear();
    this.update({ recording: null, phase: "idle", error: null, accountDeletionBlocked: true });
  }
  dispose() {
    this.disposed = true;
    for (const capture of this.lateCaptures) {
      if (capture.lateSaveTimer !== null) clearTimeout(capture.lateSaveTimer);
      capture.lateSaveTimer = null;
    }
    if (["starting", "recording", "recovering", "paused", "saving"].includes(this.state.phase)) {
      if (this.capture) this.capture.interrupted = true;
      void this.stop();
    } else this.stopMonitoring();
  }
}
