import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RecordingController } from "./controller";
import { IndexedRecordingStore, type RecordingStore } from "./store";

function capture(store: RecordingStore = new IndexedRecordingStore()) {
  let time = 0;
  let stopped = false;
  const recorder = {
    state: "inactive",
    mimeType: "audio/webm",
    ondataavailable: null as ((event: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    onerror: null as (() => void) | null,
    start() {
      this.state = "recording";
    },
    requestData() {},
    pause() {
      this.state = "paused";
    },
    resume() {
      this.state = "recording";
    },
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["final"]) });
      this.onstop?.();
    },
  };
  const track = {
    onended: null,
    stop() {
      stopped = true;
    },
  };
  const controller = new RecordingController(randomUUID(), store, {
    clock: () => time,
    getStream: async () =>
      ({ getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream,
    makeRecorder: () => recorder as unknown as MediaRecorder,
  });
  return {
    controller,
    recorder,
    store,
    advance(ms: number) {
      time += ms;
    },
    stopped: () => stopped,
  };
}
describe("durable device capture", () => {
  it("commits the final chunk before claiming saved and excludes time paused", async () => {
    const test = capture();
    await test.controller.start();
    test.advance(3000);
    test.recorder.ondataavailable?.({ data: new Blob(["first"]) });
    test.controller.pause();
    test.advance(60000);
    test.controller.resume();
    test.advance(2000);
    await test.controller.stop();
    expect(test.controller.state.phase).toBe("saved");
    const recording = test.controller.state.recording;
    expect(recording?.activeMs).toBe(5000);
    const blob = await test.store.blob(test.controller.userId, recording?.id ?? "");
    expect(await blob.text()).toBe("firstfinal");
    expect(test.stopped()).toBe(true);
    expect(await test.store.get(randomUUID(), recording?.id ?? "")).toBeNull();
  });
  it("serializes class attachment against pending chunks without losing counters", async () => {
    const test = capture();
    await test.controller.start();
    test.recorder.ondataavailable?.({ data: new Blob(["first"]) });
    const id = randomUUID();
    const attached = test.controller.attachSession(id);
    test.recorder.ondataavailable?.({ data: new Blob(["next"]) });
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
  it("drains a microphone failure's late final save before account deletion can clear storage", async () => {
    const local = new IndexedRecordingStore();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: RecordingStore = {
      put: async (row) => {
        if (row.status === "interrupted") await blocked;
        await local.put(row);
      },
      append: local.append.bind(local),
      get: local.get.bind(local),
      list: local.list.bind(local),
      blob: local.blob.bind(local),
      remove: local.remove.bind(local),
    };
    const test = capture(store);
    await test.controller.start();
    test.recorder.onerror?.();
    let drained = false;
    const prepared = test.controller.prepareAccountDeletion().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await prepared;
    expect((await local.list(test.controller.userId))[0]?.status).toBe("interrupted");
    await local.removeAccount(test.controller.userId);
    test.controller.completeAccountDeletion();
    expect(await local.list(test.controller.userId)).toHaveLength(0);
  });
});
