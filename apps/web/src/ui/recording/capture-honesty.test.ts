import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CaptureHealthEvent, RecordingController } from "./controller";
import type { MediaTimeline, TimelineReading } from "./media-timeline";
import { IndexedRecordingStore } from "./store";

class FakeTrack {
  readyState = "live";
  muted = false;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  stop() {
    this.readyState = "ended";
  }
  mute() {
    this.muted = true;
    this.onmute?.();
  }
}
class FakeStream {
  track = new FakeTrack();
  getAudioTracks() {
    return [this.track];
  }
  getTracks() {
    return [this.track];
  }
}
class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  requests = 0;
  /** Audio held by the encoder, delivered with the next chunk. */
  held = 0;
  start() {
    this.state = "recording";
  }
  requestData() {
    this.requests++;
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  emit(data: BlobPart) {
    this.ondataavailable?.({ data: new Blob([data]) });
  }
  /** A chunk holding `ms` of audio (understood by the fake timeline). */
  audio(ms: number) {
    this.emit(String(ms));
  }
  stop() {
    this.state = "inactive";
    this.audio(this.held);
    this.held = 0;
    this.onstop?.();
  }
}
/** Each chunk's text is the milliseconds of audio it holds. */
class FakeTimeline implements MediaTimeline {
  reading: TimelineReading = { kind: "webm", measured: true, mediaMs: 0, jumpMs: 0 };
  push(bytes: Uint8Array) {
    const ms = Number(new TextDecoder().decode(bytes));
    this.reading = { ...this.reading, mediaMs: this.reading.mediaMs + (ms || 0) };
  }
  read() {
    return this.reading;
  }
}

const controllers: RecordingController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

function harness(options: { segmentMs?: number; timeline?: () => MediaTimeline } = {}) {
  let now = Date.UTC(2026, 9, 12, 8, 49);
  const store = new IndexedRecordingStore();
  const recorders: FakeRecorder[] = [];
  const streams: FakeStream[] = [];
  const events: CaptureHealthEvent[] = [];
  const userId = randomUUID();
  const controller = new RecordingController(userId, store, {
    clock: () => now,
    segmentMs: options.segmentMs,
    timeline: options.timeline ?? (() => new FakeTimeline()),
    getStream: async () => {
      const stream = new FakeStream();
      streams.push(stream);
      return stream as unknown as MediaStream;
    },
    makeRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder as unknown as MediaRecorder;
    },
  });
  controller.onHealth((event) => events.push(event));
  controllers.push(controller);
  const rows = async () =>
    (await store.list(userId)).sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
  return {
    controller,
    store,
    recorders,
    streams,
    events,
    rows,
    get recorder() {
      return recorders.at(-1) as FakeRecorder;
    },
    advance(ms: number) {
      now += ms;
    },
    /** Device time passes and the recorder delivers `audio` ms of it. */
    async chunk(wallMs: number, audioMs = wallMs) {
      now += wallMs;
      (recorders.at(-1) as FakeRecorder).audio(audioMs);
      await vi.waitFor(async () => {
        const row = (await rows()).at(-1);
        expect(row?.chunks ?? 0).toBeGreaterThan(0);
      });
      await settle(controller);
    },
  };
}
async function settle(controller: RecordingController) {
  // Measuring and saving run on promise chains; let them drain.
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  void controller;
}

describe("honest in-app capture (PRD-REC-03, PRD-REC-05)", () => {
  it("saves the measured audio, not the device clock, when a phone stops delivering audio", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    // 2026-10-12 part 1 declared 29.2 minutes and held 1.1: the page stopped receiving audio.
    test.controller.observe({ type: "visibility", visible: false });
    test.advance(28 * 60 * 1000);
    await test.chunk(5000, 5000);
    test.controller.observe({ type: "visibility", visible: true });
    await test.controller.stop();
    const [first, second] = await test.rows();
    expect(first?.measuredBy).toBe("media");
    expect(first?.activeMs).toBe(10000);
    expect(first?.gaps).toEqual([
      expect.objectContaining({ offsetMs: 5000, missingMs: 28 * 60 * 1000, cause: "hidden" }),
    ]);
    // After the gap a new part starts, so its timestamps restart and nothing is skipped later.
    expect(second?.segment).toBe(2);
    expect(test.controller.state.phase).toBe("saved");
    expect(test.controller.state.missing).toEqual({
      totalMs: 28 * 60 * 1000,
      intervals: [{ from: "2026-10-12T08:49:05.000Z", missingMs: 28 * 60 * 1000 }],
    });
    expect(test.events).toContainEqual(
      expect.objectContaining({ type: "gap", missingMs: 28 * 60 * 1000, cause: "hidden" }),
    );
    expect(test.events).toContainEqual(
      expect.objectContaining({ type: "visibility", visible: false }),
    );
  });

  it("measures a real Chromium recording whose audio stopped for four seconds", async () => {
    const file = new Uint8Array(
      readFileSync(new URL("./test-fixtures/chromium-gap.webm", import.meta.url)),
    );
    const test = harness({ timeline: undefined });
    // Use the real container parser for this test.
    (test.controller as unknown as { deps: { timeline?: unknown } }).deps.timeline = undefined;
    await test.controller.start();
    const sizes = [1603, 1588, 1588];
    const arrivals = [1070, 6073, 7094];
    let offset = 0;
    let previous = 0;
    for (const [i, size] of sizes.entries()) {
      test.advance((arrivals[i] as number) - previous);
      previous = arrivals[i] as number;
      test.recorder.emit(file.subarray(offset, offset + size));
      offset += size;
      await settle(test.controller);
    }
    test.recorder.held = 0;
    test.advance(976);
    const last = file.subarray(offset);
    test.recorder.stop = function () {
      this.state = "inactive";
      this.emit(last);
      this.onstop?.();
    };
    await test.controller.stop();
    const rows = await test.rows();
    const all = rows.flatMap((row) => row.gaps ?? []);
    expect(all).toHaveLength(1);
    expect(all[0]?.missingMs).toBeGreaterThan(3000);
    expect(all[0]?.missingMs).toBeLessThan(4500);
    // ffmpeg decodes 4020 ms from these bytes; the device clock ran about 8 s.
    const total = rows.reduce((sum, row) => sum + row.activeMs, 0);
    expect(total).toBeGreaterThan(3900);
    expect(total).toBeLessThan(4200);
  });

  it("rotates parts by delivered audio when timers are frozen", async () => {
    const test = harness({ segmentMs: 20000 });
    await test.controller.start();
    // No health checks run: only chunks arrive, as on a throttled background page.
    for (let i = 0; i < 4; i++) await test.chunk(5000);
    await vi.waitFor(() => expect(test.recorders).toHaveLength(2));
    await test.chunk(5000);
    await test.controller.stop();
    const rows = await test.rows();
    expect(rows.map((row) => [row.segment, row.activeMs])).toEqual([
      [1, 20000],
      [2, 5000],
    ]);
  });

  it("never shows a healthy recording for long on a visible page without audio", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.advance(2000);
    test.controller.checkHealth();
    expect(test.recorder.requests).toBe(0);
    test.advance(1000);
    test.controller.checkHealth();
    expect(test.recorder.requests).toBe(1);
    expect(test.controller.state.phase).toBe("recording");
    test.advance(2000);
    test.controller.checkHealth();
    expect(test.controller.state.phase).toBe("recovering");
    expect(test.controller.state.error).toBe(
      "Recording stopped producing audio. Restarting automatically…",
    );
    await test.controller.stop();
  });

  it("waits while the page is hidden and asks for audio as soon as it is visible again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.controller.observe({ type: "visibility", visible: false });
    // A throttled background page: one heartbeat a minute, no audio, no restart.
    for (let i = 0; i < 5; i++) {
      test.advance(60000);
      vi.advanceTimersByTime(1000);
    }
    expect(test.controller.state.phase).toBe("recording");
    expect(test.events).toContainEqual({ type: "lifecycle", state: "throttled" });
    const before = test.recorder.requests;
    test.advance(500);
    test.controller.observe({ type: "visibility", visible: true });
    expect(test.recorder.requests).toBe(before + 1);
    // Nothing comes back: the failure is shown immediately (PRD-REC-03).
    test.advance(4000);
    test.controller.checkHealth();
    expect(test.controller.state.phase).toBe("recovering");
    await test.controller.stop();
  });

  it("records the time to reconnect a muted microphone as missing audio", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.streams.at(-1)?.track.mute();
    expect(test.controller.state.phase).toBe("recovering");
    test.advance(7000);
    await vi.waitFor(() => expect(test.controller.state.phase).toBe("recording"), {
      timeout: 3000,
    });
    await test.chunk(5000);
    await test.controller.stop();
    const rows = await test.rows();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.gaps).toEqual([
      expect.objectContaining({ offsetMs: 0, cause: "muted", missingMs: 7000 }),
    ]);
    expect(test.controller.state.missing?.totalMs).toBe(7000);
  });

  it("keeps an interruption that lasted until Stop on the last part", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.controller.pause();
    test.advance(60000);
    test.controller.resume();
    // Resume failed to restart the encoder in time; the learner stops 10 s later.
    test.advance(10000);
    await test.controller.stop();
    const rows = await test.rows();
    const gaps = rows.flatMap((row) => row.gaps ?? []);
    expect(gaps.every((gap) => gap.missingMs <= 10000)).toBe(true);
    // Paused time is never reported as missing.
    expect(test.controller.state.missing?.totalMs ?? 0).toBeLessThanOrEqual(10000);
  });

  it("does not count a pause as missing audio", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.controller.pause();
    test.advance(10 * 60 * 1000);
    test.controller.resume();
    await test.chunk(5000);
    await test.controller.stop();
    const rows = await test.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activeMs).toBe(10000);
    expect(rows[0]?.gaps).toBeUndefined();
    expect(test.controller.state.missing).toBeNull();
  });

  it("reports part measurements without audio, text or identifiers", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    await test.controller.stop();
    const part = test.events.find((event) => event.type === "part");
    expect(part).toEqual({
      type: "part",
      part: 1,
      mime: "audio/webm",
      measured: true,
      mediaMs: 5000,
      wallMs: 5000,
      missingMs: 0,
      gaps: 0,
    });
    for (const event of test.events)
      for (const value of Object.values(event))
        expect(typeof value === "string" ? /^[a-z/;=_.0-9 -]+$/.test(value) : true).toBe(true);
  });
});

describe("board photo anchors (task 5)", () => {
  it("anchors a photo inside the audio already measured, never in a gap", async () => {
    const test = harness();
    await test.controller.start();
    await test.chunk(5000);
    test.advance(60000);
    // The screen still ticks a little ahead, but the anchor is measured audio.
    expect(test.controller.segmentElapsed()).toBe(11000);
    expect(test.controller.anchorMs()).toBe(5000);
    await test.controller.stop();
    const [row] = await test.rows();
    expect(test.controller.anchorMs()).toBeLessThanOrEqual(row?.activeMs ?? 0);
  });
});
