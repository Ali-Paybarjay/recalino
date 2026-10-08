import type { InputContract } from "@recalino/core/src";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexedUploadStore, type UploadBatch } from "./upload-store";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
function batch(userId: string): UploadBatch {
  return {
    id: "shared-batch-id",
    userId,
    sessionId: "class",
    contract: {} as InputContract,
    storageConfigured: true,
    createdAt: 1,
    phase: "queued",
    entries: [
      {
        id: "file",
        displayName: "notes.txt",
        sizeBytes: 3,
        lastModified: 1,
        mimeType: "text/plain",
        creationKey: "stable-key",
        phase: "queued",
        sentBytes: 0,
        startedAt: 1,
        serverSeen: false,
      },
    ],
    receipt: {
      revision: null,
      previousRunId: null,
      sourceIds: [],
      total: 1,
      failed: 0,
      startedAt: 1,
    },
  };
}
it("commits source operation keys and original bytes together and reads them from a fresh store", async () => {
  const store = new IndexedUploadStore();
  const saved = batch("owner");
  await store.save(saved, [{ id: "file", blob: new Blob(["one"], { type: "text/plain" }) }]);
  const restored = new IndexedUploadStore();
  expect(await restored.list("owner")).toEqual([saved]);
  expect(await (await restored.file("owner", saved.id, "file"))?.text()).toBe("one");
  await restored.save({ ...saved, phase: "attention" });
  expect(await (await restored.file("owner", saved.id, "file"))?.text()).toBe("one");
});
it("isolates identical batch and file IDs between accounts and removes only the requested file", async () => {
  const store = new IndexedUploadStore();
  await store.save(batch("one"), [{ id: "file", blob: new Blob(["one"]) }]);
  await store.save(batch("two"), [{ id: "file", blob: new Blob(["two"]) }]);
  expect((await store.list("one")).map((row) => row.userId)).toEqual(["one"]);
  expect(await store.list("stranger")).toEqual([]);
  expect(await store.file("stranger", "shared-batch-id", "file")).toBeNull();
  await store.removeFile("one", "shared-batch-id", "file");
  expect(await store.file("one", "shared-batch-id", "file")).toBeNull();
  expect(await (await store.file("two", "shared-batch-id", "file"))?.text()).toBe("two");
});
it("atomically deletes account bytes and batches and fences a stale tab's late save", async () => {
  const store = new IndexedUploadStore();
  const staleTab = new IndexedUploadStore();
  const removed = batch("removed");
  await store.save(removed, [{ id: "file", blob: new Blob(["secret"]) }]);
  await store.save(batch("kept"), [{ id: "file", blob: new Blob(["kept"]) }]);
  const stale = (await staleTab.list("removed"))[0];
  expect(stale).toBeDefined();
  await store.removeAccount("removed");
  expect(await store.list("removed")).toEqual([]);
  expect(await store.file("removed", removed.id, "file")).toBeNull();
  await expect(
    staleTab.save(removed, [{ id: "file", blob: new Blob(["late"]) }]),
  ).rejects.toThrow();
  expect(await store.list("removed")).toEqual([]);
  expect(await (await store.file("kept", removed.id, "file"))?.text()).toBe("kept");
});
