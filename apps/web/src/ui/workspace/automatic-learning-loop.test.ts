import { randomUUID } from "node:crypto";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recording } from "../recording/store";
import type { AutomaticLearningStatus } from "./automatic-learning";
import { startLearningLoop } from "./automatic-learning-loop";
import { LEARNING_POLL } from "./automatic-learning-poll";
import { AudioUploadProblem } from "./upload-problems";

/**
 * Second audit (2026-10-13), item 6: the provider's loop under fake timers. The browser globals
 * it reads are the smallest stand-ins that carry events and visibility.
 */
const userId = randomUUID();
let document: EventTarget & { visibilityState: "visible" | "hidden" };
let window: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  document = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  window = new EventTarget();
  const storage = new Map<string, string>();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function recording(sessionId: string): Recording {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    sessionId,
    sourceAssetId: randomUUID(),
    creationKey: randomUUID(),
    status: "saved",
    mimeType: "audio/webm",
    activeMs: 1000,
    chunks: 1,
    bytes: 4,
    createdAt: now,
    updatedAt: now,
  };
}
function status(
  state: AutomaticLearningStatus["state"],
  patch: Partial<AutomaticLearningStatus> = {},
): AutomaticLearningStatus {
  return {
    state,
    revision: 1,
    batchId: null,
    run: null,
    snapshot: null,
    lastError: null,
    message: "",
    notesReady: false,
    cardsReady: false,
    ...patch,
  };
}
function awaiting(sessionId: string, sourceId: string) {
  const run = {
    id: randomUUID(),
    sessionId,
    reservationId: randomUUID(),
    state: "awaiting_upload",
  } as ProcessingRun;
  const snapshot = {
    sourcesVersion: 1,
    fingerprint: "a".repeat(64),
    sources: [
      { sourceId, kind: "audio", sha256: "b".repeat(64), objectId: null, contentVersionId: null },
    ],
  } as unknown as RunSnapshot;
  return status("waiting_upload", { run, snapshot });
}

function harness(rows: Recording[], server: Map<string, AutomaticLearningStatus>) {
  const states = new Map<string, AutomaticLearningStatus>();
  const refreshes: { id: string; at: number }[] = [];
  const uploads: { runId: string; at: number }[] = [];
  const listeners = new Set<() => void>();
  let phase = "idle";
  let path = "/today";
  let uploadFailure: unknown = null;
  const request = vi.fn(async (requestPath: string) => {
    if (requestPath.endsWith("/processing")) return [];
    if (requestPath === "/api/sources/contract") return { contract: { partBytes: 4 } };
    throw new Error(`Unexpected request ${requestPath}`);
  });
  const loop = startLearningLoop({
    userId,
    store: {
      list: async () => rows,
      blob: async () => new Blob(),
      photos: async () => [],
      savePhoto: async () => {},
    },
    controller: {
      snapshot: () => ({ phase, accountDeletionBlocked: false }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    manualManager: { snapshot: () => [], enqueue: async () => {} },
    states,
    currentPath: () => path,
    refresh: async (id) => {
      refreshes.push({ id, at: Date.now() });
      const current = server.get(id);
      if (current) states.set(id, current);
    },
    onProblem: () => {},
    onMessage: () => {},
    onTransferProgress: () => {},
    onStoreFailure: () => {},
    refreshPage: () => {},
    request: request as never,
    upload: async (run) => {
      uploads.push({ runId: run.id, at: Date.now() });
      if (uploadFailure) {
        const failure = uploadFailure;
        uploadFailure = null;
        throw failure;
      }
    },
    preparePhotos: async () => {},
  });
  return {
    loop,
    states,
    refreshes,
    uploads,
    request,
    setPhase: (next: string) => {
      phase = next;
      for (const listener of listeners) listener();
    },
    setPath: (next: string) => {
      path = next;
    },
    failNextUpload: (failure: unknown) => {
      uploadFailure = failure;
    },
  };
}
const minutes = (count: number) => count * 60_000;

describe("learning loop timing (audit item 6)", () => {
  it("reads seven idle classes with saved audio once in two hours, not 3,100 times", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const rows = Array.from({ length: 7 }, () => recording(randomUUID()));
    for (const row of rows) server.set(row.sessionId ?? "", status("ready"));
    const x = harness(rows, server);
    await vi.advanceTimersByTimeAsync(minutes(120));
    expect(x.refreshes).toHaveLength(7);
    expect(new Set(x.refreshes.map((r) => r.id)).size).toBe(7);
    x.loop.stop();
  });

  it("pauses while the page is hidden, except this device's own upload, and reads again when shown", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const device = recording(randomUUID());
    const remote = recording(randomUUID());
    server.set(
      device.sessionId ?? "",
      awaiting(device.sessionId ?? "", device.sourceAssetId ?? ""),
    );
    server.set(remote.sessionId ?? "", status("processing"));
    const x = harness([device, remote], server);
    await vi.advanceTimersByTimeAsync(LEARNING_POLL.baseMs);
    // Both learned; the device class uploaded at once.
    expect(x.uploads).toHaveLength(1);
    const seenBeforeHiding = x.refreshes.length;
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    x.failNextUpload(new TypeError("Failed to fetch"));
    x.states.delete(device.sessionId ?? "");
    x.states.set(
      device.sessionId ?? "",
      server.get(device.sessionId ?? "") as AutomaticLearningStatus,
    );
    await vi.advanceTimersByTimeAsync(minutes(10));
    // No read of the remote class while hidden.
    expect(x.refreshes.filter((r) => r.id === remote.sessionId).length).toBe(
      x.refreshes.slice(0, seenBeforeHiding).filter((r) => r.id === remote.sessionId).length,
    );
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      x.refreshes.at(-1)?.id === remote.sessionId || x.refreshes.at(-2)?.id === remote.sessionId,
    ).toBe(true);
    x.loop.stop();
  });

  it("wakes at once on online, a learning change, a capture phase change and opening the class", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const row = recording(randomUUID());
    const id = row.sessionId ?? "";
    server.set(id, status("ready"));
    const x = harness([row], server);
    await vi.advanceTimersByTimeAsync(minutes(5));
    expect(x.refreshes).toHaveLength(1);
    const count = () => x.refreshes.length;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(2);
    window.dispatchEvent(new CustomEvent("recalino:learning-changed", { detail: id }));
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(3);
    x.setPhase("recording");
    x.setPhase("idle");
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBeGreaterThanOrEqual(4);
    const before = count();
    x.setPath(`/sessions/${id}/sources`);
    x.loop.wake(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(before + 1);
    // Between events an idle class is left alone.
    const settled = count();
    await vi.advanceTimersByTimeAsync(minutes(30));
    // The viewed class keeps a slow heartbeat: the 3→60 s ramp, then one read a minute.
    expect(count() - settled).toBeLessThanOrEqual(36);
    expect(count() - settled).toBeGreaterThanOrEqual(30);
    x.loop.stop();
  });

  it("caps the wait at 15 s while a class is processing and at 60 s otherwise", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const row = recording(randomUUID());
    const id = row.sessionId ?? "";
    server.set(id, status("processing"));
    const x = harness([row], server);
    await vi.advanceTimersByTimeAsync(minutes(10));
    const times = x.refreshes.map((r) => r.at);
    const gaps = times.slice(1).map((at, i) => at - (times[i] ?? 0));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(LEARNING_POLL.processingMs);
    expect(gaps.slice(-3)).toEqual([15_000, 15_000, 15_000]);
    x.loop.stop();
  });

  it("starts the device upload within the 6 s cap of the run being created", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const row = recording(randomUUID());
    const id = row.sessionId ?? "";
    server.set(id, status("waiting_sources"));
    const x = harness([row], server);
    // Enough quiet reads to reach the cap.
    await vi.advanceTimersByTimeAsync(minutes(2));
    const createdAt = Date.now();
    server.set(id, awaiting(id, row.sourceAssetId ?? ""));
    await vi.advanceTimersByTimeAsync(LEARNING_POLL.startMs + LEARNING_POLL.baseMs);
    expect(x.uploads).toHaveLength(1);
    expect((x.uploads[0]?.at ?? 0) - createdAt).toBeLessThanOrEqual(LEARNING_POLL.startMs);
    x.loop.stop();
  });

  it("retries a transport failure on the next visit but never a refusal the server repeats", async () => {
    const server = new Map<string, AutomaticLearningStatus>();
    const row = recording(randomUUID());
    const id = row.sessionId ?? "";
    server.set(id, awaiting(id, row.sourceAssetId ?? ""));
    const x = harness([row], server);
    x.failNextUpload(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    expect(x.uploads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(minutes(1));
    expect(x.uploads.length).toBeGreaterThanOrEqual(2);
    const retried = x.uploads.length;
    // The second attempt succeeded: no further transfer of the same run.
    await vi.advanceTimersByTimeAsync(minutes(5));
    expect(x.uploads).toHaveLength(retried);
    const refused = recording(randomUUID());
    const refusedId = refused.sessionId ?? "";
    server.set(refusedId, awaiting(refusedId, refused.sourceAssetId ?? ""));
    const y = harness([refused], server);
    y.failNextUpload(new AudioUploadProblem("upload_closed", "closed"));
    await vi.advanceTimersByTimeAsync(minutes(5));
    expect(y.uploads).toHaveLength(1);
    x.loop.stop();
    y.loop.stop();
  });
});
