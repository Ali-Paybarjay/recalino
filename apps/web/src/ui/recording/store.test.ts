import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { IndexedRecordingStore, type Recording } from "./store";

function manifest(userId: string): Recording {
  return {
    id: randomUUID(),
    userId,
    sessionId: null,
    mimeType: "audio/webm",
    status: "saved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeMs: 1,
    chunks: 0,
    bytes: 0,
    creationKey: randomUUID(),
    sourceAssetId: null,
  };
}

it("PRD-PRIV-01 clears the deleted owner atomically and rejects late writes from another tab", async () => {
  const store = new IndexedRecordingStore();
  const otherTab = new IndexedRecordingStore();
  const deleted = manifest(randomUUID());
  const kept = manifest(randomUUID());
  await store.put(deleted);
  await store.put(kept);
  await store.append(deleted, new Blob(["Synthetic audio"]));
  const photo = {
    id: randomUUID(),
    userId: deleted.userId,
    recordingId: deleted.id,
    offsetMs: 0,
    captureState: "recording" as const,
    blob: new Blob(["synthetic"], { type: "image/png" }),
    createdAt: new Date().toISOString(),
    sourceAssetId: null,
  };
  await store.savePhoto(photo);
  await otherTab.get(deleted.userId, deleted.id);
  await store.removeAccount(deleted.userId);
  expect(await store.list(deleted.userId)).toEqual([]);
  expect(await store.photos(deleted.userId, deleted.id)).toEqual([]);
  expect(await store.get(kept.userId, kept.id)).toEqual(kept);
  await expect(otherTab.put(deleted)).rejects.toThrow();
  await expect(otherTab.append(deleted, new Blob(["late"]))).rejects.toThrow();
  await expect(otherTab.savePhoto(photo)).rejects.toThrow();
  expect(await store.list(deleted.userId)).toEqual([]);
  await store.removeAccount(deleted.userId);
});
