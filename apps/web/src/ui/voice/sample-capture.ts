import { supportedMime } from "../recording/controller";

export const VOICE_SAMPLE_MIN_MS = 20_000;
export const VOICE_SAMPLE_MAX_MS = 30_000;
export const VOICE_SAMPLE_MAX_BYTES = 2_000_000;
export interface VoiceSample {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}
export interface VoiceCaptureState {
  phase: "idle" | "requesting" | "recording" | "ready" | "failed";
  elapsedMs: number;
  sample: VoiceSample | null;
  error: string | null;
}
interface Dependencies {
  getStream(): Promise<MediaStream>;
  recorder(stream: MediaStream): MediaRecorder;
  now(): number;
}
const defaults: Dependencies = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  recorder: (stream) => {
    const mimeType = supportedMime();
    return new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 64000,
    });
  },
  now: () => performance.now(),
};

/** A memory-only sample. It never enters the class recording store or creates a class. */
export class VoiceSampleCapture {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private limit: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  constructor(
    private changed: (state: VoiceCaptureState) => void,
    private deps: Dependencies = defaults,
  ) {}
  private stopTracks() {
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    if (this.timer) clearInterval(this.timer);
    if (this.limit) clearTimeout(this.limit);
    this.timer = null;
    this.limit = null;
  }
  cancel() {
    this.generation++;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.stopTracks();
  }
  async start(isBlocked: () => boolean = () => false) {
    this.cancel();
    const generation = this.generation;
    this.changed({ phase: "requesting", elapsedMs: 0, sample: null, error: null });
    try {
      if (isBlocked())
        throw new Error("Finish your class recording before recording a voice sample.");
      const stream = await this.deps.getStream();
      if (generation !== this.generation || isBlocked()) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        if (generation === this.generation) throw new Error("Finish your class recording first.");
        return;
      }
      this.stream = stream;
      const recorder = this.deps.recorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.cancel();
        this.changed({
          phase: "failed",
          elapsedMs: 0,
          sample: null,
          error: "The microphone recording was interrupted. Please record again.",
        });
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        const durationMs = Math.min(VOICE_SAMPLE_MAX_MS, this.deps.now() - this.startedAt);
        this.stopTracks();
        this.recorder = null;
        const mimeType =
          recorder.mimeType.split(";")[0] || chunks[0]?.type.split(";")[0] || "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });
        const error = !blob.size
          ? "No audio was captured. Please record again."
          : blob.size > VOICE_SAMPLE_MAX_BYTES
            ? "This sample is too large. Please record again."
            : durationMs < VOICE_SAMPLE_MIN_MS
              ? "Record at least 20 seconds so there is enough of your voice to compare."
              : null;
        this.changed({
          phase: error ? "failed" : "ready",
          elapsedMs: durationMs,
          sample: error ? null : { blob, durationMs, mimeType },
          error,
        });
      };
      this.startedAt = this.deps.now();
      recorder.start();
      this.changed({ phase: "recording", elapsedMs: 0, sample: null, error: null });
      this.timer = setInterval(() => {
        if (generation !== this.generation) return;
        this.changed({
          phase: "recording",
          elapsedMs: Math.min(VOICE_SAMPLE_MAX_MS, this.deps.now() - this.startedAt),
          sample: null,
          error: null,
        });
      }, 250);
      this.limit = setTimeout(() => this.stop(), VOICE_SAMPLE_MAX_MS);
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      const message =
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone access was not allowed. You can try again or enable voice confirmation without a sample."
          : error instanceof Error
            ? error.message
            : "The microphone could not start.";
      this.changed({ phase: "failed", elapsedMs: 0, sample: null, error: message });
    }
  }
  stop() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stopTracks();
  }
}

export function sampleBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The sample could not be read. Please record again."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
