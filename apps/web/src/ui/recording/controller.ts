import { type CaptureGap, CaptureMeter, GAP_MIN_MS, type GapCause } from "./capture-meter";
import type { MediaTimeline } from "./media-timeline";
import type { PhotoQuality, PhotoVerdict } from "./photo-quality";
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
  /** After Stop: intervals the learner meant to record for which no audio was saved. */
  missing?: MissingAudio | null;
};
export type MissingAudio = { totalMs: number; intervals: { from: string; missingMs: number }[] };
/** Gaps across a capture's parts, in time order, for the notice shown after Stop. */
export function missingAudio(parts: Recording[]): MissingAudio | null {
  const intervals = parts
    .flatMap((part) => part.gaps ?? [])
    .map((gap) => ({ from: gap.from, missingMs: gap.missingMs }))
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!intervals.length) return null;
  return { totalMs: intervals.reduce((sum, gap) => sum + gap.missingMs, 0), intervals };
}
export interface CaptureDependencies {
  getStream(): Promise<MediaStream>;
  makeRecorder(stream: MediaStream): MediaRecorder;
  /** Device time in milliseconds since the epoch; it keeps counting while the page is frozen. */
  clock(): number;
  segmentMs?: number;
  /** Reads a recorder run's container timestamps; defaults to WebM and fragmented MP4. */
  timeline?: () => MediaTimeline;
  readChunk?: (blob: Blob) => Promise<Uint8Array>;
  /** Web Locks; absent where the browser has none, and then every tab proceeds (D104). */
  locks?: CaptureLocks;
}
/** The part of Web Locks used here: one tab at a time holds a capture of this account. */
export type CaptureLocks = {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void> | undefined,
  ): Promise<unknown>;
};
/** Capture health facts without audio, text or identifiers (PRD-PRIV-06). */
export type CaptureHealthEvent =
  | { type: "started"; mime: string; part: number }
  | { type: "visibility"; visible: boolean }
  | { type: "lifecycle"; state: "frozen" | "resumed" | "throttled" }
  | { type: "wake_lock"; state: "acquired" | "released" | "unavailable" | "failed" }
  | { type: "track"; state: "muted" | "unmuted" | "ended" }
  | { type: "gap"; part: number; offsetMs: number; missingMs: number; cause: GapCause }
  | { type: "interrupted"; part: number }
  | { type: "pause"; part: number }
  /** `reconnect`: the microphone had to be opened again (a new part follows). */
  | { type: "resume"; part: number; reconnect: boolean }
  /** D104: an unfinished capture came back paused after the page was lost while in `state`. */
  | {
      type: "restored";
      parts: number;
      state: "recording" | "paused" | "sealed";
      awayMs: number;
    }
  | { type: "staged"; part: number; result: "staged" | "skipped" | "failed"; durationMs: number }
  | {
      type: "photo_quality";
      /** Random local photo id, also the photo's upload operation key; never pixels or text. */
      photoId: string;
      verdict: PhotoVerdict;
      sharpness: number;
      exposure: number;
      glare: number;
      edgeDensity: number;
    }
  /** Withdraws a not-yet-sent `photo_quality` event of a removed photo; never sent itself. */
  | { type: "photo_removed"; photoId: string }
  | {
      type: "part";
      part: number;
      mime: string;
      measured: boolean;
      mediaMs: number;
      wallMs: number;
      missingMs: number;
      gaps: number;
    };
/**
 * Recorder timeslice (PRD-REC-05, a technical setting). With STALL_MS and PROBE_MS it bounds how
 * long a visible page can show a healthy recording after audio stops: at most TIMESLICE_MS +
 * PROBE_MS, five seconds (PRD-REC-03).
 */
export const TIMESLICE_MS = 2000;
/** A chunk older than this on a visible page is overdue; the recorder is asked for data. */
const STALL_MS = 3000;
/** After asking, a recorder that still sends nothing is restarted. */
const PROBE_MS = 2000;
/** Heartbeats further apart than this mean timers were frozen or throttled. */
const HEARTBEAT_GAP_MS = 5000;
let lastTime = 0;
/** Wall time that never runs backwards within this page. */
function deviceClock() {
  lastTime = Math.max(lastTime, Date.now());
  return lastTime;
}
export function supportedMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}
/** The existing paused copy: while paused, a lost microphone waits for Resume (D104). */
const PAUSED_INTERRUPTION = "The microphone was interrupted while paused. Resume to reconnect.";
const defaults: CaptureDependencies = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  makeRecorder: (stream) => {
    const mime = supportedMime();
    return new MediaRecorder(
      stream,
      mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined,
    );
  },
  clock: deviceClock,
  locks: typeof navigator === "undefined" ? undefined : navigator.locks,
};
type Chunk = {
  blob: Blob;
  activeMs: number;
  gaps?: CaptureGap[];
  measuredBy?: "media" | "clock";
};
type Capture = {
  recording: Recording;
  recorder: MediaRecorder;
  stream: MediaStream;
  ownsStream: boolean;
  manifestCommitted: boolean;
  meter: CaptureMeter;
  /** Chunks are measured in arrival order before they are saved. */
  measuring: Promise<void>;
  activeMs: number;
  lastDataAt: number;
  /** When a chunk last added audio; chunks without audio on a visible page are a stall. */
  lastMediaAt: number;
  probeAt: number | null;
  stopSeen: boolean;
  acceptLateData: boolean;
  signalStop: (() => void) | null;
  interrupted: boolean;
  sealed: boolean;
  pending: Chunk[];
  finalizing: Promise<boolean> | null;
  lateSaveTimer: ReturnType<typeof setTimeout> | null;
  lateSaving: boolean;
};
/** A part saved by a page that is gone has no recorder or microphone left (D104). */
const RELEASED = {
  recorder: { state: "inactive" } as unknown as MediaRecorder,
  stream: { getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream,
};
const UNSEALED = new Set<Recording["status"]>(["recording", "paused"]);

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
  private recovery: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private stopPromise: Promise<void> | null = null;
  private accountDeleted = false;
  private disposed = false;
  private lateCaptures = new Set<Capture>();
  private attachedSessions = new Map<string, string>();
  private healthListeners = new Set<(event: CaptureHealthEvent) => void>();
  private lastBeat: number | null = null;
  /** When capture broke while the learner meant to record, until the next part starts. */
  private brokenAt: { at: number; cause: GapCause } | null = null;
  private hidden = false;
  private restoring: Promise<boolean> | null = null;
  /** Releases this tab's capture lock (D104); null while it is not held. */
  private lockRelease: (() => void) | null = null;
  private lockWanted = false;
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
  /** Capture health facts for diagnostics; never audio, text or identifiers. */
  onHealth = (listener: (event: CaptureHealthEvent) => void) => {
    this.healthListeners.add(listener);
    return () => {
      this.healthListeners.delete(listener);
    };
  };
  /** D60 staging outcome of one part, for diagnostics only; never shown during capture. */
  reportStaging = (part: number, result: "staged" | "skipped" | "failed", durationMs = 0) => {
    this.report({ type: "staged", part, result, durationMs });
  };
  /** On-device board photo verdict (D72), numbers only, for comparison with server outcomes. */
  reportPhotoQuality = (photoId: string, quality: Pick<PhotoQuality, "verdict" | "scores">) => {
    this.report({ type: "photo_quality", photoId, verdict: quality.verdict, ...quality.scores });
  };
  /** A board photo removed from this device takes its unsent verdict with it. */
  forgetPhotoQuality = (photoId: string) => {
    this.report({ type: "photo_removed", photoId });
  };
  private report(event: CaptureHealthEvent) {
    for (const listener of this.healthListeners) {
      try {
        listener(event);
      } catch {
        /* Diagnostics never affect capture. */
      }
    }
  }
  private update(next: Partial<CaptureState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private captureElapsed(capture: Capture) {
    return capture.meter.liveMs();
  }
  segmentElapsed() {
    return this.capture ? this.captureElapsed(this.capture) : (this.state.recording?.activeMs ?? 0);
  }
  /** Measured audio of the current part: a photo anchor that never passes the part's end. */
  anchorMs() {
    return this.capture ? this.capture.meter.mediaMs() : (this.state.recording?.activeMs ?? 0);
  }
  elapsed() {
    return this.captures.reduce(
      (sum, part) => sum + (part.sealed ? part.recording.activeMs : this.captureElapsed(part)),
      0,
    );
  }
  private freeze(capture: Capture) {
    capture.meter.halt();
    capture.activeMs = capture.meter.mediaMs();
  }
  private newMeter() {
    const meter = new CaptureMeter(this.deps.clock, this.deps.timeline?.());
    if (this.hidden) meter.note("hidden", true);
    return meter;
  }
  private publish(capture: Capture) {
    if (
      this.capture === capture ||
      ((this.intent === "stopped" || this.capture === null) &&
        this.state.recording?.id === capture.recording.id)
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
  /** While paused, a lost microphone or recorder waits for Resume; nothing restarts (D104). */
  private lostMessage(message: string) {
    return this.isPaused() ? PAUSED_INTERRUPTION : message;
  }
  async start(sessionId: string | null = null) {
    // A tap while an earlier capture is being restored waits for it (D104).
    if (this.restoring) await this.restoring;
    if (this.state.accountDeletionBlocked)
      throw new Error("Account deletion is in progress. Recording cannot start.");
    if (["starting", "recording", "recovering", "paused", "saving"].includes(this.state.phase))
      throw new Error("A recording is already active");
    const session = ++this.session;
    this.disposed = false;
    this.lastBeat = null;
    this.brokenAt = null;
    this.intent = "recording";
    this.captures = [];
    this.capture = null;
    this.stopPromise = null;
    this.retries = 0;
    this.recovery = null;
    this.update({ recording: null, phase: "starting", error: null, missing: null });
    void this.claimLock(false);
    try {
      await this.openCapture(session, null, sessionId);
      if (!this.cancelled(session)) this.healthTimer = setInterval(() => this.checkHealth(), 1000);
      return this.state.recording?.id;
    } catch {
      if (!this.cancelled(session)) {
        this.intent = "stopped";
        this.stopMonitoring();
        this.releaseLock();
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
        meter: this.newMeter(),
        measuring: Promise.resolve(),
        activeMs: 0,
        lastDataAt: this.deps.clock(),
        lastMediaAt: this.deps.clock(),
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
      recorder.start(TIMESLICE_MS);
      capture.meter.run();
      this.report({ type: "started", mime: recorder.mimeType, part: recording.segment ?? 1 });
      this.recordBrokenInterval(capture);
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
  /** The time between a broken part and this one is audio the learner did not get. */
  private recordBrokenInterval(capture: Capture) {
    const broken = this.brokenAt;
    this.brokenAt = null;
    if (!broken || this.intent !== "recording") return;
    const now = this.deps.clock();
    const gap = capture.meter.addGap({
      from: new Date(broken.at).toISOString(),
      to: new Date(now).toISOString(),
      missingMs: now - broken.at,
      cause: broken.cause,
    });
    if (gap) this.noteGap(capture, gap);
  }
  private noteGap(capture: Capture, gap: CaptureGap) {
    capture.recording = { ...capture.recording, gaps: capture.meter.gaps.map((g) => ({ ...g })) };
    this.report({
      type: "gap",
      part: capture.recording.segment ?? 1,
      offsetMs: gap.offsetMs,
      missingMs: gap.missingMs,
      cause: gap.cause,
    });
  }
  /** Measures a chunk against the device clock, in arrival order, before it is saved. */
  private measure(capture: Capture, chunk: Chunk, arrivedAt: number) {
    const read =
      this.deps.readChunk ?? (async (blob: Blob) => new Uint8Array(await blob.arrayBuffer()));
    capture.measuring = capture.measuring.then(async () => {
      let gap: CaptureGap | null = null;
      const before = capture.meter.measured ? capture.meter.mediaMs() : 0;
      try {
        gap = capture.meter.push(await read(chunk.blob), arrivedAt);
        if (gap) this.noteGap(capture, gap);
      } catch {
        /* An unreadable chunk leaves the measurement to the device clock. */
      }
      chunk.activeMs = capture.meter.mediaMs();
      // Chunks that carry no audio on a visible page are a failing capture, shown at once
      // (PRD-REC-03); a hidden page is measured and told after Stop instead.
      if (
        capture.meter.measured &&
        chunk.activeMs <= before &&
        capture.meter.running &&
        !this.pageHidden &&
        this.capture === capture &&
        this.intent === "recording" &&
        !capture.interrupted &&
        arrivedAt - capture.lastMediaAt >= STALL_MS
      ) {
        this.interrupt(
          capture,
          "Recording stopped producing audio. Restarting automatically…",
          "stalled",
        );
        return;
      }
      if (chunk.activeMs > before) capture.lastMediaAt = arrivedAt;
      chunk.gaps = capture.meter.gaps.map((gap) => ({ ...gap }));
      chunk.measuredBy = capture.meter.measured ? "media" : "clock";
      // Timers can be throttled or frozen; chunks still arrive, so rotation follows the audio.
      if (
        this.capture === capture &&
        this.intent === "recording" &&
        !capture.sealed &&
        !capture.interrupted &&
        (chunk.activeMs >= (this.deps.segmentMs ?? 10 * 60 * 1000) ||
          // A later part restarts its timestamps, so transcription never skips audio after a gap.
          gap !== null)
      )
        queueMicrotask(() => this.rotate(capture));
    });
    return capture.measuring;
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
      const arrivedAt = this.deps.clock();
      capture.lastDataAt = arrivedAt;
      capture.probeAt = null;
      const chunk: Chunk = { blob: event.data, activeMs: this.captureElapsed(capture) };
      const measured = this.measure(capture, chunk, arrivedAt);
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          await measured;
          if (capture.pending.length) {
            capture.pending.push(chunk);
            if (capture.sealed) this.saveLateCapture(capture);
            return;
          }
          try {
            capture.recording = await this.store.append(
              this.chunkManifest(capture, chunk),
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
        this.lostMessage(
          "Recording was interrupted. Saving this part and restarting automatically…",
        ),
      );
    };
    recorder.onerror = () =>
      this.interrupt(
        capture,
        this.lostMessage(
          "Recording was interrupted. Saving this part and restarting automatically…",
        ),
      );
    recorder.onpause = () => {
      if (this.intent === "recording")
        this.interrupt(capture, "Recording paused unexpectedly. Restarting automatically…");
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        capture.meter.note("ended");
        if (this.capture === capture) this.report({ type: "track", state: "ended" });
        this.interrupt(
          capture,
          this.lostMessage(
            "The microphone stopped. Reconnecting automatically; saved audio is safe on this device.",
          ),
          "ended",
        );
      };
      track.onmute = () => {
        capture.meter.note("muted");
        if (this.capture === capture) this.report({ type: "track", state: "muted" });
        this.interrupt(
          capture,
          this.lostMessage(
            "The microphone was interrupted. Reconnecting automatically; saved audio is safe on this device.",
          ),
          "muted",
        );
      };
      track.onunmute = () => {
        if (this.capture === capture) this.report({ type: "track", state: "unmuted" });
        this.checkHealth();
      };
    }
  }
  private chunkManifest(capture: Capture, chunk: Chunk): Recording {
    return {
      ...capture.recording,
      activeMs: chunk.activeMs,
      ...(chunk.measuredBy ? { measuredBy: chunk.measuredBy } : {}),
      ...(chunk.gaps?.length ? { gaps: chunk.gaps } : {}),
      updatedAt: new Date().toISOString(),
    };
  }
  /** Final comparison once the last chunk is measured; the part's duration is its audio. */
  private settle(capture: Capture) {
    const gap = capture.meter.seal();
    if (gap) this.noteGap(capture, gap);
    capture.activeMs = capture.meter.mediaMs();
    this.report({
      type: "part",
      part: capture.recording.segment ?? 1,
      mime: capture.recording.mimeType,
      measured: capture.meter.measured,
      mediaMs: Math.round(capture.activeMs),
      wallMs: Math.round(capture.meter.wallMs()),
      missingMs: Math.round(capture.meter.missingMs()),
      gaps: capture.meter.gaps.length,
    });
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
          await capture.measuring;
          while (capture.pending.length) {
            const chunk = capture.pending[0];
            if (!chunk) break;
            capture.activeMs = Math.max(capture.activeMs, chunk.activeMs);
            capture.recording = await this.store.append(
              this.chunkManifest(capture, { ...chunk, activeMs: capture.activeMs }),
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
  private interrupt(capture: Capture, message: string, cause: GapCause = "interrupted") {
    if (this.capture !== capture || capture.sealed || this.intent === "stopped") return;
    // While paused, the first interruption already seals this part and says so; the recorder's
    // own stop that follows is not a second failure and never replaces that message (D104).
    if (this.isPaused() && capture.interrupted) return;
    this.freeze(capture);
    capture.interrupted = true;
    if (this.intent === "recording")
      this.brokenAt ??= {
        at: this.deps.clock(),
        cause: this.hidden && cause === "interrupted" ? "hidden" : cause,
      };
    this.report({ type: "interrupted", part: capture.recording.segment ?? 1 });
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
  private get pageHidden() {
    return (
      this.hidden || (typeof document !== "undefined" && document.visibilityState === "hidden")
    );
  }
  /** Ask the recorder for its buffered audio; data, or its absence, shows the real state. */
  private probe(capture: Capture, now: number) {
    capture.probeAt = now;
    try {
      capture.recorder.requestData();
    } catch {
      this.interrupt(
        capture,
        "Recording stopped producing audio. Restarting automatically…",
        "stalled",
      );
    }
  }
  /** Page lifecycle facts from the shell (visibility, freeze/resume, wake lock). */
  observe(
    event:
      | { type: "visibility"; visible: boolean }
      | { type: "lifecycle"; state: "frozen" | "resumed" }
      | { type: "wake_lock"; state: "acquired" | "released" | "unavailable" | "failed" },
  ) {
    if (event.type === "visibility") {
      if (this.hidden === !event.visible) return;
      this.hidden = !event.visible;
      for (const part of this.captures) if (!part.sealed) part.meter.note("hidden", this.hidden);
    } else if (event.type === "lifecycle") {
      for (const part of this.captures) if (!part.sealed) part.meter.note("frozen");
    }
    if (this.intent !== "stopped") this.report(event);
    if (event.type !== "wake_lock")
      this.checkHealth(
        (event.type === "visibility" && event.visible) ||
          (event.type === "lifecycle" && event.state === "resumed"),
      );
  }
  /** Also called when the page becomes active again after browser suspension. */
  checkHealth(woke = false) {
    const now = this.deps.clock();
    const beat = this.lastBeat;
    this.lastBeat = now;
    if (this.intent !== "recording") return;
    const capture = this.capture;
    // Timers were frozen or throttled: whatever happened meanwhile is unknown until data arrives.
    const throttled = beat !== null && now - beat > HEARTBEAT_GAP_MS;
    const resumed = woke || throttled;
    if (throttled && capture) {
      capture.meter.note("frozen");
      this.report({ type: "lifecycle", state: "throttled" });
    }
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
      const ended = tracks.some((track) => track.readyState === "ended");
      const muted = tracks.some((track) => track.muted);
      this.interrupt(
        capture,
        "Recording was interrupted. Restarting automatically…",
        ended ? "ended" : muted ? "muted" : "interrupted",
      );
      return;
    }
    if (this.captureElapsed(capture) >= (this.deps.segmentMs ?? 10 * 60 * 1000)) {
      this.rotate(capture);
      return;
    }
    const silent = now - capture.lastDataAt;
    // Timeslices can be delayed while the page is hidden/locked. Never restart a hidden page,
    // but flush what the recorder holds so a gap is measured as soon as possible.
    if (this.pageHidden) {
      if (resumed && capture.probeAt === null) {
        try {
          capture.recorder.requestData();
        } catch {
          /* Checked again when the page is visible. */
        }
      }
      capture.probeAt = null;
      return;
    }
    // A visible page never shows a healthy recording for long without audio (PRD-REC-03).
    if (capture.probeAt === null) {
      if (silent >= STALL_MS || (resumed && silent >= 1000)) this.probe(capture, now);
    } else if (now - capture.probeAt >= PROBE_MS) {
      this.interrupt(
        capture,
        "Recording stopped producing audio. Restarting automatically…",
        "stalled",
      );
    }
  }
  private rotate(previous: Capture) {
    if (this.capture !== previous || this.intent !== "recording") return;
    try {
      const recorder = this.deps.makeRecorder(previous.stream);
      this.freeze(previous);
      previous.ownsStream = false;
      const now = new Date().toISOString();
      const { gaps: _gaps, measuredBy: _measuredBy, ...kept } = previous.recording;
      const recording: Recording = {
        ...kept,
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
        meter: this.newMeter(),
        measuring: Promise.resolve(),
        activeMs: 0,
        lastDataAt: this.deps.clock(),
        lastMediaAt: this.deps.clock(),
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
      recorder.start(TIMESLICE_MS);
      capture.meter.run();
      this.report({ type: "started", mime: recorder.mimeType, part: recording.segment ?? 1 });
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
    // Paused time is the learner's choice, not missing audio.
    this.brokenAt = null;
    this.clearRetry();
    const capture = this.capture;
    this.report({ type: "pause", part: this.lastPart() });
    if (capture && !capture.interrupted && capture.recorder.state === "recording") {
      this.freeze(capture);
      capture.recording = { ...capture.recording, status: "paused" };
      try {
        capture.recorder.requestData();
        capture.recorder.pause();
      } catch {
        this.interrupt(capture, PAUSED_INTERRUPTION);
      }
    }
    // A Pause during recovery has no live recorder to pause: nothing reconnects until Resume, so
    // the recovering text gives way to the honest paused one (D104).
    this.update({
      phase: "paused",
      recording: capture?.recording ?? this.state.recording,
      ...(!capture || capture.interrupted ? { error: PAUSED_INTERRUPTION } : {}),
    });
  }
  resume() {
    if (this.intent !== "paused") return;
    this.intent = "recording";
    const capture = this.capture;
    const part = this.lastPart();
    if (capture && !capture.interrupted && capture.recorder.state === "paused") {
      try {
        capture.recorder.resume();
        capture.meter.run();
        capture.lastDataAt = this.deps.clock();
        capture.lastMediaAt = this.deps.clock();
        capture.probeAt = null;
        capture.recording = { ...capture.recording, status: "recording" };
        this.report({ type: "resume", part, reconnect: false });
        this.update({ phase: "recording", recording: capture.recording, error: null });
        return;
      } catch {
        /* Reacquire below. */
      }
    }
    // A sealed or restored part stays as it is; the same capture continues as its next part.
    this.report({ type: "resume", part, reconnect: true });
    this.update({ phase: "recovering", error: "Reconnecting the microphone automatically…" });
    if (capture) this.interrupt(capture, "Reconnecting the microphone automatically…");
    this.scheduleRecovery(0);
  }
  /** The part a pause or Resume applies to, for diagnostics. */
  private lastPart() {
    return (this.capture ?? this.captures.at(-1))?.recording.segment ?? 1;
  }
  /**
   * D104: after a reload or a discarded page, the newest unfinished capture of this account comes
   * back paused, never recording, and with no time limit. A part the lost page left open is
   * sealed as interrupted with the audio it saved. Resume continues the same capture and session
   * as its next part; Stop completes every part. Only the tab holding the capture lock restores.
   */
  restore(): Promise<boolean> {
    if (this.state.phase === "idle") this.disposed = false;
    this.restoring ??= this.reopen()
      .catch(() => false)
      .finally(() => {
        this.restoring = null;
      });
    return this.restoring;
  }
  private async reopen(): Promise<boolean> {
    // A capture of this tab, or one still saving, keeps its own lock.
    if (this.state.phase !== "idle" || this.state.accountDeletionBlocked) return false;
    let restored = false;
    try {
      if (!(await this.claimLock(true))) return false;
      const rows = await this.store.list(this.userId);
      const newest = rows
        .filter((row) => row.autoRegister && !row.completedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!newest) return false;
      const captureId = newest.captureId ?? newest.id;
      const siblings = rows
        .filter((row) => (row.captureId ?? row.id) === captureId)
        .sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
      const open = siblings.filter((row) => UNSEALED.has(row.status)).at(-1);
      const lastSaved = siblings.reduce((at, row) => Math.max(at, Date.parse(row.updatedAt)), 0);
      const parts: Recording[] = [];
      for (const row of siblings) {
        const sealed = await this.store.seal(this.userId, row.id);
        if (sealed) parts.push(sealed);
      }
      if (!parts.length || this.disposed || this.accountDeleted || this.state.phase !== "idle")
        return false;
      // Stop was already recorded on part of it: the page went during the final save.
      const completedAt = parts.find((part) => part.completedAt)?.completedAt;
      if (completedAt) {
        for (const part of parts)
          if (!part.completedAt) await this.store.put({ ...part, completedAt });
        return false;
      }
      const sessionId = parts.find((part) => part.sessionId)?.sessionId ?? null;
      for (const [index, part] of parts.entries())
        if (sessionId && !part.sessionId)
          parts[index] =
            (await this.store.updateRegistration(this.userId, part.id, { sessionId })) ?? part;
      const last = parts.at(-1);
      if (!last || this.disposed || this.accountDeleted || this.state.phase !== "idle")
        return false;
      this.session++;
      this.intent = "paused";
      this.lastBeat = null;
      this.brokenAt = null;
      this.retries = 0;
      this.recovery = null;
      this.stopPromise = null;
      this.capture = null;
      this.captures = parts.map((part) => this.restoredPart(part));
      if (sessionId) this.attachedSessions.set(captureId, sessionId);
      this.healthTimer ??= setInterval(() => this.checkHealth(), 1000);
      this.report({
        type: "restored",
        parts: parts.length,
        state: open?.status === "recording" ? "recording" : open ? "paused" : "sealed",
        awayMs: Math.round(Math.min(24 * 60 * 60 * 1000, Math.max(0, Date.now() - lastSaved))),
      });
      this.update({ recording: last, phase: "paused", error: PAUSED_INTERRUPTION, missing: null });
      restored = true;
      return true;
    } finally {
      if (!restored) this.releaseLock();
    }
  }
  private restoredPart(recording: Recording): Capture {
    const now = this.deps.clock();
    return {
      recording,
      ...RELEASED,
      ownsStream: false,
      manifestCommitted: true,
      meter: this.newMeter(),
      measuring: Promise.resolve(),
      activeMs: recording.activeMs,
      lastDataAt: now,
      lastMediaAt: now,
      probeAt: null,
      stopSeen: true,
      acceptLateData: false,
      signalStop: null,
      interrupted: recording.status === "interrupted",
      sealed: true,
      pending: [],
      finalizing: null,
      lateSaveTimer: null,
      lateSaving: false,
    };
  }
  /**
   * D104: a tab holds this account's capture lock while it has a capture, so no other tab
   * restores (and seals) a capture that is still live there. `ifAvailable` gives up at once.
   */
  private claimLock(ifAvailable: boolean): Promise<boolean> {
    this.lockWanted = true;
    const locks = this.deps.locks;
    if (!locks || this.lockRelease) return Promise.resolve(true);
    return new Promise<boolean>((granted) => {
      Promise.resolve()
        .then(() =>
          locks.request(`recalino-capture:${this.userId}`, { ifAvailable }, (lock) => {
            // Another tab holds it, the capture already ended, or an earlier request holds it.
            if (!lock || !this.lockWanted || this.lockRelease) {
              granted(this.lockRelease !== null);
              return undefined;
            }
            return new Promise<void>((release) => {
              this.lockRelease = release;
              granted(true);
            });
          }),
        )
        .catch(() => granted(false));
    });
  }
  private releaseLock() {
    this.lockWanted = false;
    this.lockRelease?.();
    this.lockRelease = null;
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
            // A sealed part keeps its saved duration; a restored one has no meter of its own.
            activeMs: capture && !capture.sealed ? this.captureElapsed(capture) : row.activeMs,
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
    // Audio missing from a break until Stop belongs to the last part.
    const broken = this.intent === "recording" ? this.brokenAt : null;
    const stoppedAt = this.deps.clock();
    this.brokenAt = null;
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
            const trailing =
              part === last && broken && stoppedAt - broken.at >= GAP_MIN_MS
                ? [
                    {
                      from: new Date(broken.at).toISOString(),
                      to: new Date(stoppedAt).toISOString(),
                      offsetMs: Math.round(stored.activeMs),
                      missingMs: Math.round(stoppedAt - broken.at),
                      cause: broken.cause,
                    },
                  ]
                : [];
            const gaps = [...(stored.gaps ?? []), ...trailing];
            part.recording = { ...stored, completedAt, ...(gaps.length ? { gaps } : {}) };
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
          missing: missingAudio(parts.map((part) => part.recording)),
          error: last?.interrupted
            ? "Recording ended during an interruption. The recoverable parts are saved on this device."
            : null,
        });
      }
      this.releaseLock();
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
            await capture.measuring;
            while (capture.pending.length) {
              const chunk = capture.pending[0];
              if (!chunk) break;
              capture.recording = await this.store.append(
                this.chunkManifest(capture, chunk),
                chunk.blob,
              );
              capture.pending.shift();
            }
            if (!capture.sealed) this.settle(capture);
            const manifest: Recording = {
              ...capture.recording,
              activeMs: capture.activeMs,
              measuredBy: capture.meter.measured ? "media" : "clock",
              ...(capture.meter.gaps.length
                ? { gaps: capture.meter.gaps.map((gap) => ({ ...gap })) }
                : {}),
              status: capture.interrupted || !capture.recording.bytes ? "interrupted" : "saved",
              awaitingFinalData: !capture.stopSeen,
              updatedAt: new Date().toISOString(),
            };
            await this.store.put(manifest);
            capture.recording = manifest;
            capture.sealed = true;
            this.publish(capture);
            if (this.capture === capture) this.capture = null;
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
    this.releaseLock();
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
