import { afterEach, describe, expect, it, vi } from "vitest";
import { type VoiceCaptureState, VoiceSampleCapture } from "./sample-capture";

function fixture(getStream?: () => Promise<MediaStream>) {
  let now = 0;
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const states: VoiceCaptureState[] = [];
  const recorder = {
    mimeType: "audio/webm;codecs=opus",
    state: "inactive",
    ondataavailable: null as null | ((event: { data: Blob }) => void),
    onstop: null as null | (() => void),
    onerror: null as null | (() => void),
    start() {
      this.state = "recording";
    },
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
      this.onstop?.();
    },
  };
  const requestStream = vi.fn(getStream ?? (async () => stream));
  const capture = new VoiceSampleCapture((state) => states.push(state), {
    getStream: requestStream,
    recorder: () => recorder as unknown as MediaRecorder,
    now: () => now,
  });
  return {
    capture,
    track,
    stream,
    states,
    recorder,
    requestStream,
    clock: (ms: number) => {
      now = ms;
    },
  };
}

afterEach(() => vi.useRealTimers());
describe("optional voice sample capture", () => {
  it("does not touch the microphone until started, caps a sample at 30 seconds, and normalizes MIME", async () => {
    vi.useFakeTimers();
    const f = fixture();
    expect(f.requestStream).not.toHaveBeenCalled();
    await f.capture.start();
    f.clock(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.states.at(-1)).toMatchObject({
      phase: "ready",
      sample: { durationMs: 30_000, mimeType: "audio/webm" },
    });
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.recorder.state).toBe("inactive");
  });
  it("discards an underlength sample and releases the microphone", async () => {
    const f = fixture();
    await f.capture.start();
    f.clock(10_000);
    f.capture.stop();
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", sample: null });
    expect(f.track.stop).toHaveBeenCalledTimes(1);
  });
  it("releases a microphone granted after cancel without publishing a sample", async () => {
    let grant: (stream: MediaStream) => void = () => {};
    const f = fixture(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const started = f.capture.start();
    f.capture.cancel();
    grant(f.stream);
    await started;
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.states.map((state) => state.phase)).toEqual(["requesting"]);
  });
  it("does not capture over an active class recording", async () => {
    const f = fixture();
    await f.capture.start(() => true);
    expect(f.requestStream).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.error).toContain("class recording");
  });
  it("discards interrupted recording data instead of saving a partial sample", async () => {
    const f = fixture();
    await f.capture.start();
    f.clock(24_000);
    f.recorder.onerror?.();
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", sample: null });
    expect(f.states.some((state) => state.phase === "ready")).toBe(false);
    expect(f.track.stop).toHaveBeenCalledTimes(1);
  });
});
