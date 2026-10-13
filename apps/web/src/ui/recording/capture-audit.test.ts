import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CaptureState, RecordingController, TIMESLICE_MS } from "./controller";
import type { MediaTimeline, TimelineReading } from "./media-timeline";
import { registerRecordingRow } from "./source-sync";
import { IndexedRecordingStore, type Recording, recordingSchema } from "./store";

/**
 * Second audit of problem 2 (2026-10-12): each lost part of session e4b052d6 reproduced with a
 * fake recorder and a fake clock. Declared minutes are what the old controller registered;
 * decoded minutes are what the server found in the file.
 */
class FakeTrack {
  readyState = "live";
  muted = false;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  stop() {
    this.readyState = "ended";
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
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  timeslice = 0;
  requests = 0;
  start(timeslice: number) {
    this.timeslice = timeslice;
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
  /** A chunk holding `ms` of audio (the fake timeline reads the number). */
  audio(ms: number) {
    this.ondataavailable?.({ data: new Blob([String(ms)]) });
  }
  stop() {
    this.state = "inactive";
    this.audio(0);
    this.onstop?.();
  }
}
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
const MIN = 60000;
function harness(segmentMs = 10 * MIN) {
  let now = Date.UTC(2026, 9, 12, 8, 49);
  const store = new IndexedRecordingStore();
  const recorders: FakeRecorder[] = [];
  const streams: FakeStream[] = [];
  const userId = randomUUID();
  const states: CaptureState[] = [];
  const controller = new RecordingController(userId, store, {
    clock: () => now,
    segmentMs,
    timeline: () => new FakeTimeline(),
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
  controller.subscribe(() => states.push(controller.state));
  controllers.push(controller);
  const rows = async () =>
    (await store.list(userId)).sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  /** Phases the learner was shown, in order; recovery is instant in this harness. */
  const shown = () => states.map((state) => state.phase);
  return {
    controller,
    store,
    userId,
    recorders,
    streams,
    states,
    shown,
    rows,
    settle,
    get recorder() {
      return recorders.at(-1) as FakeRecorder;
    },
    advance: (ms: number) => {
      now += ms;
    },
    /** `wallMs` of device time pass and the recorder delivers `audioMs` of audio. */
    async chunk(wallMs: number, audioMs = wallMs) {
      now += wallMs;
      (recorders.at(-1) as FakeRecorder).audio(audioMs);
      await settle();
    },
    /** Steady capture: one chunk per timeslice for `ms`. */
    async steady(ms: number) {
      for (let at = 0; at < ms; at += TIMESLICE_MS) await this.chunk(TIMESLICE_MS);
    },
    total: async () => (await rows()).reduce((sum, row) => sum + row.activeMs, 0),
    missing: async () =>
      (await rows()).flatMap((row) => row.gaps ?? []).reduce((sum, gap) => sum + gap.missingMs, 0),
  };
}
const minutes = (ms: number) => Math.round((ms / MIN) * 10) / 10;

describe("2026-10-12 lost parts, reproduced (PRD-REC-03, PRD-REC-05)", () => {
  it("part 1: hidden for 28 minutes while chunks stop — 29.2 declared, 1.1 decoded", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(66000);
    test.controller.observe({ type: "visibility", visible: false });
    // The next chunk comes 28 minutes later and holds only its own two seconds.
    await test.chunk(28 * MIN, TIMESLICE_MS);
    test.controller.observe({ type: "visibility", visible: true });
    await test.controller.stop();
    const rows = await test.rows();
    const first = rows[0] as Recording;
    expect(minutes(first.activeMs)).toBe(1.1);
    expect(first.measuredBy).toBe("media");
    expect(first.gaps).toEqual([
      expect.objectContaining({
        from: new Date(Date.UTC(2026, 9, 12, 8, 50, 6)).toISOString(),
        to: new Date(Date.UTC(2026, 9, 12, 9, 18, 6)).toISOString(),
        offsetMs: 66000,
        missingMs: 28 * MIN - TIMESLICE_MS,
        cause: "hidden",
      }),
    ]);
    expect(minutes(28 * MIN + 66000)).toBe(29.1);
    expect(minutes(await test.total())).toBe(1.1);
    expect(test.controller.state.missing?.totalMs).toBe(28 * MIN - TIMESLICE_MS);
  });

  it("part 2: chunks arriving late and throttled — 12.4 declared, 4.8 decoded", async () => {
    const test = harness();
    await test.controller.start();
    test.controller.observe({ type: "visibility", visible: false });
    // 4.8 minutes of audio reach the recorder in bursts spread over 12.4 minutes of device time.
    const bursts = [
      [2 * MIN, 1.6 * MIN],
      [3 * MIN, 1.6 * MIN],
      [3.4 * MIN, 1.6 * MIN],
      [4 * MIN, 0],
    ] as const;
    for (const [wall, audio] of bursts) await test.chunk(wall, audio);
    test.controller.observe({ type: "visibility", visible: true });
    await test.controller.stop();
    expect(minutes(await test.total())).toBe(4.8);
    expect(minutes(await test.missing())).toBeCloseTo(12.4 - 4.8, 5);
    const rows = await test.rows();
    for (const row of rows) expect(row.measuredBy).toBe("media");
    // Every gap in the manifest has a start and an end.
    for (const gap of rows.flatMap((row) => row.gaps ?? [])) {
      expect(Date.parse(gap.from)).toBeLessThan(Date.parse(gap.to));
      expect(gap.missingMs).toBeGreaterThan(0);
    }
  });

  it("part 3: track muted, then ended — 10.3 declared, 1.1 decoded", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(66000);
    const track = test.streams.at(-1)?.track as FakeTrack;
    track.muted = true;
    track.onmute?.();
    // The learner saw the trouble at once (PRD-REC-03): not a healthy recording.
    expect(test.controller.state.phase).toBe("recovering");
    expect(test.controller.state.error).toContain("microphone");
    // Reconnection keeps failing for 9.2 minutes: the track ends each time.
    for (let i = 0; i < 4; i++) {
      test.advance(2.3 * MIN);
      await vi.waitFor(() => expect(test.recorders.length).toBeGreaterThan(1 + i), {
        timeout: 8000,
      });
      const stream = test.streams.at(-1)?.track as FakeTrack;
      stream.readyState = "ended";
      stream.onended?.();
    }
    await test.controller.stop();
    expect(minutes(await test.total())).toBe(1.1);
    expect(minutes(await test.missing())).toBeGreaterThanOrEqual(9.2);
    const causes = new Set(
      (await test.rows()).flatMap((row) => (row.gaps ?? []).map((g) => g.cause)),
    );
    expect([...causes].every((cause) => ["muted", "ended"].includes(cause))).toBe(true);
  }, 20000);

  it("part 5: throttled timer, late rotation — 11.7 declared, 4.5 decoded", async () => {
    // The health timer never fires; only chunks arrive, as on a throttled background page.
    const test = harness(10 * MIN);
    await test.controller.start();
    test.controller.observe({ type: "visibility", visible: false });
    await test.steady(4.5 * MIN);
    // Audio stops; 7.2 minutes later the recorder flushes an empty chunk.
    await test.chunk(7.2 * MIN, 0);
    test.controller.observe({ type: "visibility", visible: true });
    await test.controller.stop();
    expect(minutes(await test.total())).toBe(4.5);
    expect(minutes(await test.missing())).toBe(7.2);
  }, 30000);

  it("rotation seals a ten-minute part from delivered audio alone, with no timer", async () => {
    const test = harness(10 * MIN);
    await test.controller.start();
    await test.steady(10 * MIN + TIMESLICE_MS);
    await vi.waitFor(() => expect(test.recorders).toHaveLength(2));
    await test.controller.stop();
    const rows = await test.rows();
    expect(rows.map((row) => row.segment)).toEqual([1, 2]);
    expect(rows[0]?.activeMs).toBe(10 * MIN);
    expect(rows[0]?.status).toBe("saved");
  }, 30000);

  it("registers durationMs from the measured audio, within one second (PRD-REC-05)", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(66000);
    test.controller.observe({ type: "visibility", visible: false });
    await test.chunk(28 * MIN, TIMESLICE_MS);
    await test.controller.stop();
    const row = (await test.rows())[0] as Recording;
    const bodies: { durationMs: number }[] = [];
    await registerRecordingRow(row, test.store, test.controller, {
      request: (async (path: string, _method: string, body: unknown) => {
        if (path === "/api/classes") return { id: randomUUID() };
        bodies.push(body as { durationMs: number });
        return { assetId: randomUUID() };
      }) as never,
      online: () => true,
    });
    expect(bodies).toHaveLength(1);
    const declared = bodies[0]?.durationMs ?? 0;
    expect(declared - row.activeMs).toBeGreaterThanOrEqual(0);
    expect(declared - row.activeMs).toBeLessThanOrEqual(1000);
    // Never the 29 minutes the device clock ran.
    expect(declared).toBeLessThan(2 * MIN);
  });
});

describe("never a false recording (PRD-REC-02, PRD-REC-03, PRD-REC-07)", () => {
  it("shows a non-healthy state within five seconds of audio stopping on a visible page", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(10000);
    const stoppedAt = Date.UTC(2026, 9, 12, 8, 49) + 10000;
    // Audio stops. The health timer ticks every second, as in the browser.
    let now = stoppedAt;
    let shownAt: number | null = null;
    while (now - stoppedAt < 5000 && shownAt === null) {
      test.advance(1000);
      now += 1000;
      test.controller.checkHealth();
      if (test.controller.state.phase !== "recording") shownAt = now - stoppedAt;
      await test.settle();
    }
    expect(shownAt).not.toBeNull();
    expect(shownAt as number).toBeLessThanOrEqual(5000);
    expect(test.recorders[0]?.requests).toBeGreaterThan(0);
  });

  it("shows a non-healthy state when chunks keep coming without audio", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(10000);
    await test.chunk(TIMESLICE_MS, 0);
    expect(test.shown()).not.toContain("recovering");
    await test.chunk(TIMESLICE_MS, 0);
    expect(test.shown()).toContain("recovering");
    expect(test.states.find((state) => state.phase === "recovering")?.error).toBe(
      "Recording stopped producing audio. Restarting automatically…",
    );
  });

  it("never shows a pop-up, sound, duration or quota message during capture", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(66000);
    test.controller.observe({ type: "visibility", visible: false });
    await test.chunk(28 * MIN, TIMESLICE_MS);
    test.controller.observe({ type: "visibility", visible: true });
    await test.steady(30 * MIN);
    // Half an hour more of class after a 28-minute gap: still recording, no message of any kind.
    expect(test.controller.state).toMatchObject({ phase: "recording", error: null });
    expect(test.controller.state.missing ?? null).toBeNull();
    for (const state of test.states)
      expect(state.error === null || !/quota|allowance|minute|limit/i.test(state.error)).toBe(true);
    await test.controller.stop();
    expect(test.controller.state.missing?.totalMs).toBe(28 * MIN - TIMESLICE_MS);
  }, 30000);

  it("shows a real capture failure at once", async () => {
    const test = harness();
    await test.controller.start();
    await test.steady(4000);
    const track = test.streams.at(-1)?.track as FakeTrack;
    track.readyState = "ended";
    track.onended?.();
    expect(test.controller.state.phase).toBe("recovering");
    expect(test.controller.state.error).toBe(
      "The microphone stopped. Reconnecting automatically; saved audio is safe on this device.",
    );
  });

  it("says saved only after a valid local registration", async () => {
    const test = harness();
    const put = test.store.put.bind(test.store);
    let failing = false;
    test.store.put = async (manifest: Recording) => {
      if (failing) throw new Error("Quota exceeded");
      return put(manifest);
    };
    await test.controller.start();
    await test.steady(4000);
    failing = true;
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("failed");
    expect(test.controller.state.error).toContain("final save failed");
    expect(test.states.some((state) => state.phase === "saved")).toBe(false);
  });
});

describe("compatibility", () => {
  it("loads and registers an older manifest without measurement or gap markers", async () => {
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    const old: Recording = recordingSchema.parse({
      id: randomUUID(),
      userId,
      sessionId: randomUUID(),
      mimeType: "audio/webm",
      status: "saved",
      createdAt: "2026-10-06T08:00:00.000Z",
      updatedAt: "2026-10-06T09:00:00.000Z",
      activeMs: 1234,
      chunks: 0,
      bytes: 0,
      creationKey: randomUUID(),
      sourceAssetId: null,
      autoRegister: true,
      completedAt: "2026-10-06T09:00:00.000Z",
    });
    await store.put(old);
    const saved: Recording = await store.append(old, new Blob(["audio"]));
    expect(saved.gaps).toBeUndefined();
    expect(saved.measuredBy).toBeUndefined();
    const controller = {
      snapshot: () => ({ accountDeletionBlocked: false }) as CaptureState,
      subscribe: () => () => {},
      attachSession: async () => {},
    };
    const registered = await registerRecordingRow(saved, store, controller, {
      request: (async () => ({ assetId: randomUUID() })) as never,
      online: () => true,
    });
    expect(registered.sourceAssetId).toBeTruthy();
  });
});
