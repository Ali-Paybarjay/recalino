import { createHash } from "node:crypto";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RecordingStore } from "../recording/store";
import { WorkspaceRequestError, type workspaceRequest } from "./api";
import { ManualAudioManager } from "./manual-audio-manager";
import { IndexedManualAudioStore } from "./manual-audio-store";
import { UploadInterruptedError } from "./upload";
import { uploadCopy } from "./upload-copy";
import { AudioUploadProblem } from "./upload-problems";

const transport = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("./upload-progress", () => ({ uploadWithProgress: transport.upload }));

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
const run = {
  id: "confirmed-run",
  sessionId: "class",
  reservationId: "confirmed-reservation",
  state: "awaiting_upload",
} as ProcessingRun;
const snapshot = {
  sourcesVersion: 1,
  fingerprint: "confirmed-input",
  sources: [{ sourceId: "audio", kind: "audio", sha256: "confirmed-hash" }],
} as RunSnapshot;
const contract = { partBytes: 5 } as InputContract;
type Dependencies = NonNullable<ConstructorParameters<typeof ManualAudioManager>[3]>;
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Dependencies = {}) {
  const store = new IndexedManualAudioStore();
  const request = vi.fn(
    async (
      _path: string,
      method: string,
    ): Promise<{ run: ProcessingRun; snapshot: RunSnapshot | null } | ProcessingRun> =>
      method === "GET" ? { run, snapshot } : { ...run, state: "queued" },
  );
  const upload = vi.fn<NonNullable<Dependencies["upload"]>>(async () => {});
  const manager = new ManualAudioManager("owner", store, {} as RecordingStore, {
    request: request as typeof workspaceRequest,
    upload,
    allowed: () => true,
    ...overrides,
  });
  const kickoff = vi.spyOn(manager, "kick").mockResolvedValue();
  return { store, manager, request, upload, allow: () => kickoff.mockRestore() };
}

it("persists confirmed identity before transfer and survives page subscription removal without a new paid run", async () => {
  const gate = deferred(),
    started = deferred();
  const f = setup({
    upload: async (confirmed, input, _contract, options) => {
      expect(confirmed.id).toBe(run.id);
      expect(input).toEqual(snapshot);
      expect((await new IndexedManualAudioStore().list("owner"))[0]?.runId).toBe(run.id);
      started.resolve();
      await gate.promise;
      options.signal?.throwIfAborted();
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  expect(f.request).not.toHaveBeenCalled();
  const pageLeft = f.manager.subscribe(() => {});
  f.allow();
  const upload = f.manager.kick();
  await started.promise;
  pageLeft(); // A ProcessingView unmount removes only its subscription, never this controller.
  gate.resolve();
  await upload;
  expect(await f.store.list("owner")).toEqual([]);
  expect(
    f.request.mock.calls.every(
      ([path, method]) =>
        path.startsWith(`/api/runs/${run.id}`) && ["GET", "POST"].includes(method),
    ),
  ).toBe(true);
  expect(f.request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
});

it("restores after a restart, uses the authoritative immutable input and skips a run activated by another tab", async () => {
  const f = setup();
  await f.manager.enqueue(run, snapshot, contract);
  const authoritative = { ...snapshot, fingerprint: "server-confirmed-input" };
  const upload = vi.fn<NonNullable<Dependencies["upload"]>>(async (_run, input) =>
    expect(input).toEqual(authoritative),
  );
  const request = vi.fn(
    async (
      _path: string,
      method: string,
    ): Promise<{ run: ProcessingRun; snapshot: RunSnapshot | null } | ProcessingRun> =>
      method === "GET" ? { run, snapshot: authoritative } : { ...run, state: "queued" },
  );
  const restored = new ManualAudioManager(
    "owner",
    new IndexedManualAudioStore(),
    {} as RecordingStore,
    { request: request as typeof workspaceRequest, upload },
  );
  await restored.restore();
  await restored.kick();
  expect(upload).toHaveBeenCalledOnce();
  expect(restored.snapshot()).toEqual([]);
  const nextRun = { ...run, id: "another-confirmed-run" };
  await f.manager.enqueue(nextRun, snapshot, contract);
  request.mockResolvedValue({ run: { ...nextRun, state: "queued" }, snapshot: null } as never);
  await restored.restore();
  await restored.kick();
  expect(upload).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
});

it("remains verifiable after reload without resending audio and waits for the existing server activation", async () => {
  const f = setup();
  f.request.mockImplementation(async (_path, method) => {
    if (method === "POST")
      throw new WorkspaceRequestError("Not verified", "validation_failed", undefined, 400, {
        upload: ["incomplete"],
      });
    return { run, snapshot };
  });
  await f.manager.enqueue(run, snapshot, contract);
  f.allow();
  await f.manager.kick();
  expect(f.manager.snapshot()[0]?.phase).toBe("verifying");
  const secondUpload = vi.fn<NonNullable<Dependencies["upload"]>>(async () => {});
  const restored = new ManualAudioManager(
    "owner",
    new IndexedManualAudioStore(),
    {} as RecordingStore,
    {
      request: f.request as typeof workspaceRequest,
      upload: secondUpload,
    },
  );
  await restored.restore();
  await restored.kick();
  expect(secondUpload).not.toHaveBeenCalled();
  f.request.mockResolvedValue({ ...run, state: "queued" } as never);
  f.request.mockImplementation(async (_path, method) =>
    method === "GET"
      ? { run: { ...run, state: "queued" }, snapshot: null }
      : { ...run, state: "queued" },
  );
  await restored.kick();
  expect(restored.snapshot()).toEqual([]);
});

it("pauses capture safely and resumes the same confirmed run after stopping", async () => {
  const gate = deferred(),
    started = deferred();
  let allowed = true;
  const f = setup({
    allowed: () => allowed,
    upload: async (_run, _snapshot, _contract, options) => {
      started.resolve();
      await gate.promise;
      options.signal?.throwIfAborted();
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  f.allow();
  const working = f.manager.kick();
  await started.promise;
  allowed = false;
  f.manager.pause();
  gate.resolve();
  await working;
  expect(f.manager.snapshot()[0]?.phase).toBe("queued");
  allowed = true;
  f.manager.resume();
  await f.manager.kick();
  expect(f.manager.snapshot()).toEqual([]);
});
it("requires explicit retry for a missing original and keeps its confirmed run", async () => {
  const error = setup({
    upload: async () => {
      throw new Error("Original is missing on this device.");
    },
  });
  await error.manager.enqueue(run, snapshot, contract);
  error.allow();
  await error.manager.kick();
  expect(error.manager.snapshot()[0]?.phase).toBe("attention");
  await error.manager.kick();
  expect(error.manager.snapshot()[0]?.problem).toContain("Original is missing");
});

it("keeps an attention checkpoint until its retry obtains the shared class lease", async () => {
  const lease = deferred(),
    waiting = deferred();
  const f = setup({
    lock: async (name, effect) => {
      expect(name).toBe("recalino-learning:owner:class");
      waiting.resolve();
      await lease.promise;
      await effect();
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  const entry = (await f.store.list("owner"))[0];
  if (!entry) throw new Error("Expected durable transfer");
  await f.store.put({ ...entry, phase: "attention", problem: "Transient original recovery" });
  await f.manager.restore();
  const retry = f.manager.retry(run.id);
  await waiting.promise;
  expect((await f.store.get("owner", run.id))?.phase).toBe("attention");
  expect(f.request).not.toHaveBeenCalled();
  lease.resolve();
  await retry;
  expect((await f.store.get("owner", run.id))?.phase).toBe("queued");
  expect((await f.store.get("owner", run.id))?.problem).toBeNull();
});

it("wipes only the requested account and rejects a stale tab that writes after deletion", async () => {
  const f = setup();
  await f.manager.enqueue(run, snapshot, contract);
  const row = (await f.store.list("owner"))[0];
  if (!row) throw new Error("Expected durable transfer");
  await f.store.put({ ...row, userId: "other" });
  await f.store.removeAccount("owner");
  expect(await f.store.list("owner")).toEqual([]);
  expect(await f.store.list("other")).toHaveLength(1);
  await expect(new IndexedManualAudioStore().put(row)).rejects.toThrow();
});

it("reloads under the class lock so a stale tab cannot overwrite verification or re-upload a completed run", async () => {
  const gate = deferred(),
    started = deferred();
  let held = false;
  const lock: NonNullable<Dependencies["lock"]> = async (name, effect) => {
    expect(name).toBe("recalino-learning:owner:class");
    if (held) return;
    held = true;
    try {
      await effect();
    } finally {
      held = false;
    }
  };
  const first = setup({
    lock,
    upload: async () => {
      started.resolve();
      await gate.promise;
    },
  });
  await first.manager.enqueue(run, snapshot, contract);
  first.allow();
  const moving = first.manager.kick();
  await started.promise;
  const second = setup({ lock });
  await second.manager.enqueue(run, snapshot, contract);
  expect((await first.store.list("owner"))[0]?.phase).toBe("uploading");
  second.allow();
  await second.manager.kick();
  expect(second.request).not.toHaveBeenCalled();
  gate.resolve();
  await moving;
  await second.manager.kick();
  expect(second.request).not.toHaveBeenCalled();
  expect(second.upload).not.toHaveBeenCalled();
  expect(second.manager.snapshot()).toEqual([]);
});

it("a settlement fence prevents late progress and writes from resurrecting a cancelled transfer", async () => {
  const gate = deferred(),
    started = deferred();
  const f = setup({
    upload: async (_run, _snapshot, _contract, options) => {
      started.resolve();
      await gate.promise;
      options.onProgress?.("Stale progress after cancellation");
      options.signal?.throwIfAborted();
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  const stale = (await f.store.list("owner"))[0];
  if (!stale) throw new Error("Expected pending transfer");
  f.allow();
  const moving = f.manager.kick();
  await started.promise;
  await f.manager.forget(run.id);
  gate.resolve();
  await moving;
  expect(f.manager.snapshot()).toEqual([]);
  expect(await f.store.list("owner")).toEqual([]);
  await expect(f.store.put(stale)).rejects.toThrow();
});
it("retains the confirmed upload when cancellation acknowledgement fails, then fences it after success", async () => {
  const f = setup();
  await f.manager.enqueue(run, snapshot, contract);
  f.request.mockImplementation(async (_path, method) => {
    if (method === "DELETE") throw new TypeError("Cancellation response was interrupted");
    return { run, snapshot };
  });
  await expect(f.manager.cancel(run.id)).rejects.toThrow("Cancellation response was interrupted");
  expect((await f.store.list("owner"))[0]?.runId).toBe(run.id);
  f.request.mockResolvedValue({ ...run, state: "cancelled" });
  expect((await f.manager.cancel(run.id)).state).toBe("cancelled");
  expect(await f.store.list("owner")).toEqual([]);
});

it("does no work after a lock-delayed account deletion and preserves a lost activation acknowledgement", async () => {
  const gate = deferred();
  const f = setup({
    lock: async (_name, effect) => {
      await gate.promise;
      await effect();
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  f.allow();
  const pending = f.manager.kick();
  f.manager.pause();
  await f.store.removeAccount("owner");
  gate.resolve();
  await pending;
  expect(f.request).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();
  // A different account represents an independent confirmed attempt on the same test device.
  const store = new IndexedManualAudioStore();
  const request = vi.fn(async (_path: string, method: string) => {
    if (method === "POST") throw new TypeError("Lost activation acknowledgement");
    return { run, snapshot };
  });
  const manager = new ManualAudioManager("other", store, {} as RecordingStore, {
    request: request as typeof workspaceRequest,
    upload: async () => {},
  });
  manager.pause();
  await manager.enqueue(run, snapshot, contract);
  manager.resume();
  await manager.kick();
  expect((await store.list("other"))[0]?.phase).toBe("verifying");
  expect(manager.snapshot()).toHaveLength(1);
});

it("D59: the saved queue uploads, completes and activates a confirmed run whose hold reserved no audio seconds", async () => {
  // The client never reads reservation amounts; the confirmed run and its open hold are enough.
  const bytes = new Blob(["abcd"]);
  const d59Snapshot = {
    ...snapshot,
    sources: [
      {
        sourceId: "audio",
        kind: "audio",
        mimeType: "audio/webm",
        sha256: createHash("sha256").update("abcd").digest("hex"),
        objectId: null,
        contentVersionId: null,
      },
    ],
  } as RunSnapshot;
  const recordings = {
    list: async () => [{ id: "local", sourceAssetId: "audio", bytes: 4 }],
    blob: async () => bytes,
  } as unknown as RecordingStore;
  const written = new Set<number>();
  transport.upload.mockImplementation(async (url: string) => {
    written.add(Number(url.split("/").at(-1)));
    return { ok: true, status: 200 };
  });
  const request = vi.fn(async (path: string, method: string, body?: Record<string, unknown>) => {
    if (path.startsWith("/api/runs/"))
      return method === "GET" ? { run, snapshot: d59Snapshot } : { ...run, state: "queued" };
    if (body?.action === "start") return { uploadId: "upload" };
    if (body?.action === "confirm_part") return { confirmed: written.has(Number(body.index)) };
    if (body?.action === "complete") return { state: "pending" };
    const index = /index=(\d+)/.exec(path)?.[1];
    return index === undefined
      ? { state: "pending", parts: [] }
      : { url: `https://storage.example.test/${index}` };
  });
  const store = new IndexedManualAudioStore();
  const manager = new ManualAudioManager("owner", store, recordings, {
    request: request as unknown as typeof workspaceRequest,
    allowed: () => true,
  });
  const kickoff = vi.spyOn(manager, "kick").mockResolvedValue();
  await manager.enqueue(run, d59Snapshot, contract);
  kickoff.mockRestore();
  await manager.kick();
  expect(manager.snapshot()).toEqual([]);
  expect(await store.list("owner")).toEqual([]);
  expect(request.mock.calls.map(([, , body]) => body?.action).filter(Boolean)).toEqual([
    "start",
    "confirm_part",
    "confirm_part",
    "complete",
    "activate",
  ]);
  expect(written).toEqual(new Set([0]));
});

it("does not offer a retry that cannot succeed after the server closed the upload", async () => {
  const f = setup({
    upload: async () => {
      throw new AudioUploadProblem("upload_closed", uploadCopy.audio.uploadClosed);
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  f.allow();
  await f.manager.kick();
  expect(f.manager.snapshot()[0]).toMatchObject({
    phase: "attention",
    reason: "upload_closed",
    problem: uploadCopy.audio.uploadClosed,
  });
  await f.manager.retry(run.id);
  expect(f.manager.snapshot()[0]?.phase).toBe("attention");
  expect((await f.store.get("owner", run.id))?.reason).toBe("upload_closed");
});

it.each(["timeout", "rate_limited", "offline"] as const)(
  "reads the %s cause of an interrupted upload without saving it or changing the learner's words",
  async (cause) => {
    const message = "Audio upload was interrupted. The original is saved on this device.";
    let fail = true;
    const f = setup({
      upload: async () => {
        if (fail) throw new UploadInterruptedError(message, cause);
      },
    });
    await f.manager.enqueue(run, snapshot, contract);
    f.allow();
    expect(f.manager.interruptionCause(run.id)).toBeNull();
    await f.manager.kick();
    expect(f.manager.interruptionCause(run.id)).toBe(cause);
    expect(f.manager.snapshot()[0]).toMatchObject({ phase: "queued", problem: message });
    const saved = await f.store.get("owner", run.id);
    expect(saved).toMatchObject({ problem: message, reason: null });
    expect(JSON.stringify(saved)).not.toContain(cause);
    fail = false;
    await f.manager.kick();
    expect(f.manager.interruptionCause(run.id)).toBeNull();
    expect(await f.store.list("owner")).toEqual([]);
  },
);

it("keeps Retry for an unclassified stop and clears its reason when retried", async () => {
  let fail = true;
  const f = setup({
    upload: async () => {
      if (fail) throw new Error("Unclassified local problem");
    },
  });
  await f.manager.enqueue(run, snapshot, contract);
  f.allow();
  await f.manager.kick();
  expect(f.manager.snapshot()[0]).toMatchObject({ phase: "attention", reason: "unknown" });
  fail = false;
  await f.manager.retry(run.id);
  expect(await f.store.list("owner")).toEqual([]);
});
