import type { InputContract } from "@recalino/core/src";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RecordingStore } from "../recording/store";
import { WorkspaceRequestError, type workspaceRequest } from "./api";
import type { SourceRow } from "./source-types";
import { UploadManager } from "./upload-manager";
import { IndexedUploadStore, type UploadBatch } from "./upload-store";

vi.mock("./automatic-learning", () => ({ notifyAutomaticLearning: vi.fn() }));
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
type Dependencies = NonNullable<ConstructorParameters<typeof UploadManager>[3]>;
const contract = {} as InputContract;
function first(manager: UploadManager): UploadBatch {
  const batch = manager.snapshot()[0];
  if (!batch) throw new Error("Expected a saved test batch");
  return batch;
}
function selected(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index}`,
    file: new File([`material ${index}`], `notes-${index}.txt`, {
      type: "text/plain",
      lastModified: 100,
    }),
  }));
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Dependencies = {}) {
  const store = new IndexedUploadStore();
  const request = vi.fn(
    async (): Promise<{ revision: number; run: null; state: string; batchId: string | null }> => ({
      revision: 5,
      run: null,
      state: "processing",
      batchId: null,
    }),
  );
  const upload = vi.fn<NonNullable<Dependencies["upload"]>>(async (_batch, entry, _blob, deps) => {
    await deps.patch({ phase: "verifying", registered: true }, true);
    return `asset-${entry.id}`;
  });
  const manager = new UploadManager("owner", store, {} as RecordingStore, {
    request: request as typeof workspaceRequest,
    upload,
    allowed: () => true,
    ...overrides,
  });
  const kickoff = vi.spyOn(manager, "kick").mockResolvedValue();
  return {
    manager,
    store,
    request,
    upload,
    allow: () => kickoff.mockRestore(),
  };
}
function completions(request: ReturnType<typeof setup>["request"]) {
  return vi
    .mocked(request as typeof workspaceRequest)
    .mock.calls.filter(
      (call) =>
        call[1] === "POST" && (call[2] as { action?: string } | undefined)?.action === "complete",
    );
}
function source(assetId: string): SourceRow {
  return {
    assetId,
    displayName: `${assetId}.pdf`,
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    durationMs: null,
    pageCount: 1,
    verifiedAt: null,
    originalDeletedAt: null,
    selected: false,
    role: "class_material",
    ranges: [],
    timeStatus: "unknown",
    contentVersionId: null,
    uploadId: `upload-${assetId}`,
    uploadState: "rejected",
    rejectionReason: "needs_password",
    anchorSourceId: null,
    captureOffsetMs: null,
    captureState: null,
  };
}
async function received(count = 2) {
  const f = setup({ lock: async (_name, effect) => effect() });
  await f.manager.enqueue("class", selected(count), contract, true);
  const batch = structuredClone(first(f.manager));
  batch.phase = "received";
  batch.opened = true;
  batch.entries = batch.entries.map((entry) => ({
    ...entry,
    phase: "verifying",
    source: source(`asset-${entry.id}`),
  }));
  batch.receipt.sourceIds = batch.entries.map((entry) => entry.source?.assetId ?? "");
  await f.store.save(batch);
  for (const entry of batch.entries) await f.store.removeFile("owner", batch.id, entry.id);
  await f.manager.restore();
  f.allow();
  f.request.mockImplementation(async () => ({
    revision: 7,
    run: null,
    state: "waiting_sources",
    batchId: batch.id,
  }));
  return { ...f, batch };
}

it("saves every byte and stable source key before the first network request", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(2), contract, true);
  const saved = first(f.manager);
  expect(f.request).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();
  f.request.mockImplementation(async () => {
    const disk = (await f.store.list("owner"))[0];
    expect(disk?.id).toBe(saved.id);
    expect(disk?.entries.map((entry) => entry.creationKey)).toEqual(
      saved.entries.map((entry) => entry.creationKey),
    );
    // Both originals exist when begin is sent. Later requests may follow their removal.
    if (!disk?.opened)
      for (const entry of saved.entries)
        expect(await (await f.store.file("owner", saved.id, entry.id))?.text()).toBe(
          `material ${entry.id.slice(-1)}`,
        );
    return { revision: 5, run: null, state: "processing", batchId: null };
  });
  f.allow();
  await f.manager.kick();
  expect(first(f.manager).phase).toBe("received");
  expect(f.upload).toHaveBeenCalledTimes(2);
});

it("restores a restart and skips already confirmed files while preserving creation keys", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(2), contract, true);
  const saved = structuredClone(first(f.manager));
  saved.opened = true;
  const confirmed = saved.entries[0],
    remaining = saved.entries[1];
  if (!confirmed || !remaining) throw new Error("Expected two files");
  confirmed.phase = "verifying";
  saved.receipt.sourceIds = ["asset-file-0"];
  await f.store.save(saved);
  await f.store.removeFile("owner", saved.id, confirmed.id);
  f.manager.dispose();
  const restored = new UploadManager("owner", f.store, {} as RecordingStore, {
    request: f.request as typeof workspaceRequest,
    upload: f.upload,
  });
  await restored.restore();
  await restored.kick();
  expect(f.upload).toHaveBeenCalledOnce();
  expect(f.upload.mock.calls[0]?.[1]).toMatchObject({
    id: remaining.id,
    creationKey: remaining.creationKey,
  });
  expect(first(restored).phase).toBe("received");
  expect(first(restored).receipt.sourceIds).toEqual(["asset-file-0", "asset-file-1"]);
  expect(await f.store.file("owner", saved.id, remaining.id)).toBeNull();
});

it("keeps failed bytes and the batch open, then retries only the failure with the same IDs", async () => {
  const f = setup();
  f.upload.mockImplementationOnce(async () => {
    throw new Error("offline");
  });
  await f.manager.enqueue("class", selected(2), contract, true);
  const saved = structuredClone(first(f.manager));
  f.allow();
  await f.manager.kick();
  expect(first(f.manager).phase).toBe("attention");
  expect(first(f.manager).receipt.failed).toBe(1);
  expect(completions(f.request)).toHaveLength(0);
  expect(await (await f.store.file("owner", saved.id, "file-0"))?.text()).toBe("material 0");
  expect(await f.store.file("owner", saved.id, "file-1")).toBeNull();
  await f.manager.retry(saved.id, "file-0");
  expect(f.upload).toHaveBeenCalledTimes(3);
  expect(f.upload.mock.calls[2]?.[0].id).toBe(saved.id);
  expect(f.upload.mock.calls[2]?.[1]).toMatchObject({
    id: "file-0",
    creationKey: saved.entries[0]?.creationKey,
  });
  expect(first(f.manager).phase).toBe("received");
  expect(completions(f.request)).toHaveLength(0);
});

it("continues an active transfer after its page subscription is removed", async () => {
  const gate = deferred();
  const started = deferred();
  const f = setup({
    upload: async (_batch, entry, _blob, deps) => {
      started.resolve();
      await gate.promise;
      expect(deps.recovery.signal?.aborted).toBe(false);
      await deps.patch({ phase: "verifying" }, true);
      return `asset-${entry.id}`;
    },
  });
  const listener = vi.fn();
  const unsubscribe = f.manager.subscribe(listener);
  await f.manager.enqueue("class", selected(), contract, true);
  f.allow();
  const run = f.manager.kick();
  await started.promise;
  unsubscribe();
  const before = listener.mock.calls.length;
  gate.resolve();
  await run;
  expect(first(f.manager).phase).toBe("received");
  expect(listener).toHaveBeenCalledTimes(before);
  expect(completions(f.request)).toHaveLength(0);
});

it("reloads a competing tab's terminal checkpoint under the lock and updates the stale snapshot", async () => {
  let store: IndexedUploadStore;
  const f = setup({
    lock: async (_name, effect) => {
      const [saved] = await store.list("owner");
      if (!saved) throw new Error("Missing test batch");
      await store.save({ ...saved, phase: "received" });
      await effect();
    },
  });
  store = f.store;
  await f.manager.enqueue("class", selected(), contract, true);
  f.allow();
  await f.manager.kick();
  expect(f.request).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();
  expect(first(f.manager).phase).toBe("received");
});

it("does not start network work after logout while waiting for another tab's lock", async () => {
  const gate = deferred(),
    acquired = deferred();
  const f = setup({
    lock: async (_name, effect) => {
      acquired.resolve();
      await gate.promise;
      await effect();
    },
  });
  await f.manager.enqueue("class", selected(), contract, true);
  f.allow();
  const run = f.manager.kick();
  await acquired.promise;
  f.manager.dispose();
  gate.resolve();
  await run;
  expect(f.request).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();
});

it.each(["retry", "skip"] as const)(
  "does not overwrite another tab's completed batch from a stale %s action",
  async (action) => {
    const f = setup({ lock: async (_name, effect) => effect() });
    f.upload.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await f.manager.enqueue("class", selected(), contract, true);
    f.allow();
    await f.manager.kick();
    expect(first(f.manager).phase).toBe("attention");
    const [latest] = await f.store.list("owner");
    if (!latest) throw new Error("Expected saved batch");
    latest.phase = "received";
    latest.entries = latest.entries.map((entry) => ({ ...entry, phase: "verifying" }));
    await f.store.save(latest);
    await f.store.removeFile("owner", latest.id, "file-0");
    const before = f.request.mock.calls.length;
    if (action === "retry") await f.manager.retry(latest.id, "file-0");
    else await f.manager.skip(latest.id, "file-0");
    expect(first(f.manager).phase).toBe("received");
    expect((await f.store.list("owner"))[0]?.phase).toBe("received");
    expect(f.request).toHaveBeenCalledTimes(before + (action === "skip" ? 1 : 0));
    expect(
      vi
        .mocked(f.request as typeof workspaceRequest)
        .mock.calls.slice(before)
        .every((call) => call[1] === "GET"),
    ).toBe(true);
    expect(f.upload).toHaveBeenCalledOnce();
  },
);

it("marks durable handoff received while server verification remains pending without prematurely sealing", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  f.request.mockImplementation(async () => ({
    revision: 7,
    run: null,
    state: "waiting_sources",
    batchId: first(f.manager).id,
  }));
  f.allow();
  await f.manager.kick();
  expect(first(f.manager)).toMatchObject({
    phase: "received",
    receipt: { revision: 7, failed: 0 },
  });
  expect(first(f.manager).entries[0]?.phase).toBe("verifying");
  expect(completions(f.request)).toHaveLength(0);
});

it("retains the begin revision and durable receipt when the optional status refresh fails", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  // The first read is required before opening the batch. Only the final refresh is optional.
  f.request.mockReset();
  f.request
    .mockResolvedValueOnce({ revision: 4, run: null, state: "processing", batchId: null })
    .mockResolvedValueOnce({ revision: 5, run: null, state: "processing", batchId: null })
    .mockRejectedValue(
      new WorkspaceRequestError("status unavailable", "validation_failed", undefined, 400),
    );
  f.allow();
  await f.manager.kick();
  expect(first(f.manager)).toMatchObject({
    phase: "received",
    receipt: { revision: 5, failed: 0 },
  });
  expect(await f.store.file("owner", first(f.manager).id, "file-0")).toBeNull();
});

it("explicitly skips only a failed file, keeps successful transfers and hands the remaining batch to verification", async () => {
  const f = setup({ lock: async (_name, effect) => effect() });
  f.upload.mockImplementationOnce(async () => {
    throw new Error("offline");
  });
  await f.manager.enqueue("class", selected(2), contract, true);
  f.allow();
  await f.manager.kick();
  const batchId = first(f.manager).id;
  await f.manager.skip(batchId, "file-0");
  expect(first(f.manager).phase).toBe("received");
  expect(first(f.manager).entries.map((entry) => entry.phase)).toEqual(["skipped", "verifying"]);
  expect(first(f.manager).receipt).toMatchObject({ failed: 0, sourceIds: ["asset-file-1"] });
  expect(f.upload).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(f.request as typeof workspaceRequest)
      .mock.calls.some(
        (call) => (call[2] as { action?: string } | undefined)?.action === "skip_file",
      ),
  ).toBe(true);
  expect(await f.store.file("owner", batchId, "file-0")).toBeNull();
  expect(completions(f.request)).toHaveLength(0);
});

it("enforces the declared class file limit before saving or making requests", async () => {
  const f = setup();
  await expect(
    f.manager.enqueue("class", selected(2), { ...contract, maxSourcesPerSession: 1 }, true),
  ).rejects.toThrow("class file limit");
  expect(await f.store.list("owner")).toEqual([]);
  expect(f.request).not.toHaveBeenCalled();
});

it("reports a background checkpoint read failure without an unhandled rejection", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  vi.spyOn(f.store, "list").mockRejectedValueOnce(new Error("Device storage unavailable"));
  f.allow();
  await expect(f.manager.kick()).resolves.toBeUndefined();
  expect(first(f.manager)).toMatchObject({
    phase: "attention",
    problem: "Device storage unavailable",
  });
  expect(f.request).not.toHaveBeenCalled();
});

it("resumes after a mount pause that interrupted an active transfer without losing the restart request", async () => {
  const started = deferred();
  let calls = 0;
  const f = setup({
    upload: async (_batch, entry, _blob, deps) => {
      calls++;
      if (calls === 1) {
        started.resolve();
        await new Promise<void>((_resolve, reject) => {
          deps.recovery.signal?.addEventListener(
            "abort",
            () => reject(deps.recovery.signal?.reason),
            { once: true },
          );
        });
      }
      await deps.patch({ phase: "verifying" }, true);
      return `asset-${entry.id}`;
    },
  });
  await f.manager.enqueue("class", selected(), contract, true);
  f.allow();
  const run = f.manager.kick();
  await started.promise;
  f.manager.pause();
  f.manager.resume();
  await run;
  await vi.waitFor(() => expect(first(f.manager).phase).toBe("received"));
  expect(calls).toBe(2);
  expect(first(f.manager).receipt.sourceIds).toEqual(["asset-file-0"]);
});

it("drains an interrupted active writer before cancellation and permits a new class batch", async () => {
  const started = deferred();
  let drained = false;
  const f = setup({
    upload: async (_batch, _entry, _blob, deps) => {
      started.resolve();
      try {
        await new Promise<void>((_resolve, reject) => {
          deps.recovery.signal?.addEventListener(
            "abort",
            () => reject(deps.recovery.signal?.reason),
            { once: true },
          );
        });
      } finally {
        drained = true;
      }
      return "unexpected";
    },
  });
  await f.manager.enqueue("class", selected(), contract, true);
  const batchId = first(f.manager).id;
  f.request.mockImplementation(async (...args: unknown[]) => {
    if ((args[2] as { action?: string } | undefined)?.action === "cancel_batch")
      expect(drained).toBe(true);
    return { revision: 5, run: null, state: "processing", batchId: null };
  });
  f.allow();
  const run = f.manager.kick();
  await started.promise;
  await f.manager.cancel(batchId);
  await run;
  expect(first(f.manager).phase).toBe("cancelled");
  expect((await f.store.list("owner"))[0]?.phase).toBe("cancelled");
  expect(await f.store.file("owner", batchId, "file-0")).toBeNull();
  expect(
    vi
      .mocked(f.request as typeof workspaceRequest)
      .mock.calls.some(
        (call) => (call[2] as { action?: string } | undefined)?.action === "cancel_batch",
      ),
  ).toBe(true);
  f.manager.pause();
  await expect(f.manager.enqueue("class", selected(), contract, true)).resolves.toBeUndefined();
  expect(f.manager.snapshot()).toHaveLength(2);
});

it("keeps local originals when server cancellation is rejected", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  f.request.mockRejectedValue(
    new WorkspaceRequestError("Cancellation needs attention", "validation_failed", undefined, 400),
  );
  f.allow();
  await f.manager.cancel(first(f.manager).id);
  expect(first(f.manager)).toMatchObject({
    phase: "attention",
    problem: "Cancellation needs attention",
  });
  expect(await (await f.store.file("owner", first(f.manager).id, "file-0"))?.text()).toBe(
    "material 0",
  );
});

it("replays begin with the saved batch and file IDs before cancelling an unacknowledged declaration", async () => {
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  const savedBatch = first(f.manager);
  f.allow();
  await f.manager.cancel(savedBatch.id);
  expect(vi.mocked(f.request as typeof workspaceRequest).mock.calls.map((call) => call[2])).toEqual(
    [
      { action: "begin", batchId: savedBatch.id, expectedFileIds: ["file-0"] },
      { action: "cancel_batch", batchId: savedBatch.id },
    ],
  );
  expect(first(f.manager).phase).toBe("cancelled");
  expect(f.upload).not.toHaveBeenCalled();
});

it("preserves a newer mount pause while server cancellation is still pending", async () => {
  const pending = deferred();
  const f = setup();
  await f.manager.enqueue("class", selected(), contract, true);
  f.request.mockImplementation(async (...args: unknown[]) => {
    if ((args[2] as { action?: string } | undefined)?.action === "cancel_batch") {
      const signal = (args[4] as { signal: AbortSignal }).signal;
      pending.resolve();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }
    return { revision: 5, run: null, state: "processing", batchId: null };
  });
  f.allow();
  const cancel = f.manager.cancel(first(f.manager).id);
  await pending.promise;
  f.manager.pause();
  await cancel;
  const before = f.request.mock.calls.length;
  await f.manager.kick();
  expect(f.request).toHaveBeenCalledTimes(before);
  expect(f.upload).not.toHaveBeenCalled();
  expect(await f.store.file("owner", first(f.manager).id, "file-0")).not.toBeNull();
});

it("skips a rejected declaration after durable handoff only while the server batch remains open", async () => {
  const f = await received();
  expect(await f.manager.skip(f.batch.id, "file-0")).toBe(true);
  expect(
    vi.mocked(f.request as typeof workspaceRequest).mock.calls.map((call) => [call[1], call[2]]),
  ).toEqual([
    ["GET", undefined],
    ["POST", { action: "skip_file", batchId: f.batch.id, fileId: "file-0" }],
  ]);
  expect(first(f.manager)).toMatchObject({
    phase: "received",
    receipt: { total: 1, sourceIds: ["asset-file-1"], failed: 0 },
  });
  expect(first(f.manager).entries[0]?.phase).toBe("skipped");
  expect((await f.store.list("owner"))[0]?.receipt.sourceIds).toEqual(["asset-file-1"]);
  expect(f.upload).not.toHaveBeenCalled();
});

it("offers cancellation when the last rejected declaration cannot be skipped", async () => {
  const f = await received(1);
  f.request.mockImplementation(async (...args: unknown[]) => {
    if (args[1] === "POST")
      throw new WorkspaceRequestError("Invalid batch", "validation_failed", undefined, 400, {
        batch: ["select_at_least_one"],
      });
    return { revision: 7, run: null, state: "waiting_sources", batchId: f.batch.id };
  });
  expect(await f.manager.skip(f.batch.id, "file-0")).toBe(false);
  expect(first(f.manager).phase).toBe("received");
  expect(first(f.manager).problem).toContain("Cancel this saved upload");
  expect(first(f.manager).receipt.sourceIds).toEqual(["asset-file-0"]);
  expect(first(f.manager).entries[0]?.phase).toBe("verifying");
  expect(f.upload).not.toHaveBeenCalled();
});

it("cancels an open verification group after durable handoff without recreating its sources", async () => {
  const f = await received(1);
  await f.manager.cancel(f.batch.id);
  expect(first(f.manager).phase).toBe("cancelled");
  expect(
    vi.mocked(f.request as typeof workspaceRequest).mock.calls.map((call) => [call[1], call[2]]),
  ).toEqual([
    ["GET", undefined],
    ["POST", { action: "cancel_batch", batchId: f.batch.id }],
  ]);
  expect(f.upload).not.toHaveBeenCalled();
});

it.each(["skip", "cancel"] as const)(
  "leaves a sealed processing group intact during stale %s",
  async (action) => {
    const f = await received(1);
    f.request.mockResolvedValue({ revision: 8, run: null, state: "processing", batchId: null });
    if (action === "skip") expect(await f.manager.skip(f.batch.id, "file-0")).toBe(false);
    else await f.manager.cancel(f.batch.id);
    expect(first(f.manager).phase).toBe("received");
    expect(first(f.manager).receipt.sourceIds).toEqual(["asset-file-0"]);
    expect(f.request).toHaveBeenCalledOnce();
    expect(vi.mocked(f.request as typeof workspaceRequest).mock.calls[0]?.[1]).toBe("GET");
    expect(f.upload).not.toHaveBeenCalled();
  },
);

it("does not retry transport or silently complete a received file whose local bytes are gone", async () => {
  const f = await received(1);
  await f.manager.retry(f.batch.id, "file-0");
  expect(first(f.manager).phase).toBe("received");
  expect(f.upload).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

it.each(["retry", "skip", "cancel"] as const)(
  "explains a denied account lease during explicit %s without changing saved checkpoints",
  async (action) => {
    const lock = vi.fn(async (_name: string, _effect: () => Promise<void>) => {});
    const f = setup({ lock });
    await f.manager.enqueue("class", selected(), contract, true);
    const batch = structuredClone(first(f.manager));
    batch.phase = "attention";
    const entry = batch.entries[0];
    if (!entry) throw new Error("Expected a saved file");
    entry.phase = "failed";
    entry.problem = "Offline";
    await f.store.save(batch);
    await f.manager.restore();
    f.allow();

    if (action === "cancel") await f.manager.cancel(batch.id);
    else await f.manager[action](batch.id, entry.id);

    expect(lock).toHaveBeenCalledOnce();
    expect(first(f.manager)).toMatchObject({
      phase: "attention",
      problem: "This upload is active in another tab. Cancel it there or close that tab and retry.",
    });
    expect((await f.store.list("owner"))[0]).toEqual(batch);
    expect(await (await f.store.file("owner", batch.id, entry.id))?.text()).toBe("material 0");
    expect(f.request).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  },
);

it("defers a background kick silently until the account lease becomes available", async () => {
  const lock = vi.fn(async (_name: string, _effect: () => Promise<void>) => {});
  const f = setup({ lock });
  await f.manager.enqueue("class", selected(), contract, true);
  f.allow();
  await f.manager.kick();
  expect(first(f.manager)).toMatchObject({ phase: "queued" });
  expect(first(f.manager).problem).toBeUndefined();
  expect(f.request).not.toHaveBeenCalled();
  expect(f.upload).not.toHaveBeenCalled();

  lock.mockImplementation(async (_name, effect) => effect());
  await f.manager.kick();
  expect(first(f.manager).phase).toBe("received");
  expect(f.upload).toHaveBeenCalledOnce();
});
