import "fake-indexeddb/auto";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  IndexedRecordingStore,
  LocalRecordingIncompleteError,
  type Recording,
} from "../recording/store";
import {
  type RegisteredOriginal,
  RelinkError,
  type RelinkStore,
  relinkOriginalRecording,
} from "./relink-original";

const sha = async (blob: Blob) =>
  createHash("sha256")
    .update(new Uint8Array(await blob.arrayBuffer()))
    .digest("hex");
function original(text = "synthetic class recording bytes") {
  const file = new Blob([text], { type: "audio/webm" });
  return file;
}
async function expected(file: Blob, sourceId = randomUUID()): Promise<RegisteredOriginal> {
  return {
    sourceId,
    sha256: await sha(file),
    sizeBytes: file.size,
    mimeType: "audio/webm",
    durationMs: 1000,
  };
}
function manifest(userId: string, overrides: Partial<Recording> = {}): Recording {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    sessionId: null,
    mimeType: "audio/webm",
    status: "saved",
    createdAt: now,
    updatedAt: now,
    activeMs: 1,
    chunks: 0,
    bytes: 0,
    creationKey: randomUUID(),
    sourceAssetId: null,
    ...overrides,
  };
}
const hash = vi.fn((blob: Blob) => sha(blob));

describe("VOICE-AC-08: the exact original is re-attached on this device only", () => {
  it("links a missing original to its source and plays from the stored bytes", async () => {
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    const file = original();
    const registered = await expected(file);
    await expect(
      relinkOriginalRecording({ store, hash }, { userId, expected: registered, file }),
    ).resolves.toBe("linked");
    const [row] = await store.list(userId);
    expect(row).toMatchObject({
      id: registered.sourceId,
      sourceAssetId: registered.sourceId,
      sessionId: null,
      status: "saved",
      chunks: 1,
      bytes: file.size,
    });
    // No capture flag: relinking never registers a source or starts learning.
    expect(row?.autoRegister ?? row?.autoGenerate ?? row?.completedAt ?? row?.captureId).toBe(
      undefined,
    );
    expect(await sha(await store.blob(userId, registered.sourceId))).toBe(registered.sha256);
    // A second selection of the same file is a no-op.
    await expect(
      relinkOriginalRecording({ store, hash }, { userId, expected: registered, file }),
    ).resolves.toBe("already_linked");
    expect(await store.list(userId)).toHaveLength(1);
  });

  it("repairs an incomplete in-app recording in place and keeps its photos and links", async () => {
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const file = original("complete recording");
    const registered = await expected(file);
    const row = manifest(userId, {
      sessionId,
      sourceAssetId: registered.sourceId,
      autoRegister: true,
    });
    await store.put(row);
    await store.append(row, new Blob(["partial"]));
    // The manifest promises more bytes than its parts hold.
    await store.put({ ...row, chunks: 2, bytes: 99 });
    await expect(store.blob(userId, row.id)).rejects.toBeInstanceOf(LocalRecordingIncompleteError);
    await store.savePhoto({
      id: randomUUID(),
      userId,
      recordingId: row.id,
      offsetMs: 0,
      captureState: "recording",
      blob: new Blob(["png"], { type: "image/png" }),
      createdAt: new Date().toISOString(),
      sourceAssetId: null,
    });
    await expect(
      relinkOriginalRecording({ store, hash }, { userId, expected: registered, file }),
    ).resolves.toBe("linked");
    expect(await store.get(userId, row.id)).toMatchObject({
      sessionId,
      sourceAssetId: registered.sourceId,
      autoRegister: true,
      chunks: 1,
      bytes: file.size,
    });
    expect(await store.photos(userId, row.id)).toHaveLength(1);
    expect(await sha(await store.blob(userId, row.id))).toBe(registered.sha256);
  });

  it("rejects a different file before writing anything, including one of the same size", async () => {
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    const registered = await expected(original("aaaa"));
    hash.mockClear();
    await expect(
      relinkOriginalRecording(
        { store, hash },
        { userId, expected: registered, file: original("aaaaa") },
      ),
    ).rejects.toMatchObject({ code: "size_mismatch" });
    // The size check needs no hashing.
    expect(hash).not.toHaveBeenCalled();
    await expect(
      relinkOriginalRecording(
        { store, hash },
        { userId, expected: registered, file: original("bbbb") },
      ),
    ).rejects.toMatchObject({ code: "content_mismatch" });
    expect(await store.list(userId)).toEqual([]);
  });

  it("never overwrites a healthy original, another source's row or a recording in progress", async () => {
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    const file = original("in progress");
    const registered = await expected(file);
    const active = manifest(userId, { sourceAssetId: registered.sourceId, status: "recording" });
    await store.put(active);
    await expect(
      relinkOriginalRecording({ store, hash }, { userId, expected: registered, file }),
    ).rejects.toMatchObject({ code: "recording_active" });
    await expect(
      store.replaceOriginal({
        userId,
        sourceId: randomUUID(),
        recordingId: active.id,
        blob: file,
        mimeType: "audio/webm",
        activeMs: 0,
      }),
    ).rejects.toThrow();
    expect(await store.get(userId, active.id)).toEqual(active);
    // A saved, healthy row of source A is never rewritten as source B's original.
    const kept = original("source A original");
    const sourceA = await expected(kept);
    await relinkOriginalRecording({ store, hash }, { userId, expected: sourceA, file: kept });
    const before = await store.get(userId, sourceA.sourceId);
    expect(before?.status).toBe("saved");
    await expect(
      store.replaceOriginal({
        userId,
        sourceId: randomUUID(),
        recordingId: sourceA.sourceId,
        blob: original("another source"),
        mimeType: "audio/webm",
        activeMs: 0,
      }),
    ).rejects.toThrow();
    expect(await store.get(userId, sourceA.sourceId)).toEqual(before);
    expect(await sha(await store.blob(userId, sourceA.sourceId))).toBe(sourceA.sha256);
  });

  it("keeps accounts apart and writes nothing for a deleted account", async () => {
    const store = new IndexedRecordingStore();
    const owner = randomUUID();
    const other = randomUUID();
    const file = original("owner recording");
    const registered = await expected(file);
    await relinkOriginalRecording({ store, hash }, { userId: owner, expected: registered, file });
    expect(await store.list(other)).toEqual([]);
    await store.removeAccount(other);
    await expect(
      relinkOriginalRecording({ store, hash }, { userId: other, expected: registered, file }),
    ).rejects.toMatchObject({ code: "local_write_failed" });
    expect(await store.list(other)).toEqual([]);
    expect(await store.list(owner)).toHaveLength(1);
  });

  it("refuses without a usable checksum, after cancellation, or when the store cannot be read", async () => {
    const file = original();
    const registered = await expected(file);
    const store = new IndexedRecordingStore();
    const userId = randomUUID();
    await expect(
      relinkOriginalRecording(
        { store, hash },
        { userId, expected: { ...registered, sha256: "0".repeat(64) }, file },
      ),
    ).rejects.toMatchObject({ code: "no_checksum" });
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));
    await expect(
      relinkOriginalRecording(
        { store, hash: async () => registered.sha256 },
        { userId, expected: registered, file, signal: abort.signal },
      ),
    ).rejects.toThrow("cancelled");
    const broken: RelinkStore = {
      list: () => Promise.reject(new Error("blocked")),
      blob: () => Promise.reject(new Error("unused")),
      replaceOriginal: vi.fn(),
    };
    await expect(
      relinkOriginalRecording({ store: broken, hash }, { userId, expected: registered, file }),
    ).rejects.toMatchObject({ code: "local_read_failed" });
    expect(broken.replaceOriginal).not.toHaveBeenCalled();
    expect(await store.list(userId)).toEqual([]);
  });

  it("maps a full device to a storage error and reports a copy that does not read back", async () => {
    const file = original();
    const registered = await expected(file);
    const full: RelinkStore = {
      list: async () => [],
      blob: () => Promise.reject(new Error("unused")),
      replaceOriginal: () => Promise.reject(new DOMException("quota", "QuotaExceededError")),
    };
    await expect(
      relinkOriginalRecording(
        { store: full, hash },
        { userId: randomUUID(), expected: registered, file },
      ),
    ).rejects.toEqual(new RelinkError("storage_full"));
    const corrupt: RelinkStore = {
      list: async () => [],
      blob: async () => new Blob(["other bytes"]),
      replaceOriginal: async (input) => manifest(input.userId),
    };
    await expect(
      relinkOriginalRecording(
        { store: corrupt, hash },
        { userId: randomUUID(), expected: registered, file },
      ),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });
});
