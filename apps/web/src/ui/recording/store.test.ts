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

it("D104 seals a part whose page is gone, keeping its audio, and removes only an empty one", async () => {
  const store = new IndexedRecordingStore();
  const userId = randomUUID();
  const recording = { ...manifest(userId), status: "recording" as const };
  const paused = { ...manifest(userId), status: "paused" as const };
  const waiting = { ...manifest(userId), status: "interrupted" as const, awaitingFinalData: true };
  const empty = { ...manifest(userId), status: "recording" as const };
  const photographed = { ...manifest(userId), status: "paused" as const };
  const sealed = manifest(userId);
  for (const row of [recording, paused, waiting, empty, photographed, sealed]) await store.put(row);
  for (const row of [recording, paused, waiting, sealed])
    await store.append(row, new Blob(["Synthetic audio"]));
  await store.savePhoto({
    id: randomUUID(),
    userId,
    recordingId: photographed.id,
    offsetMs: 0,
    captureState: "paused",
    blob: new Blob(["synthetic"], { type: "image/png" }),
    createdAt: new Date().toISOString(),
    sourceAssetId: null,
  });
  const unchanged = await store.get(userId, sealed.id);

  for (const row of [recording, paused]) {
    const next = await store.seal(userId, row.id);
    expect(next).toMatchObject({ status: "interrupted", awaitingFinalData: false, chunks: 1 });
    expect(await (await store.blob(userId, row.id)).text()).toBe("Synthetic audio");
  }
  expect(await store.seal(userId, waiting.id)).toMatchObject({
    status: "interrupted",
    awaitingFinalData: false,
  });
  // A part that never saved audio is removed, unless a board photo belongs to it.
  expect(await store.seal(userId, empty.id)).toBeNull();
  expect(await store.get(userId, empty.id)).toBeNull();
  expect(await store.seal(userId, photographed.id)).toMatchObject({
    status: "interrupted",
    bytes: 0,
  });
  expect(await store.photos(userId, photographed.id)).toHaveLength(1);
  // A sealed part and a missing one stay as they are.
  expect(await store.seal(userId, sealed.id)).toEqual(unchanged);
  expect(await store.get(userId, sealed.id)).toEqual(unchanged);
  expect(await store.seal(userId, randomUUID())).toBeNull();
  await store.removeAccount(userId);
  await expect(store.seal(userId, recording.id)).rejects.toThrow();
});
