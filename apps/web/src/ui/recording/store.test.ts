import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { IndexedRecordingStore, type Recording, type RegistrationPatch } from "./store";

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
  await expect(
    otherTab.updateRegistration(deleted.userId, deleted.id, {
      sessionId: randomUUID(),
      sourceAssetId: randomUUID(),
    }),
  ).rejects.toThrow();
  await expect(otherTab.savePhoto(photo)).rejects.toThrow();
  expect(await store.list(deleted.userId)).toEqual([]);
  await store.removeAccount(deleted.userId);
});

it.each(["append first", "registration first"] as const)(
  "merges registration against pending audio transactions (%s)",
  async (order) => {
    const store = new IndexedRecordingStore();
    const otherTab = new IndexedRecordingStore();
    const row: Recording = {
      ...manifest(randomUUID()),
      captureId: randomUUID(),
      segment: 2,
      awaitingFinalData: false,
      autoRegister: false,
      activeMs: 2500,
      syncError: "Upload awaiting acknowledgement",
    };
    const completedAt = new Date().toISOString();
    await store.put({ ...row, completedAt, autoRegister: true });
    await otherTab.get(row.userId, row.id);
    const sessionId = randomUUID();
    const sourceAssetId = randomUUID();
    const register = () =>
      otherTab.updateRegistration(row.userId, row.id, {
        sessionId,
        sourceAssetId,
        syncError: null,
      });
    const append = () => store.append(row, new Blob(["first-"]));
    await Promise.all(order === "append first" ? [append(), register()] : [register(), append()]);
    await store.append(row, new Blob(["second"]));
    expect(await store.get(row.userId, row.id)).toMatchObject({
      sessionId,
      sourceAssetId,
      syncError: null,
      chunks: 2,
      bytes: 12,
      activeMs: 2500,
      captureId: row.captureId,
      segment: 2,
      completedAt,
      awaitingFinalData: false,
      autoRegister: true,
      status: "saved",
      creationKey: row.creationKey,
    });
    expect(await (await store.blob(row.userId, row.id)).text()).toBe("first-second");
    const failed = await otherTab.updateRegistration(row.userId, row.id, {
      syncError: "Upload temporarily failed",
    });
    expect(failed).toMatchObject({
      sessionId,
      sourceAssetId,
      syncError: "Upload temporarily failed",
      chunks: 2,
      bytes: 12,
      completedAt,
      captureId: row.captureId,
      segment: 2,
    });
    await store.append(row, new Blob(["tail"]));
    expect(await store.get(row.userId, row.id)).toMatchObject({
      sessionId,
      sourceAssetId,
      syncError: "Upload temporarily failed",
      chunks: 3,
      bytes: 16,
      completedAt,
      autoRegister: true,
      captureId: row.captureId,
      segment: 2,
    });
    expect(await (await store.blob(row.userId, row.id)).text()).toBe("first-secondtail");
  },
);

it("returns null for a missing or differently owned registration row", async () => {
  const store = new IndexedRecordingStore();
  const row = manifest(randomUUID());
  await store.put(row);
  expect(
    await store.updateRegistration(row.userId, randomUUID(), { sourceAssetId: randomUUID() }),
  ).toBeNull();
  expect(
    await store.updateRegistration(randomUUID(), row.id, { sourceAssetId: randomUUID() }),
  ).toBeNull();
  expect(await store.get(row.userId, row.id)).toEqual(row);
  expect(await store.list(row.userId)).toEqual([row]);
});

it.each([
  { label: "counter mutation", patch: { bytes: 1 } },
  { label: "group mutation", patch: { captureId: randomUUID() } },
  { label: "completion mutation", patch: { completedAt: new Date().toISOString() } },
  { label: "unknown field", patch: { extra: true } },
  { label: "invalid session ID", patch: { sessionId: "invalid" } },
  { label: "invalid source asset ID", patch: { sourceAssetId: "invalid" } },
  { label: "oversized error", patch: { syncError: "x".repeat(1001) } },
  { label: "non-string error", patch: { syncError: 1 } },
])(
  "rejects invalid registration patches without changing the recording ($label)",
  async ({ patch }) => {
    const store = new IndexedRecordingStore();
    const row = manifest(randomUUID());
    await store.put(row);
    await expect(
      store.updateRegistration(row.userId, row.id, patch as unknown as RegistrationPatch),
    ).rejects.toThrow();
    expect(await store.get(row.userId, row.id)).toEqual(row);
  },
);
