import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRequestError } from "../workspace/api";
import type { CaptureState } from "./controller";
import {
  RecordingSourceSync,
  registerRecordingRow,
  type SourceSyncDependencies,
} from "./source-sync";
import type { IndexedRecordingStore, Recording } from "./store";

const userId = randomUUID();
function recording(patch: Partial<Recording> = {}): Recording {
  const id = randomUUID();
  return {
    id,
    userId,
    captureId: id,
    segment: 1,
    sessionId: null,
    creationKey: randomUUID(),
    sourceAssetId: null,
    mimeType: "audio/webm;codecs=opus",
    status: "saved",
    activeMs: 1234,
    chunks: 1,
    bytes: 5,
    autoRegister: true,
    completedAt: "2026-10-06T12:00:00.000Z",
    createdAt: "2026-10-06T11:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
    ...patch,
  };
}
type RegistrationPatch = Parameters<IndexedRecordingStore["updateRegistration"]>[2];
function fixture(initial: Recording[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const store = {
    get: vi.fn(async (_userId: string, id: string) => rows.get(id) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    blob: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
    updateRegistration: vi.fn(async (_userId: string, id: string, patch: RegistrationPatch) => {
      const current = rows.get(id);
      if (current) rows.set(id, { ...current, ...patch });
      return rows.get(id) ?? null;
    }),
  };
  let state: CaptureState = {
    recording: null,
    phase: "saved",
    error: null,
    accountDeletionBlocked: false,
  };
  const listeners = new Set<() => void>();
  const controller = {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachSession: vi.fn(async (sessionId: string, captureId?: string) => {
      for (const row of rows.values()) {
        if ((row.captureId ?? row.id) === captureId) {
          await store.updateRegistration(userId, row.id, { sessionId });
        }
      }
    }),
  };
  const classKeys = new Map<string, string>();
  const sourceKeys = new Map<string, string>();
  const request = vi.fn(async (path: string, _method: string, _body?: unknown, key?: string) => {
    if (path === "/api/classes") {
      if (!classKeys.has(key ?? "")) classKeys.set(key ?? "", randomUUID());
      return { id: classKeys.get(key ?? "") };
    }
    if (path === "/api/recordings") {
      if (!sourceKeys.has(key ?? "")) sourceKeys.set(key ?? "", randomUUID());
      return { assetId: sourceKeys.get(key ?? "") };
    }
    throw new Error(`Unexpected API ${path}`);
  });
  let online = true;
  const deps = {
    request: request as SourceSyncDependencies["request"],
    online: () => online,
  };
  const sync = new RecordingSourceSync(userId, store, controller, deps);
  return {
    sync,
    store,
    controller,
    rows,
    request,
    classKeys,
    sourceKeys,
    deps,
    setOnline(value: boolean) {
      online = value;
    },
    publish(next: Partial<CaptureState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}
const workers: RecordingSourceSync[] = [];
function start(test: ReturnType<typeof fixture>) {
  workers.push(test.sync);
  test.sync.start();
}
async function flush() {
  // Allow real SHA-256 completion as well as the request/persistence microtasks.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
afterEach(() => {
  for (const worker of workers.splice(0)) worker.dispose();
  vi.useRealTimers();
});

describe("finalized recording source registration", () => {
  it("keeps an offline stopped recording queued and resumes it when connected", async () => {
    const row = recording();
    const test = fixture([row]);
    test.setOnline(false);
    start(test);
    await flush();
    expect(test.sync.snapshot()).toMatchObject({ phase: "waiting", pending: 1, count: 0 });
    expect(test.request).not.toHaveBeenCalled();
    test.setOnline(true);
    test.sync.checkOnline();
    await vi.waitFor(() =>
      expect(test.sync.snapshot()).toMatchObject({ phase: "idle", pending: 0, count: 1 }),
    );
    expect(test.rows.get(row.id)?.sourceAssetId).toBeTruthy();
    expect(test.rows.get(row.id)?.syncError).toBeNull();
  });

  it("adds two independent parts to one class using checksums and metadata only", async () => {
    const first = recording({ status: "interrupted" });
    const second = recording({
      captureId: first.captureId,
      creationKey: first.creationKey,
      segment: 2,
    });
    const test = fixture([second, first]);
    start(test);
    await vi.waitFor(() => expect(test.sync.snapshot().count).toBe(2));
    const calls = test.request.mock.calls;
    expect(calls.filter(([path]) => path === "/api/classes")).toHaveLength(1);
    expect(test.classKeys.size).toBe(1);
    expect(test.sourceKeys.size).toBe(2);
    const sources = calls.filter(([path]) => path === "/api/recordings");
    const sha256 = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("audio")),
    ).toString("hex");
    for (const [index, [path, method, body, key]] of sources.entries()) {
      expect(path).toBe("/api/recordings");
      expect(method).toBe("POST");
      expect(body).toMatchObject({
        sessionId: test.rows.get(first.id)?.sessionId,
        sizeBytes: 5,
        mimeType: "audio/webm",
        sha256,
        durationMs: 2234,
        parts: [],
        displayName: `Session recording 2026-10-06 · Part ${index + 1}`,
      });
      expect(key).toBe(`recorded-source:${index === 0 ? first.id : second.id}`);
      expect(body).not.toHaveProperty("blob");
      expect(body).not.toBeInstanceOf(Blob);
    }
    expect(test.rows.get(first.id)?.sessionId).toBe(test.rows.get(second.id)?.sessionId);
  });

  // D107: "Continue recording" starts a new recording (its own capture) that numbers its parts
  // after the session's earlier ones and shares their class key while the session is unknown.
  it("names a continued recording's parts after the earlier ones, in one session", async () => {
    const first = recording({ status: "interrupted" });
    const continued = recording({
      creationKey: first.creationKey,
      segment: 2,
      createdAt: "2026-10-06T11:30:00.000Z",
    });
    const test = fixture([continued, first]);
    start(test);
    await vi.waitFor(() => expect(test.sync.snapshot().count).toBe(2));
    expect(test.classKeys.size).toBe(1);
    const names = test.request.mock.calls
      .filter(([path]) => path === "/api/recordings")
      .map(([, , body]) => (body as { displayName: string }).displayName);
    expect(names).toEqual([
      "Session recording 2026-10-06 · Part 1",
      "Session recording 2026-10-06 · Part 2",
    ]);
    expect(test.rows.get(first.id)?.sessionId).toBe(test.rows.get(continued.id)?.sessionId);
  });

  it("does not register active, pre-Stop, legacy/manual, zero-byte, or late-tail recordings", async () => {
    const delayed = recording({ awaitingFinalData: true });
    const test = fixture([
      delayed,
      recording({ status: "recording" }),
      recording({ status: "paused" }),
      recording({ completedAt: undefined }),
      recording({ autoRegister: false }),
      recording({ autoRegister: undefined }),
      recording({ bytes: 0 }),
    ]);
    start(test);
    await flush();
    expect(test.request).not.toHaveBeenCalled();
    expect(test.sync.snapshot()).toMatchObject({ phase: "idle", pending: 0, count: 0 });
    test.rows.set(delayed.id, { ...delayed, awaitingFinalData: false });
    test.publish({ phase: "saved" });
    await vi.waitFor(() => expect(test.sync.snapshot().count).toBe(1));
    expect(test.sourceKeys.size).toBe(1);
  });

  it("retries a transient failure with the same class and source idempotency keys", async () => {
    const row = recording();
    const test = fixture([row]);
    const server = test.deps.request;
    let sourceAttempts = 0;
    test.deps.request = (async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      if (args[0] === "/api/recordings" && sourceAttempts++ === 0)
        throw new TypeError("Connection lost");
      return server(...args);
    }) as SourceSyncDependencies["request"];
    const sync = new RecordingSourceSync(userId, test.store, test.controller, test.deps);
    workers.push(sync);
    sync.start();
    await vi.waitFor(() => expect(sync.snapshot().phase).toBe("waiting"));
    expect(test.rows.get(row.id)?.sessionId).toBeTruthy();
    expect(test.rows.get(row.id)?.syncError).toContain("interrupted");
    sync.checkOnline();
    await vi.waitFor(() => expect(sync.snapshot().phase).toBe("idle"));
    expect(test.classKeys.size).toBe(1);
    expect(test.request.mock.calls.filter(([path]) => path === "/api/classes")).toHaveLength(1);
    expect(sourceAttempts).toBe(2);
    expect(test.rows.get(row.id)?.sourceAssetId).toBeTruthy();
  });

  it("recovers a lost local acknowledgment without creating a duplicate server source or rewriting counters", async () => {
    const row = recording();
    const test = fixture([row]);
    const update = test.store.updateRegistration.getMockImplementation();
    if (!update) throw new Error("The fixture registration writer is missing");
    let acknowledged = false;
    test.store.updateRegistration.mockImplementation(async (owner, id, patch) => {
      if (patch.sourceAssetId && !acknowledged) {
        acknowledged = true;
        // Another durable writer's counters must survive the later registration acknowledgment.
        const current = test.rows.get(id);
        if (!current) throw new Error("The fixture recording is missing");
        test.rows.set(id, { ...current, chunks: 2 });
        throw new Error("Local acknowledgment lost");
      }
      return update(owner, id, patch);
    });
    start(test);
    await vi.waitFor(() => expect(test.sync.snapshot().phase).toBe("waiting"));
    expect(test.sourceKeys.size).toBe(1);
    expect(test.rows.get(row.id)?.sourceAssetId).toBeNull();
    test.sync.checkOnline();
    await vi.waitFor(() => expect(test.sync.snapshot().phase).toBe("idle"));
    expect(test.sourceKeys.size).toBe(1);
    expect(test.request.mock.calls.filter(([path]) => path === "/api/recordings")).toHaveLength(2);
    expect(test.rows.get(row.id)?.chunks).toBe(2);
    expect(test.rows.get(row.id)?.bytes).toBe(5);
  });

  it("surfaces a permanent rejection without retries until the user explicitly retries", async () => {
    const row = recording({ sessionId: randomUUID() });
    const test = fixture([row]);
    const rejected = vi.fn(async () => {
      throw new WorkspaceRequestError("Sign in again", "unauthorized", undefined, 401);
    });
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      request: rejected as SourceSyncDependencies["request"],
      online: () => true,
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(() => expect(sync.snapshot().phase).toBe("failed"));
    expect(sync.snapshot().error).toContain("Sign in again");
    expect(test.rows.get(row.id)?.syncError).toBe("Sign in again");
    sync.checkOnline();
    test.publish({ phase: "saved" });
    await flush();
    expect(rejected).toHaveBeenCalledTimes(1);
    sync.retry();
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(2));
  });

  it.each(["class", "part"] as const)(
    "keeps syncing newer completed groups after an older %s is permanently rejected",
    async (target) => {
      const older = recording({
        sessionId: target === "part" ? randomUUID() : null,
        createdAt: "2026-10-06T10:00:00.000Z",
      });
      const later = recording({ createdAt: "2026-10-06T11:30:00.000Z" });
      const test = fixture([older, later]);
      const server = test.deps.request;
      let rejectOlder = true;
      const isOlderRequest = (path: string, key?: string) =>
        target === "class"
          ? path === "/api/classes" && key === older.creationKey
          : path === "/api/recordings" && key === `recorded-source:${older.id}`;
      const request = vi.fn(async (...args: Parameters<SourceSyncDependencies["request"]>) => {
        if (isOlderRequest(args[0], args[3]) && rejectOlder)
          throw new WorkspaceRequestError(
            "Older recording was rejected",
            "forbidden",
            undefined,
            403,
          );
        return server(...args);
      });
      const sync = new RecordingSourceSync(userId, test.store, test.controller, {
        ...test.deps,
        request: request as SourceSyncDependencies["request"],
      });
      workers.push(sync);
      sync.start();
      await vi.waitFor(() =>
        expect(sync.snapshot()).toMatchObject({ phase: "failed", count: 1, pending: 1 }),
      );
      expect(test.rows.get(later.id)?.sourceAssetId).toBeTruthy();
      expect(test.rows.get(older.id)?.sourceAssetId).toBeNull();
      expect(test.rows.get(older.id)?.syncError).toContain("Older recording was rejected");
      sync.checkOnline();
      test.publish({ phase: "saved" });
      await flush();
      expect(
        request.mock.calls.filter(([path, , , key]) => isOlderRequest(path, key)),
      ).toHaveLength(1);
      const newest = recording({ createdAt: "2026-10-06T12:30:00.000Z" });
      test.rows.set(newest.id, newest);
      test.publish({ phase: "saved" });
      await vi.waitFor(() =>
        expect(sync.snapshot()).toMatchObject({ phase: "failed", count: 2, pending: 1 }),
      );
      expect(test.rows.get(newest.id)?.sourceAssetId).toBeTruthy();
      expect(
        request.mock.calls.filter(([path, , , key]) => isOlderRequest(path, key)),
      ).toHaveLength(1);
      rejectOlder = false;
      sync.retry();
      await vi.waitFor(() =>
        expect(sync.snapshot()).toMatchObject({ phase: "idle", count: 3, pending: 0 }),
      );
      expect(test.rows.get(older.id)?.sourceAssetId).toBeTruthy();
      expect(test.rows.get(older.id)?.syncError).toBeNull();
      expect(
        request.mock.calls.filter(([path, , , key]) => isOlderRequest(path, key)),
      ).toHaveLength(2);
    },
  );

  it("cancels pending registration during account deletion and never records a late response", async () => {
    const row = recording({ sessionId: randomUUID() });
    const test = fixture([row]);
    let resolve: ((result: { assetId: string }) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<{ assetId: string }>((done) => {
          resolve = done;
        }),
    );
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      request: request as SourceSyncDependencies["request"],
      online: () => true,
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    test.publish({ accountDeletionBlocked: true });
    resolve?.({ assetId: randomUUID() });
    await flush();
    expect(sync.snapshot().phase).toBe("idle");
    expect(test.rows.get(row.id)?.sourceAssetId).toBeNull();
    expect(test.store.updateRegistration).not.toHaveBeenCalled();
    sync.retry();
    sync.checkOnline();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shares manual registration idempotency while refusing an unfinished automatic part", async () => {
    const legacy = recording({
      autoRegister: undefined,
      completedAt: undefined,
      captureId: undefined,
      segment: undefined,
    });
    const active = recording({ completedAt: undefined });
    const test = fixture([legacy, active]);
    const added = await registerRecordingRow(legacy, test.store, test.controller, test.deps);
    expect(added.sourceAssetId).toBeTruthy();
    await registerRecordingRow(legacy, test.store, test.controller, test.deps);
    expect(test.sourceKeys.size).toBe(1);
    await expect(
      registerRecordingRow(active, test.store, test.controller, test.deps),
    ).rejects.toThrow("Stop and save");
  });

  it("automatically runs the bounded retry delay without needing a controller update", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const row = recording({ sessionId: randomUUID() });
    const test = fixture([row]);
    let attempts = 0;
    const request = (async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      if (attempts++ === 0) throw new TypeError("Transient");
      return test.deps.request(...args);
    }) as SourceSyncDependencies["request"];
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      ...test.deps,
      request,
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(() => expect(sync.snapshot().phase).toBe("waiting"), {
      timeout: 2000,
      interval: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(
      () => expect(sync.snapshot()).toMatchObject({ phase: "idle", count: 1, pending: 0 }),
      { timeout: 2000, interval: 0 },
    );
    expect(attempts).toBe(2);
  });

  it("bounds a stalled metadata request at thirty seconds and retries with the same key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const row = recording({ sessionId: randomUUID() });
    const test = fixture([row]);
    let attempts = 0;
    const request = vi.fn(async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      if (attempts++ === 0) return new Promise<never>(() => {});
      return test.deps.request(...args);
    });
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      ...test.deps,
      request: request as SourceSyncDependencies["request"],
    });
    workers.push(sync);
    sync.start();
    // Poll real crypto completion without moving the fake request deadline forward.
    await vi.waitFor(
      () => {
        expect(request).toHaveBeenCalledTimes(1);
        expect(sync.snapshot()).toMatchObject({ phase: "syncing", count: 0 });
      },
      { timeout: 2000, interval: 0 },
    );
    await vi.advanceTimersByTimeAsync(29999);
    expect(sync.snapshot().phase).toBe("syncing");
    await vi.advanceTimersByTimeAsync(1);
    expect(sync.snapshot()).toMatchObject({ phase: "waiting", pending: 1, count: 0 });
    expect(test.rows.get(row.id)?.sourceAssetId).toBeNull();
    expect(request.mock.calls[0]?.[4]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(
      () => expect(sync.snapshot()).toMatchObject({ phase: "idle", pending: 0, count: 1 }),
      { timeout: 2000, interval: 0 },
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[3]).toBe(`recorded-source:${row.id}`);
    expect(request.mock.calls[1]?.[3]).toBe(request.mock.calls[0]?.[3]);
    expect(test.rows.get(row.id)?.sourceAssetId).toBeTruthy();
  });

  it("gives the next recording its own retry budget after an older recording exhausts its retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const older = recording({
      sessionId: randomUUID(),
      createdAt: "2026-10-06T10:00:00.000Z",
    });
    const later = recording({
      sessionId: randomUUID(),
      createdAt: "2026-10-06T11:00:00.000Z",
    });
    const test = fixture([older, later]);
    let olderAttempts = 0;
    let laterAttempts = 0;
    const request = (async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      if (args[3] === `recorded-source:${older.id}`) {
        olderAttempts += 1;
        throw new TypeError("Older source remains unavailable");
      }
      if (args[3] === `recorded-source:${later.id}` && laterAttempts++ === 0)
        throw new TypeError("Newer source connection briefly failed");
      return test.deps.request(...args);
    }) as SourceSyncDependencies["request"];
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      ...test.deps,
      request,
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(
      () => {
        expect(olderAttempts).toBe(1);
        expect(sync.snapshot().phase).toBe("waiting");
      },
      { timeout: 2000, interval: 0 },
    );
    for (const [index, delay] of [1000, 2000, 4000, 8000].entries()) {
      await vi.advanceTimersByTimeAsync(delay);
      await vi.waitFor(
        () => {
          expect(olderAttempts).toBe(index + 2);
          if (index < 3) expect(sync.snapshot().phase).toBe("waiting");
        },
        { timeout: 2000, interval: 0 },
      );
    }
    await vi.waitFor(
      () => {
        expect(laterAttempts).toBe(1);
        expect(sync.snapshot()).toMatchObject({ phase: "waiting", count: 0, pending: 2 });
      },
      { timeout: 2000, interval: 0 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(
      () => expect(sync.snapshot()).toMatchObject({ phase: "failed", count: 1, pending: 1 }),
      { timeout: 2000, interval: 0 },
    );
    expect(olderAttempts).toBe(5);
    expect(laterAttempts).toBe(2);
    expect(test.rows.get(older.id)?.sourceAssetId).toBeNull();
    expect(test.rows.get(later.id)?.sourceAssetId).toBeTruthy();
    expect(test.rows.get(later.id)?.syncError).toBeNull();
  });

  it("waits for an earlier late tail before adding siblings or newer captures in that class while other classes progress", async () => {
    const sessionId = randomUUID();
    const first = recording({ sessionId, awaitingFinalData: true });
    const second = recording({
      sessionId,
      captureId: first.captureId,
      creationKey: first.creationKey,
      segment: 2,
      createdAt: "2026-10-06T11:01:00.000Z",
    });
    const later = recording({ sessionId, createdAt: "2026-10-06T11:02:00.000Z" });
    const independent = recording({ sessionId: randomUUID() });
    const test = fixture([later, second, independent, first]);
    start(test);
    await vi.waitFor(() =>
      expect(test.sync.snapshot()).toMatchObject({ phase: "waiting", count: 1, pending: 2 }),
    );
    expect(test.rows.get(independent.id)?.sourceAssetId).toBeTruthy();
    expect(test.rows.get(second.id)?.sourceAssetId).toBeNull();
    expect(test.rows.get(later.id)?.sourceAssetId).toBeNull();
    await expect(
      registerRecordingRow(second, test.store, test.controller, test.deps),
    ).rejects.toThrow("earlier recorded parts");
    test.rows.set(first.id, { ...first, awaitingFinalData: false });
    test.publish({ phase: "saved" });
    await vi.waitFor(() =>
      expect(test.sync.snapshot()).toMatchObject({ phase: "idle", count: 4, pending: 0 }),
    );
    const registered = test.request.mock.calls
      .filter(([path]) => path === "/api/recordings")
      .map(([, , , key]) => key);
    expect(registered).toEqual(
      [independent, first, second, later].map((row) => `recorded-source:${row.id}`),
    );
  });

  it("does not add a later sibling before an earlier rejected part, without starving a different class", async () => {
    const first = recording({ sessionId: randomUUID() });
    const second = recording({
      sessionId: first.sessionId,
      captureId: first.captureId,
      creationKey: first.creationKey,
      segment: 2,
    });
    const independent = recording({
      sessionId: randomUUID(),
      createdAt: "2026-10-06T11:01:00.000Z",
    });
    const test = fixture([second, first, independent]);
    const server = test.deps.request;
    let reject = true;
    const request = vi.fn(async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      if (args[3] === `recorded-source:${first.id}` && reject)
        throw new WorkspaceRequestError("Earlier part rejected", "forbidden", undefined, 403);
      return server(...args);
    });
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      ...test.deps,
      request: request as SourceSyncDependencies["request"],
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(() =>
      expect(sync.snapshot()).toMatchObject({ phase: "failed", count: 1, pending: 2 }),
    );
    expect(test.rows.get(independent.id)?.sourceAssetId).toBeTruthy();
    expect(test.rows.get(second.id)?.sourceAssetId).toBeNull();
    expect(request.mock.calls.some((args) => args[3] === `recorded-source:${second.id}`)).toBe(
      false,
    );
    reject = false;
    sync.retry();
    await vi.waitFor(() =>
      expect(sync.snapshot()).toMatchObject({ phase: "idle", count: 3, pending: 0 }),
    );
    expect(
      test.request.mock.calls
        .filter(([path]) => path === "/api/recordings")
        .map(([, , , key]) => key),
    ).toEqual([independent, first, second].map((row) => `recorded-source:${row.id}`));
  });

  it("acknowledges the first part idempotently before registering the next part after a lost response", async () => {
    const first = recording({ sessionId: randomUUID() });
    const second = recording({
      sessionId: first.sessionId,
      captureId: first.captureId,
      creationKey: first.creationKey,
      segment: 2,
    });
    const test = fixture([second, first]);
    const server = test.deps.request;
    let loseResponse = true;
    const request = vi.fn(async (...args: Parameters<SourceSyncDependencies["request"]>) => {
      const result = await server(...args);
      if (args[3] === `recorded-source:${first.id}` && loseResponse) {
        loseResponse = false;
        throw new TypeError("Acknowledgment lost after source creation");
      }
      return result;
    });
    const sync = new RecordingSourceSync(userId, test.store, test.controller, {
      ...test.deps,
      request: request as SourceSyncDependencies["request"],
    });
    workers.push(sync);
    sync.start();
    await vi.waitFor(
      () => expect(sync.snapshot()).toMatchObject({ phase: "idle", count: 2, pending: 0 }),
      { timeout: 5000 },
    );
    expect(test.sourceKeys.size).toBe(2);
    expect(
      request.mock.calls.filter(([path]) => path === "/api/recordings").map(([, , , key]) => key),
    ).toEqual([first, first, second].map((row) => `recorded-source:${row.id}`));
  });

  it("does not block later audio on an earlier finalized empty part that has no late data", async () => {
    const empty = recording({ sessionId: randomUUID(), bytes: 0 });
    const second = recording({
      sessionId: empty.sessionId,
      captureId: empty.captureId,
      segment: 2,
    });
    const test = fixture([empty, second]);
    start(test);
    await vi.waitFor(() =>
      expect(test.sync.snapshot()).toMatchObject({ phase: "idle", count: 1, pending: 0 }),
    );
    expect(test.rows.get(second.id)?.sourceAssetId).toBeTruthy();
    expect(test.rows.get(empty.id)?.sourceAssetId).toBeNull();
  });
});
