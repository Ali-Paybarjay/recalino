import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingController } from "./controller";
import { IndexedRecordingStore, type RecordingStore } from "./store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeTrack {
  readyState = "live";
  muted = false;
  stopped = false;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  stop() {
    this.stopped = true;
    this.readyState = "ended";
  }
  end() {
    this.readyState = "ended";
    this.onended?.();
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
  onresume: (() => void) | null = null;
  delayStop = false;
  stopCalls = 0;
  resumeCalls = 0;
  start() {
    this.state = "recording";
  }
  requestData() {}
  pause() {
    this.state = "paused";
    this.onpause?.();
  }
  resume() {
    this.resumeCalls += 1;
    this.state = "recording";
    this.onresume?.();
  }
  emit(value: string) {
    this.ondataavailable?.({ data: new Blob([value]) });
  }
  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
    if (!this.delayStop) this.finishStop();
  }
  finishStop(final = "final") {
    this.emit(final);
    this.onstop?.();
  }
  interrupt(final = "final") {
    this.state = "inactive";
    this.finishStop(final);
  }
}

const controllers: RecordingController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.restoreAllMocks();
});

function capture(
  store: RecordingStore = new IndexedRecordingStore(),
  options: { segmentMs?: number } = {},
) {
  let time = 0;
  let acquireCalls = 0;
  const streams: FakeStream[] = [];
  const recorders: FakeRecorder[] = [];
  const recorderStreams: MediaStream[] = [];
  const acquisitionQueue: ((stream: FakeStream) => Promise<MediaStream>)[] = [];
  const controller = new RecordingController(randomUUID(), store, {
    ...options,
    clock: () => time,
    getStream: async () => {
      acquireCalls += 1;
      const stream = new FakeStream();
      streams.push(stream);
      return acquisitionQueue.shift()?.(stream) ?? (stream as unknown as MediaStream);
    },
    makeRecorder: (stream) => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      recorderStreams.push(stream);
      return recorder as unknown as MediaRecorder;
    },
  });
  controllers.push(controller);
  return {
    controller,
    store,
    streams,
    recorders,
    recorderStreams,
    get recorder() {
      const recorder = recorders.at(-1);
      if (!recorder) throw new Error("No recorder was created");
      return recorder;
    },
    get track() {
      const stream = streams.at(-1);
      if (!stream) throw new Error("No microphone was requested");
      return stream.track;
    },
    get acquireCalls() {
      return acquireCalls;
    },
    advance(ms: number) {
      time += ms;
    },
    failNextAcquire() {
      acquisitionQueue.push(async () => {
        throw new Error("Microphone is temporarily unavailable");
      });
    },
    deferNextAcquire() {
      const pending = deferred<void>();
      acquisitionQueue.push(async (stream) => {
        await pending.promise;
        return stream as unknown as MediaStream;
      });
      return { resolve: () => pending.resolve(), reject: pending.reject };
    },
  };
}

function overrideStore(local: RecordingStore, overrides: Partial<RecordingStore>): RecordingStore {
  return {
    put: local.put.bind(local),
    append: local.append.bind(local),
    get: local.get.bind(local),
    list: local.list.bind(local),
    blob: local.blob.bind(local),
    remove: local.remove.bind(local),
    updateRegistration: local.updateRegistration.bind(local),
    ...overrides,
  };
}

async function waitForRecording(
  test: ReturnType<typeof capture>,
  timeout = 1000,
  recorderCount = 2,
) {
  await vi.waitFor(
    () => {
      expect(test.recorders).toHaveLength(recorderCount);
      expect(test.controller.state.phase).toBe("recording");
      expect(test.recorder.state).toBe("recording");
    },
    { timeout },
  );
}

describe("durable device capture", () => {
  it("commits the final chunk before claiming saved and excludes time paused", async () => {
    const test = capture();
    await test.controller.start();
    test.advance(3000);
    test.recorder.emit("first");
    test.controller.pause();
    test.advance(60000);
    test.controller.resume();
    test.advance(2000);
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("saved");
    const recording = test.controller.state.recording;
    expect(recording?.autoGenerate).toBe(true);
    expect(recording?.activeMs).toBe(5000);
    const blob = await test.store.blob(test.controller.userId, recording?.id ?? "");
    expect(await blob.text()).toBe("firstfinal");
    expect(test.track.stopped).toBe(true);
    expect(await test.store.get(randomUUID(), recording?.id ?? "")).toBeNull();
  });

  it("serializes class attachment against pending chunks without losing counters", async () => {
    const test = capture();
    await test.controller.start();
    test.recorder.emit("first");
    const id = randomUUID();
    const attached = test.controller.attachSession(id);
    test.recorder.emit("next");
    await attached;
    await test.controller.stop();
    expect(test.controller.state.recording?.sessionId).toBe(id);
    expect(test.controller.state.recording?.chunks).toBe(3);
    expect(
      await (
        await test.store.blob(test.controller.userId, test.controller.state.recording?.id ?? "")
      ).text(),
    ).toBe("firstnextfinal");
  });

  it("does not claim saved when final durable commit fails", async () => {
    const local = new IndexedRecordingStore();
    const store: RecordingStore = {
      put: async (row) => {
        if (row.status === "saved") throw new Error("disk full");
        await local.put(row);
      },
      append: local.append.bind(local),
      get: local.get.bind(local),
      list: local.list.bind(local),
      blob: local.blob.bind(local),
      remove: local.remove.bind(local),
      updateRegistration: local.updateRegistration.bind(local),
    };
    const test = capture(store);
    await test.controller.start();
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("failed");
    expect(test.controller.state.error).toContain("final save failed");
    expect((await local.list(test.controller.userId))[0]?.bytes).toBe(5);
  });

  it("requires a stopped capture and blocks late class attachment during account deletion", async () => {
    const test = capture();
    await test.controller.start();
    await expect(test.controller.prepareAccountDeletion()).rejects.toThrow("Stop and save");
    expect(test.controller.state.accountDeletionBlocked).toBe(false);
    await test.controller.stop();
    await test.controller.prepareAccountDeletion();
    await expect(test.controller.attachSession(randomUUID())).rejects.toThrow("deletion");
    await expect(test.controller.start()).rejects.toThrow("deletion");
    test.controller.releaseAccountDeletion();
    await test.controller.start();
    await test.controller.stop();
    await test.controller.prepareAccountDeletion();
    test.controller.completeAccountDeletion();
    test.controller.releaseAccountDeletion();
    expect(test.controller.state.recording).toBeNull();
    await expect(test.controller.start()).rejects.toThrow("deletion");
  });

  it("automatically recovers an unexpected stop into a separate playable segment", async () => {
    const test = capture();
    const sessionId = randomUUID();
    const firstId = await test.controller.start(sessionId);
    if (!firstId) throw new Error("Recording did not start");
    const firstRecorder = test.recorder;
    const firstManifest = test.controller.state.recording;
    test.advance(3000);
    firstRecorder.emit("first-");
    firstRecorder.interrupt("end-one");
    await waitForRecording(test);
    expect(test.controller.state.phase).toBe("recording");
    const next = test.controller.state.recording;
    expect(next?.id).not.toBe(firstId);
    expect(next?.creationKey).toBe(firstManifest?.creationKey);
    expect(next?.sessionId).toBe(sessionId);
    test.recorder.emit("second-");
    await test.controller.stop();
    expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
      "first-end-one",
    );
    expect(await (await test.store.blob(test.controller.userId, next?.id ?? "")).text()).toBe(
      "second-final",
    );
    expect(await test.store.list(test.controller.userId)).toHaveLength(2);
    expect(test.streams[0]?.track.stopped).toBe(true);
  });

  it("recovers recorder errors and ignores duplicate old recorder failures", async () => {
    const test = capture();
    await test.controller.start();
    const first = test.recorder;
    const oldError = first.onerror;
    const oldStop = first.onstop;
    const oldData = first.ondataavailable;
    first.onerror?.();
    await waitForRecording(test);
    const secondId = test.controller.state.recording?.id;
    oldError?.();
    oldStop?.();
    oldData?.({ data: new Blob(["stale"]) });
    test.controller.checkHealth();
    await test.controller.stop();
    expect(test.recorders).toHaveLength(2);
    expect(test.controller.state.recording?.id).toBe(secondId);
    expect(test.controller.state.phase).toBe("saved");
    expect(await (await test.store.blob(test.controller.userId, secondId ?? "")).text()).toBe(
      "final",
    );
  });

  it.each(["mute", "end"] as const)(
    "reacquires a fresh microphone after track %s",
    async (event) => {
      const test = capture();
      await test.controller.start();
      const oldTrack = test.track;
      oldTrack[event]();
      await waitForRecording(test);
      expect(test.track).not.toBe(oldTrack);
      expect(test.track.readyState).toBe("live");
      expect(test.track.muted).toBe(false);
      expect(oldTrack.stopped).toBe(true);
      await test.controller.stop();
    },
  );

  it.each(["inactive", "paused"])("detects a silent recorder transition to %s", async (state) => {
    const test = capture();
    await test.controller.start();
    test.recorder.state = state;
    test.controller.checkHealth();
    await waitForRecording(test, 3000);
    expect(test.controller.state.phase).toBe("recording");
    await test.controller.stop();
  });

  it("keeps an explicit user pause paused even when health checks run", async () => {
    const test = capture();
    await test.controller.start();
    test.controller.pause();
    test.advance(120000);
    test.controller.checkHealth();
    expect(test.controller.state.phase).toBe("paused");
    expect(test.recorder.state).toBe("paused");
    expect(test.recorder.resumeCalls).toBe(0);
    expect(test.acquireCalls).toBe(1);
    await test.controller.stop();
  });

  it("detects stalled audio delivery and starts another segment", async () => {
    const test = capture();
    await test.controller.start();
    test.recorder.emit("audio");
    test.advance(120000);
    test.controller.checkHealth();
    expect(test.recorders).toHaveLength(1);
    test.advance(10000);
    test.controller.checkHealth();
    await waitForRecording(test);
    expect(test.controller.state.phase).toBe("recording");
    await test.controller.stop();
  });

  it("retries temporary microphone acquisition failures until recording recovers", async () => {
    const test = capture();
    await test.controller.start();
    test.failNextAcquire();
    test.failNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    expect(test.controller.state.phase).toBe("recovering");
    await expect(test.controller.prepareAccountDeletion()).rejects.toThrow("Stop and save");
    await expect(test.controller.start()).rejects.toThrow("already active");
    await waitForRecording(test, 7000);
    expect(test.acquireCalls).toBe(4);
    expect(test.controller.state.phase).toBe("recording");
    await test.controller.stop();
  }, 10000);

  it("cancels recovery after Stop while a microphone permission request is pending", async () => {
    const test = capture();
    await test.controller.start();
    const permission = test.deferNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    const stopping = test.controller.stop();
    permission.resolve();
    await stopping;
    await vi.waitFor(() => expect(test.track.stopped).toBe(true));
    expect(test.recorders).toHaveLength(1);
    test.advance(120000);
    test.controller.checkHealth();
    expect(test.acquireCalls).toBe(2);
    await test.controller.prepareAccountDeletion();
  });

  it("cancels a scheduled microphone retry when the user stops", async () => {
    const test = capture();
    await test.controller.start();
    test.failNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    await test.controller.stop();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(test.acquireCalls).toBe(2);
    expect(test.recorders).toHaveLength(1);
    await test.controller.prepareAccountDeletion();
  });

  it("stops an initial pending microphone request without starting a late recorder", async () => {
    const test = capture();
    const permission = test.deferNextAcquire();
    const starting = test.controller.start().catch(() => {});
    expect(test.controller.state.phase).toBe("starting");
    const stopping = test.controller.stop();
    permission.resolve();
    await Promise.all([starting, stopping]);
    expect(test.recorders).toHaveLength(0);
    expect(test.track.stopped).toBe(true);
    test.controller.checkHealth();
    expect(test.acquireCalls).toBe(1);
    await test.controller.prepareAccountDeletion();
  });

  it("releases a late recovery stream when the user pauses and reconnects only after Resume", async () => {
    const test = capture();
    await test.controller.start();
    const permission = test.deferNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    test.controller.pause();
    permission.resolve();
    await vi.waitFor(() => expect(test.track.stopped).toBe(true));
    expect(test.recorders).toHaveLength(1);
    expect(test.controller.state.phase).toBe("paused");
    test.controller.checkHealth();
    expect(test.acquireCalls).toBe(2);
    test.controller.resume();
    await waitForRecording(test);
    expect(test.acquireCalls).toBe(3);
    expect(test.controller.state.phase).toBe("recording");
    await test.controller.stop();
  });

  it("retries failed local chunk writes in order before opening the next segment", async () => {
    const local = new IndexedRecordingStore();
    let failures = 2;
    const store: RecordingStore = {
      put: local.put.bind(local),
      append: async (recording, blob) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("Local storage is temporarily unavailable");
        }
        return local.append(recording, blob);
      },
      get: local.get.bind(local),
      list: local.list.bind(local),
      blob: local.blob.bind(local),
      remove: local.remove.bind(local),
      updateRegistration: local.updateRegistration.bind(local),
    };
    const test = capture(store);
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    test.recorder.emit("first-");
    await waitForRecording(test, 4000);
    const first = await local.get(test.controller.userId, firstId);
    expect(first?.chunks).toBe(2);
    expect(first?.status).toBe("interrupted");
    expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe("first-final");
    test.recorder.emit("second-");
    await test.controller.stop();
    expect(
      await (
        await local.blob(test.controller.userId, test.controller.state.recording?.id ?? "")
      ).text(),
    ).toBe("second-final");
  });

  it("includes a delayed final data event before starting the recovered segment", async () => {
    const test = capture();
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("initial-");
    first.onerror?.();
    expect(test.controller.state.phase).toBe("recovering");
    expect(test.recorders).toHaveLength(1);
    first.finishStop("delayed-final");
    await waitForRecording(test);
    expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
      "initial-delayed-final",
    );
    await test.controller.stop();
  });

  it("keeps final audio arriving after a stop timeout in its original segment", async () => {
    const local = new IndexedRecordingStore();
    const tailStarted = deferred<void>();
    const commitTail = deferred<void>();
    const test = capture(
      overrideStore(local, {
        append: async (recording, blob) => {
          if ((await blob.text()) === "late-final") {
            tailStarted.resolve();
            await commitTail.promise;
          }
          return local.append(recording, blob);
        },
      }),
    );
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    first.onerror?.();
    await waitForRecording(test, 3500);
    expect(await local.get(test.controller.userId, firstId)).toMatchObject({
      awaitingFinalData: true,
    });
    const secondId = test.controller.state.recording?.id;
    test.recorder.emit("second-");
    first.finishStop("late-final");
    await tailStarted.promise;
    expect(await local.get(test.controller.userId, firstId)).toMatchObject({
      awaitingFinalData: true,
    });
    expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe("first-");
    commitTail.resolve();
    await vi.waitFor(async () => {
      expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
        "first-late-final",
      );
      expect(await local.get(test.controller.userId, firstId)).toMatchObject({
        awaitingFinalData: false,
      });
    });
    first.emit("stale");
    await test.controller.stop();
    expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
      "first-late-final",
    );
    expect(await (await test.store.blob(test.controller.userId, secondId ?? "")).text()).toBe(
      "second-final",
    );
    expect(test.recorders).toHaveLength(2);
  });

  it("retries a failed late final chunk and keeps it pending until the audio is durable", async () => {
    const local = new IndexedRecordingStore();
    const retryStarted = deferred<void>();
    const commitRetry = deferred<void>();
    let tailAttempts = 0;
    const test = capture(
      overrideStore(local, {
        append: async (recording, blob) => {
          if ((await blob.text()) === "late-final") {
            tailAttempts += 1;
            if (tailAttempts === 1) throw new Error("Late final save temporarily failed");
            retryStarted.resolve();
            await commitRetry.promise;
          }
          return local.append(recording, blob);
        },
      }),
    );
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    first.onerror?.();
    await waitForRecording(test, 3500);
    const secondId = test.controller.state.recording?.id;
    first.finishStop("late-final");
    await vi.waitFor(() => expect(tailAttempts).toBeGreaterThan(1), { timeout: 4000 });
    await retryStarted.promise;
    expect(await local.get(test.controller.userId, firstId)).toMatchObject({
      awaitingFinalData: true,
    });
    expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe("first-");
    commitRetry.resolve();
    await vi.waitFor(async () => {
      expect(await local.get(test.controller.userId, firstId)).toMatchObject({
        awaitingFinalData: false,
        chunks: 2,
      });
      expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe(
        "first-late-final",
      );
    });
    await test.controller.stop();
    expect(await (await local.blob(test.controller.userId, secondId ?? "")).text()).toBe("final");
  }, 10000);

  it("cancels an older late save retry after onstop finishes the save", async () => {
    const local = new IndexedRecordingStore();
    let originalId: string | undefined;
    let tailAttempts = 0;
    let originalPuts = 0;
    const test = capture(
      overrideStore(local, {
        put: async (recording) => {
          if (recording.id === originalId) originalPuts += 1;
          await local.put(recording);
        },
        append: async (recording, blob) => {
          if ((await blob.text()) === "late-final") {
            tailAttempts += 1;
            if (tailAttempts <= 2) throw new Error("Late final save temporarily failed");
          }
          return local.append(recording, blob);
        },
      }),
    );
    originalId = await test.controller.start();
    if (!originalId) throw new Error("Recording did not start");
    const firstId = originalId;
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    first.onerror?.();
    await waitForRecording(test, 3500);
    first.emit("late-final");
    await vi.waitFor(() => {
      expect(tailAttempts).toBe(2);
      expect(test.controller.state.error).toContain("final audio part could not be saved");
    });
    first.onstop?.();
    await vi.waitFor(async () => {
      expect(await local.get(test.controller.userId, firstId)).toMatchObject({
        awaitingFinalData: false,
        chunks: 2,
      });
    });
    const completed = await local.get(test.controller.userId, firstId);
    if (!completed) throw new Error("Earlier segment is missing");
    const sourceAssetId = randomUUID();
    const sessionId = randomUUID();
    await local.put({ ...completed, sourceAssetId, sessionId });
    const putsAfterSuccess = originalPuts;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(originalPuts).toBe(putsAfterSuccess);
    expect(await local.get(test.controller.userId, firstId)).toMatchObject({
      sourceAssetId,
      sessionId,
      awaitingFinalData: false,
    });
    expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe(
      "first-late-final",
    );
    await test.controller.stop();
  }, 10000);

  it("clears the pending final audio marker when onstop arrives during its save", async () => {
    const local = new IndexedRecordingStore();
    const markerStarted = deferred<void>();
    const commitMarker = deferred<void>();
    let tailAttempts = 0;
    let holdPendingMarker = false;
    let markerBlocked = false;
    const test = capture(
      overrideStore(local, {
        put: async (recording) => {
          if (recording.awaitingFinalData && holdPendingMarker) {
            holdPendingMarker = false;
            markerBlocked = true;
            markerStarted.resolve();
            await commitMarker.promise;
          }
          await local.put(recording);
        },
        append: async (recording, blob) => {
          if ((await blob.text()) === "late-final") {
            tailAttempts += 1;
            if (tailAttempts === 1) throw new Error("Late final save temporarily failed");
          }
          return local.append(recording, blob);
        },
      }),
    );
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    first.onerror?.();
    await waitForRecording(test, 3500);
    holdPendingMarker = true;
    first.emit("late-final");
    await vi.waitFor(() => expect(markerBlocked).toBe(true));
    await markerStarted.promise;
    first.onstop?.();
    commitMarker.resolve();
    await vi.waitFor(async () => {
      expect(await local.get(test.controller.userId, firstId)).toMatchObject({
        awaitingFinalData: false,
        chunks: 2,
      });
      expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe(
        "first-late-final",
      );
    });
    expect(test.recorders).toHaveLength(2);
    await test.controller.stop();
  });

  it("keeps total capture duration and segment photo offsets separate and excludes recovery downtime", async () => {
    const test = capture();
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    test.advance(3000);
    const permission = test.deferNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    test.advance(60000);
    expect(test.controller.elapsed()).toBe(3000);
    permission.resolve();
    await vi.waitFor(() => expect(test.controller.state.phase).toBe("recording"));
    test.advance(2000);
    expect(test.controller.elapsed()).toBe(5000);
    expect(test.controller.segmentElapsed()).toBe(2000);
    await test.controller.stop();
    expect((await test.store.get(test.controller.userId, firstId))?.activeMs).toBe(3000);
    expect(test.controller.state.recording?.activeMs).toBe(2000);
    expect(test.controller.elapsed()).toBe(5000);
  });

  it("attaches the class to earlier recovered segments as well as the current one", async () => {
    const test = capture();
    await test.controller.start();
    test.recorder.interrupt();
    await waitForRecording(test);
    const sessionId = randomUUID();
    await test.controller.attachSession(sessionId);
    await test.controller.stop();
    const recordings = await test.store.list(test.controller.userId);
    expect(recordings).toHaveLength(2);
    expect(recordings.every((recording) => recording.sessionId === sessionId)).toBe(true);
  });

  it("continues saving audio after a class attachment write fails", async () => {
    const local = new IndexedRecordingStore();
    const sessionId = randomUUID();
    let failAttachment = true;
    const store = overrideStore(local, {
      put: async (recording) => {
        if (recording.sessionId === sessionId && failAttachment) {
          failAttachment = false;
          throw new Error("Class attachment could not be saved");
        }
        await local.put(recording);
      },
    });
    const test = capture(store);
    const id = await test.controller.start();
    if (!id) throw new Error("Recording did not start");
    test.recorder.emit("before-");
    const attached = test.controller.attachSession(sessionId);
    test.recorder.emit("after-");
    await expect(attached).rejects.toThrow("Class attachment could not be saved");
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("saved");
    expect(test.controller.state.recording?.chunks).toBe(3);
    expect(await (await local.blob(test.controller.userId, id)).text()).toBe("before-after-final");
  });

  it("attaches a delayed class result only to its original capture after a new recording starts", async () => {
    const test = capture();
    await test.controller.start();
    const captureId = test.controller.state.recording?.captureId;
    if (!captureId) throw new Error("Recording group is missing");
    const classCreated = deferred<string>();
    const attached = classCreated.promise.then((sessionId) =>
      test.controller.attachSession(sessionId, captureId),
    );
    test.recorder.interrupt();
    await waitForRecording(test);
    await test.controller.stop();
    const newSessionId = randomUUID();
    const newId = await test.controller.start(newSessionId);
    if (!newId) throw new Error("New recording did not start");
    const oldSessionId = randomUUID();
    classCreated.resolve(oldSessionId);
    await attached;
    const rows = await test.store.list(test.controller.userId);
    const earlier = rows.filter((row) => row.captureId === captureId);
    expect(earlier).toHaveLength(2);
    expect(earlier.every((row) => row.sessionId === oldSessionId)).toBe(true);
    expect(test.controller.state.recording?.id).toBe(newId);
    expect(test.controller.state.recording?.sessionId).toBe(newSessionId);
    expect((await test.store.get(test.controller.userId, newId))?.sessionId).toBe(newSessionId);
    await test.controller.stop();
  });

  it("preserves an uploaded source asset on an earlier segment when attaching the class", async () => {
    const test = capture();
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    test.recorder.interrupt();
    await waitForRecording(test);
    const first = await test.store.get(test.controller.userId, firstId);
    if (!first) throw new Error("Earlier segment is missing");
    const sourceAssetId = randomUUID();
    await test.store.put({ ...first, sourceAssetId });
    const sessionId = randomUUID();
    await test.controller.attachSession(sessionId);
    const attached = await test.store.get(test.controller.userId, firstId);
    expect(attached?.sessionId).toBe(sessionId);
    expect(attached?.sourceAssetId).toBe(sourceAssetId);
    expect(test.controller.state.recording?.sourceAssetId).toBeNull();
    await test.controller.stop();
  });

  it("waits for an interrupted segment's final commit after Stop before allowing deletion", async () => {
    const local = new IndexedRecordingStore();
    const blocked = deferred<void>();
    const store: RecordingStore = {
      put: async (row) => {
        if (row.status === "interrupted") await blocked.promise;
        await local.put(row);
      },
      append: local.append.bind(local),
      get: local.get.bind(local),
      list: local.list.bind(local),
      blob: local.blob.bind(local),
      remove: local.remove.bind(local),
      updateRegistration: local.updateRegistration.bind(local),
    };
    const test = capture(store);
    await test.controller.start();
    test.recorder.onerror?.();
    await expect(test.controller.prepareAccountDeletion()).rejects.toThrow("Stop and save");
    let stopped = false;
    const stopping = test.controller.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    blocked.resolve();
    await stopping;
    await test.controller.prepareAccountDeletion();
    expect((await local.list(test.controller.userId))[0]?.status).toBe("interrupted");
    await local.removeAccount(test.controller.userId);
    test.controller.completeAccountDeletion();
    expect(await local.list(test.controller.userId)).toHaveLength(0);
  });

  it("disposes during pending recovery without starting a recorder or leaking the new stream", async () => {
    const test = capture();
    await test.controller.start();
    const permission = test.deferNextAcquire();
    test.recorder.onerror?.();
    await vi.waitFor(() => expect(test.acquireCalls).toBe(2));
    test.controller.dispose();
    permission.resolve();
    await vi.waitFor(() => expect(test.track.stopped).toBe(true));
    expect(test.recorders).toHaveLength(1);
    expect(test.streams.every((stream) => stream.track.stopped)).toBe(true);
    test.controller.checkHealth();
    expect(test.acquireCalls).toBe(2);
  });
});

describe("periodic recording segments", () => {
  it("recreates a failed rollover manifest and persists its pending audio before recovery starts", async () => {
    const local = new IndexedRecordingStore();
    let allowManifest = false;
    let failedSeeds = 0;
    let missingAppends = 0;
    const test = capture(
      overrideStore(local, {
        put: async (recording) => {
          if (recording.segment === 2 && !allowManifest) {
            failedSeeds += 1;
            throw new Error("Rollover manifest temporarily could not be saved");
          }
          await local.put(recording);
        },
        append: async (recording, blob) => {
          if (recording.segment === 2 && !(await local.get(recording.userId, recording.id)))
            missingAppends += 1;
          return local.append(recording, blob);
        },
      }),
      { segmentMs: 1000 },
    );
    await test.controller.start();
    test.recorder.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    const secondId = test.controller.state.recording?.id;
    if (!secondId) throw new Error("Rollover recording was not created");
    test.recorder.emit("second-");
    await vi.waitFor(() => {
      expect(failedSeeds).toBeGreaterThanOrEqual(2);
      expect(missingAppends).toBeGreaterThan(0);
      expect(test.controller.state.phase).toBe("recovering");
    });
    expect(await local.get(test.controller.userId, secondId)).toBeNull();
    expect(test.recorders).toHaveLength(2);
    expect(test.acquireCalls).toBe(1);
    allowManifest = true;
    await waitForRecording(test, 4000, 3);
    expect(await local.get(test.controller.userId, secondId)).toMatchObject({
      status: "interrupted",
      chunks: 2,
      bytes: 12,
    });
    expect(await (await local.blob(test.controller.userId, secondId)).text()).toBe("second-final");
    expect(test.acquireCalls).toBe(2);
    test.recorder.emit("third-");
    test.advance(400);
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("saved");
    expect(test.controller.elapsed()).toBe(1400);
    expect(await local.list(test.controller.userId)).toHaveLength(3);
  }, 10000);

  it("drains every earlier segment's failed final save before recording resumes", async () => {
    const local = new IndexedRecordingStore();
    let originalId: string | undefined;
    let allowFinalSave = false;
    let failedFinalizations = 0;
    const test = capture(
      overrideStore(local, {
        put: async (recording) => {
          if (
            recording.id === originalId &&
            (recording.status === "saved" || recording.status === "interrupted") &&
            !allowFinalSave
          ) {
            failedFinalizations += 1;
            throw new Error("Earlier segment could not be finalized");
          }
          await local.put(recording);
        },
      }),
      { segmentMs: 1000 },
    );
    originalId = await test.controller.start();
    if (!originalId) throw new Error("Recording did not start");
    const firstId = originalId;
    test.recorder.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    await vi.waitFor(
      () => {
        expect(failedFinalizations).toBeGreaterThanOrEqual(3);
        expect(test.controller.state.phase).toBe("recovering");
      },
      { timeout: 3000 },
    );
    expect(test.recorders).toHaveLength(2);
    expect(test.recorders.every((recorder) => recorder.state !== "recording")).toBe(true);
    expect(test.acquireCalls).toBe(1);
    expect((await local.get(test.controller.userId, firstId))?.completedAt).toBeUndefined();
    allowFinalSave = true;
    await waitForRecording(test, 5000, 3);
    expect(test.acquireCalls).toBe(2);
    expect((await local.get(test.controller.userId, firstId))?.status).toBe("saved");
    expect(await (await local.blob(test.controller.userId, firstId)).text()).toBe("first-final");
    expect(test.controller.elapsed()).toBe(1000);
    test.advance(400);
    await test.controller.stop();
    expect(test.controller.elapsed()).toBe(1400);
    expect((await local.list(test.controller.userId)).every((row) => row.completedAt)).toBe(true);
  }, 10000);

  it("creates independent segments on the same live microphone and completes the group on Stop", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    const sessionId = randomUUID();
    const firstId = await test.controller.start(sessionId);
    if (!firstId) throw new Error("Recording did not start");
    const first = test.controller.state.recording;
    const microphone = test.track;
    test.recorder.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    await waitForRecording(test);
    const second = test.controller.state.recording;
    expect(second?.id).not.toBe(firstId);
    expect(second?.captureId).toBe(first?.captureId);
    expect(second?.creationKey).toBe(first?.creationKey);
    expect(second?.sessionId).toBe(sessionId);
    expect(second?.segment).toBe(2);
    expect(test.acquireCalls).toBe(1);
    expect(test.recorderStreams[1]).toBe(test.recorderStreams[0]);
    expect(test.track).toBe(microphone);
    expect(microphone.stopped).toBe(false);
    expect(microphone.readyState).toBe("live");
    expect(test.controller.elapsed()).toBe(1000);
    expect(test.controller.segmentElapsed()).toBe(0);
    await vi.waitFor(async () => {
      expect(await test.store.get(test.controller.userId, firstId)).toMatchObject({
        status: "saved",
        activeMs: 1000,
        autoRegister: true,
      });
    });
    expect((await test.store.get(test.controller.userId, firstId))?.completedAt).toBeUndefined();
    test.recorder.emit("second-");
    test.advance(400);
    expect(test.controller.elapsed()).toBe(1400);
    expect(test.controller.segmentElapsed()).toBe(400);
    await test.controller.stop();
    const rows = await test.store.list(test.controller.userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sessionId === sessionId && row.completedAt)).toBe(true);
    expect(test.controller.state.recording?.activeMs).toBe(400);
    expect(test.controller.elapsed()).toBe(1400);
    expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
      "first-final",
    );
    expect(await (await test.store.blob(test.controller.userId, second?.id ?? "")).text()).toBe(
      "second-final",
    );
    expect(microphone.stopped).toBe(true);
  });

  it("uses ten minutes of recorded audio as the default boundary", async () => {
    const test = capture();
    await test.controller.start();
    test.advance(599999);
    test.recorder.emit("before-boundary");
    test.controller.checkHealth();
    expect(test.recorders).toHaveLength(1);
    test.advance(1);
    test.controller.checkHealth();
    await waitForRecording(test);
    expect(test.controller.elapsed()).toBe(600000);
    expect(test.controller.segmentElapsed()).toBe(0);
    expect(test.acquireCalls).toBe(1);
    await test.controller.stop();
  });

  it("excludes paused wall time from the segment boundary", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    test.advance(700);
    test.controller.pause();
    test.advance(120000);
    test.controller.checkHealth();
    expect(test.recorders).toHaveLength(1);
    expect(test.controller.state.phase).toBe("paused");
    expect(test.controller.elapsed()).toBe(700);
    test.controller.resume();
    test.advance(299);
    test.recorder.emit("before-boundary");
    test.controller.checkHealth();
    expect(test.recorders).toHaveLength(1);
    test.advance(1);
    test.controller.checkHealth();
    await waitForRecording(test);
    expect(test.controller.elapsed()).toBe(1000);
    await test.controller.stop();
    expect((await test.store.get(test.controller.userId, firstId))?.activeMs).toBe(1000);
    expect(test.acquireCalls).toBe(1);
  });

  it("starts the next segment immediately and routes delayed old final audio to its original file", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    await waitForRecording(test);
    expect(first.stopCalls).toBe(1);
    expect(test.track.stopped).toBe(false);
    const secondId = test.controller.state.recording?.id;
    test.recorder.emit("second-");
    test.advance(250);
    first.finishStop("first-end");
    await vi.waitFor(async () => {
      expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
        "first-first-end",
      );
    });
    expect(test.controller.elapsed()).toBe(1250);
    expect(test.controller.segmentElapsed()).toBe(250);
    expect(test.track.stopped).toBe(false);
    await test.controller.stop();
    expect(await (await test.store.blob(test.controller.userId, secondId ?? "")).text()).toBe(
      "second-final",
    );
    expect(test.acquireCalls).toBe(1);
  });

  it("Stop at rollover waits for every previous finalizer and never starts another segment", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    let saved = false;
    const stopping = test.controller.stop().then(() => {
      saved = true;
    });
    await Promise.resolve();
    expect(saved).toBe(false);
    first.finishStop("first-end");
    await stopping;
    expect(test.controller.state.phase).toBe("saved");
    expect(test.acquireCalls).toBe(1);
    expect(test.recorders.length).toBeLessThanOrEqual(2);
    const recorderCount = test.recorders.length;
    test.advance(10000);
    test.controller.checkHealth();
    expect(test.recorders).toHaveLength(recorderCount);
    const rows = await test.store.list(test.controller.userId);
    expect(rows.every((row) => row.completedAt && row.status === "saved")).toBe(true);
    expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
      "first-first-end",
    );
    expect(test.track.stopped).toBe(true);
  });

  it("keeps a user pause at rollover paused until Resume", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    await test.controller.start();
    test.advance(1000);
    test.recorder.emit("first");
    test.controller.checkHealth();
    test.controller.pause();
    await vi.waitFor(() => expect(test.controller.state.phase).toBe("paused"));
    test.advance(120000);
    test.controller.checkHealth();
    expect(test.controller.state.phase).toBe("paused");
    expect(test.recorders.every((recorder) => recorder.state !== "recording")).toBe(true);
    expect(test.controller.elapsed()).toBe(1000);
    expect(test.acquireCalls).toBe(1);
    test.controller.resume();
    await waitForRecording(test);
    test.advance(200);
    expect(test.controller.elapsed()).toBe(1200);
    await test.controller.stop();
  });

  it("keeps a timed-out segment pending and incomplete until Stop and its late final save", async () => {
    const test = capture(undefined, { segmentMs: 1000 });
    const firstId = await test.controller.start();
    if (!firstId) throw new Error("Recording did not start");
    const first = test.recorder;
    first.delayStop = true;
    first.emit("first-");
    test.advance(1000);
    test.controller.checkHealth();
    await waitForRecording(test);
    await vi.waitFor(
      async () => {
        expect(await test.store.get(test.controller.userId, firstId)).toMatchObject({
          awaitingFinalData: true,
          autoRegister: true,
        });
      },
      { timeout: 3500 },
    );
    expect((await test.store.get(test.controller.userId, firstId))?.completedAt).toBeUndefined();
    await test.controller.stop();
    expect(await test.store.get(test.controller.userId, firstId)).toMatchObject({
      awaitingFinalData: true,
      completedAt: expect.any(String),
    });
    first.finishStop("late-end");
    await vi.waitFor(async () => {
      expect(await test.store.get(test.controller.userId, firstId)).toMatchObject({
        awaitingFinalData: false,
        completedAt: expect.any(String),
      });
      expect(await (await test.store.blob(test.controller.userId, firstId)).text()).toBe(
        "first-late-end",
      );
    });
    expect(test.recorders).toHaveLength(2);
    expect(test.acquireCalls).toBe(1);
  });
});
