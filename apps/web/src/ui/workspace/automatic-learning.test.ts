import { createHash, randomUUID } from "node:crypto";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPhoto, Recording } from "../recording/store";
import { WorkspaceRequestError, type workspaceRequest } from "./api";
import {
  AUDIO_PART_CONCURRENCY,
  type AutomaticLearningStatus,
  type AutomaticUploadProgress,
  automaticRecordingClasses,
  automaticRecordingMaterial,
  automaticResultNeedsRefresh,
  inAutomaticLearningBatch,
  pendingLearningBatch,
  prepareAutomaticRecordingPhotos,
  uploadAutomaticAudio,
  uploadAutomaticPhoto,
} from "./automatic-learning";
import {
  resetUploadFailureDiagnostics,
  UploadInterruptedError,
  uploadFailureDiagnostics,
} from "./upload";
import { uploadCopy } from "./upload-copy";
import { AudioUploadProblem } from "./upload-problems";

const transport = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("./upload-progress", () => ({ uploadWithProgress: transport.upload }));

const userId = randomUUID(),
  sessionId = randomUUID(),
  sourceId = randomUUID();
function row(patch: Partial<Recording> = {}): Recording {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    sessionId,
    sourceAssetId: sourceId,
    creationKey: randomUUID(),
    status: "saved",
    mimeType: "audio/webm",
    activeMs: 1000,
    bytes: 4,
    chunks: 1,
    autoRegister: true,
    autoGenerate: true,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
beforeEach(() => {
  transport.upload.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("automatic result refresh", () => {
  const ready: AutomaticLearningStatus = {
    state: "ready",
    revision: 1,
    batchId: null,
    run: null,
    snapshot: null,
    lastError: null,
    message: "Ready",
    notesReady: true,
    cardsReady: true,
  };
  it("preserves the initial ready server render and unchanged polling result", () => {
    expect(automaticResultNeedsRefresh(ready, undefined, ready)).toBe(false);
    expect(automaticResultNeedsRefresh(ready, ready, ready)).toBe(false);
  });
  it("refreshes only when pending work becomes ready or a newer result is observed", () => {
    expect(automaticResultNeedsRefresh(ready, { ...ready, state: "processing" }, ready)).toBe(true);
    expect(
      automaticResultNeedsRefresh(ready, undefined, { ...ready, state: "waiting_upload" }),
    ).toBe(true);
    expect(automaticResultNeedsRefresh({ ...ready, revision: 2 }, ready, ready)).toBe(true);
    expect(automaticResultNeedsRefresh({ ...ready, state: "processing" }, ready, ready)).toBe(
      false,
    );
  });
});

describe("automatic upload batch boundaries", () => {
  it("reports the acknowledged processing status only after closing and clearing the batch", async () => {
    const status: AutomaticLearningStatus = {
      state: "waiting_sources",
      revision: 4,
      batchId: null,
      run: null,
      snapshot: null,
      lastError: null,
      message: "Verifying files",
      notesReady: false,
      cardsReady: false,
    };
    const onCompleted = vi.fn((result: AutomaticLearningStatus) => {
      expect(pendingLearningBatch(userId, sessionId)).toBeNull();
      expect(result).toBe(status);
    });
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(status);
    const result = await inAutomaticLearningBatch(
      userId,
      sessionId,
      async () => "files added",
      request,
      { onCompleted },
    );
    expect(result).toBe("files added");
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(status);
  });
  it("does not report completion when the server closure is interrupted", async () => {
    const onCompleted = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError("Connection lost"));
    await expect(
      inAutomaticLearningBatch(userId, sessionId, async () => {}, request, { onCompleted }),
    ).rejects.toThrow("Connection lost");
    expect(onCompleted).not.toHaveBeenCalled();
    expect(pendingLearningBatch(userId, sessionId)).toBeTruthy();
  });
  it("begins before uploads and closes only after every picker file settles", async () => {
    const events: string[] = [];
    const request = vi.fn(async (_path, _method, body: { action: string }) => {
      events.push(body.action);
    });
    await inAutomaticLearningBatch(
      userId,
      sessionId,
      async () => {
        events.push("file1", "file2");
      },
      request as unknown as typeof workspaceRequest,
    );
    expect(events).toEqual(["begin", "file1", "file2", "complete"]);
    expect(request.mock.calls[0]?.[2]).toEqual({ action: "begin", batchId: expect.any(String) });
    expect(pendingLearningBatch(userId, sessionId)).toBeNull();
  });
  it("closes the batch when an upload fails, retaining the original failure", async () => {
    const request = vi.fn().mockResolvedValue({});
    await expect(
      inAutomaticLearningBatch(
        userId,
        sessionId,
        async () => {
          throw new Error("One file failed");
        },
        request,
      ),
    ).rejects.toThrow("One file failed");
    expect(request.mock.calls.map((call) => call[2].action)).toEqual(["begin", "complete"]);
  });
  it("keeps an interrupted closure for explicit upload resume instead of silently closing on reload", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError("Connection lost"));
    await expect(
      inAutomaticLearningBatch(userId, sessionId, async () => {}, request),
    ).rejects.toThrow("Connection lost");
    const batchId = pendingLearningBatch(userId, sessionId);
    expect(batchId).toBeTruthy();
    request.mockResolvedValue({});
    await inAutomaticLearningBatch(userId, sessionId, async () => {}, request);
    expect(request.mock.calls[2]?.[2]).toEqual({ action: "begin", batchId });
    expect(request.mock.calls[3]?.[2]).toEqual({ action: "complete", batchId });
  });
  it("opens a fresh fence before new files when an earlier completion acknowledgement was lost", async () => {
    const events: string[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    await expect(
      inAutomaticLearningBatch(userId, sessionId, async () => {}, request),
    ).rejects.toThrow("Lost acknowledgement");
    const closedId = pendingLearningBatch(userId, sessionId);
    request.mockImplementation(async (_path, _method, body) => {
      events.push(body.action);
      return { state: "ready", batchId: body.batchId === closedId ? null : body.batchId };
    });
    await inAutomaticLearningBatch(
      userId,
      sessionId,
      async () => {
        events.push("file");
      },
      request,
    );
    expect(events).toEqual(["begin", "begin", "file", "complete"]);
    expect(request.mock.calls[3]?.[2].batchId).not.toBe(closedId);
    expect(request.mock.calls[4]?.[2].batchId).toBe(request.mock.calls[3]?.[2].batchId);
  });
});

describe("automatic recording photos", () => {
  const contract = { partBytes: 4 } as InputContract;
  function photo(recording: Recording, patch: Partial<LocalPhoto> = {}): LocalPhoto {
    return {
      id: randomUUID(),
      userId,
      recordingId: recording.id,
      offsetMs: 61_500,
      captureState: "recording",
      blob: new Blob(["abcd"], { type: "image/jpeg" }),
      createdAt: recording.createdAt,
      sourceAssetId: null,
      ...patch,
    };
  }
  it("does not read or upload capture photos before all stopped parts have registered", async () => {
    const photos = vi.fn(async () => []);
    expect(
      await automaticRecordingMaterial(
        userId,
        sessionId,
        [row(), row({ completedAt: undefined })],
        { photos },
      ),
    ).toBeNull();
    expect(
      await automaticRecordingMaterial(userId, sessionId, [row(), row({ sourceAssetId: null })], {
        photos,
      }),
    ).toBeNull();
    expect(
      await automaticRecordingMaterial(
        userId,
        sessionId,
        [row(), row({ awaitingFinalData: true })],
        { photos },
      ),
    ).toBeNull();
    expect(photos).not.toHaveBeenCalled();
  });
  it("includes photos in the capture fingerprint so late local photos trigger one update", async () => {
    const recording = row(),
      first = photo(recording),
      second = photo(recording);
    const photos = vi.fn(async () => [first]);
    const before = await automaticRecordingMaterial(userId, sessionId, [recording], { photos });
    photos.mockResolvedValue([second, first]);
    const after = await automaticRecordingMaterial(userId, sessionId, [recording], { photos });
    photos.mockResolvedValue([first, second]);
    expect(
      (await automaticRecordingMaterial(userId, sessionId, [recording], { photos }))?.fingerprint,
    ).toBe(after?.fingerprint);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });
  it("declares and registers every board photo without requiring client batch completion", async () => {
    const recording = row(),
      local = [photo(recording), photo(recording)];
    const events: string[] = [];
    const saved: LocalPhoto[] = [];
    const store = {
      photos: async () => local,
      savePhoto: async (value: LocalPhoto) => {
        saved.push(value);
        events.push("saved-photo");
      },
    };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const put = vi.fn(async () => {
      events.push("put");
      return { ok: true, status: 200 };
    });
    let confirmations = 0;
    const request = vi.fn(
      async (
        path: string,
        method: string,
        body?: { action?: string; batchId?: string },
        _key?: string,
      ) => {
        if (body?.action) {
          events.push(body.action);
          return { batchId: body.batchId };
        }
        if (path === "/api/sources") {
          events.push("register-photo");
          return { assetId: randomUUID(), uploadId: "photo-upload" };
        }
        if (path.endsWith("complete")) {
          events.push("complete-photo");
          return {};
        }
        if (path.endsWith("/parts/0") && method === "POST")
          return { confirmed: ++confirmations % 2 === 0 };
        if (path.endsWith("/parts/0")) return { url: "https://storage.example.test/photo" };
        return { state: "pending", parts: [{ index: 0, verifiedAt: null }] };
      },
    );
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      put,
      request: request as typeof workspaceRequest,
    });
    expect(events).toEqual([
      "begin",
      "register-photo",
      "register_file",
      "put",
      "complete-photo",
      "saved-photo",
      "register-photo",
      "register_file",
      "put",
      "complete-photo",
      "saved-photo",
    ]);
    expect(saved.map((savedPhoto) => savedPhoto.blob)).toEqual(
      local.map((localPhoto) => localPhoto.blob),
    );
    expect(saved.every((savedPhoto) => savedPhoto.sourceAssetId)).toBe(true);
    expect(
      request.mock.calls.filter((call) => call[0] === "/api/sources").map((call) => call[3]),
    ).toEqual(local.map((photo) => `recorded-photo:${photo.id}`));
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      action: "begin",
      expectedFileIds: local.map((photo) => photo.id),
    });
    const batchId = request.mock.calls[0]?.[2]?.batchId;
    expect(
      request.mock.calls.filter((call) => call[0] === "/api/sources").map((call) => call[2]),
    ).toEqual(local.map((photo) => expect.objectContaining({ batchId, fileId: photo.id })));
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
  });
  it("retains a failed photo batch and reuses its id when saved photos resume", async () => {
    const recording = row(),
      local = photo(recording);
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const request = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Source notice needs acceptance"));
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, { store, request }),
    ).rejects.toThrow("Source notice");
    const batchId = request.mock.calls[0]?.[2].batchId;
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
    request.mockImplementation(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action) return { batchId: body.batchId };
        if (path === "/api/sources") return { assetId: sourceId, uploadId: "photo-upload" };
        return { state: "verified", parts: [] };
      },
    );
    await prepareAutomaticRecordingPhotos(userId, material, contract, { store, request });
    expect(request.mock.calls[2]?.[2]).toEqual({
      action: "begin",
      batchId,
      expectedFileIds: [local.id],
    });
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
    expect(store.savePhoto).toHaveBeenCalledWith({ ...local, sourceAssetId: sourceId });
  });
  it("replays an immutable photo declaration after a lost begin acknowledgement and reordered local data", async () => {
    const recording = row(),
      local = [photo(recording), photo(recording)];
    const store = { photos: async () => local, savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const request = vi.fn().mockRejectedValueOnce(new TypeError("Lost begin acknowledgement"));
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, { store, request }),
    ).rejects.toThrow("Lost begin");
    const declared = request.mock.calls[0]?.[2];
    material.photos.reverse();
    request.mockImplementation(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action === "begin") return { batchId: body.batchId };
        if (body?.action === "register_file") return {};
        if (path === "/api/sources") return { assetId: randomUUID(), uploadId: randomUUID() };
        return { state: "verified", parts: [] };
      },
    );
    await prepareAutomaticRecordingPhotos(userId, material, contract, { store, request });
    expect(request.mock.calls[1]?.[2]).toEqual(declared);
    expect(store.savePhoto).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
  });
  it("declares only pending photos and leaves already uploaded photos outside the group untouched", async () => {
    const recording = row(),
      old = photo(recording, { sourceAssetId: randomUUID() }),
      pending = photo(recording);
    const store = { photos: async () => [old, pending], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const request = vi.fn(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action === "begin") return { batchId: body.batchId };
        if (body?.action === "register_file") return {};
        if (path === "/api/sources") return { assetId: sourceId, uploadId: "photo-upload" };
        return { state: "verified", parts: [] };
      },
    );
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      request: request as typeof workspaceRequest,
    });
    expect(request.mock.calls[0]?.[2]).toMatchObject({ expectedFileIds: [pending.id] });
    expect(request.mock.calls.filter((call) => call[0] === "/api/sources")).toHaveLength(1);
    expect(store.savePhoto).toHaveBeenCalledExactlyOnceWith({
      ...pending,
      sourceAssetId: sourceId,
    });
  });
  it("recovers a saved source ID after server sealing through exact class receipts without creating or attaching material", async () => {
    const recording = row(),
      local = photo(recording, { sourceAssetId: sourceId }),
      batchId = randomUUID();
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const key = `recalino:learning-photos:${userId}:${sessionId}`;
    localStorage.setItem(key, JSON.stringify({ batchId, fileIds: [local.id], sources: {} }));
    const request = vi.fn(async (path: string, _method: string, body?: { action?: string }) => {
      if (body?.action === "begin") return { batchId: null, state: "processing" };
      if (path.startsWith("/api/sources?"))
        return [
          { id: randomUUID(), operation_key: "unrelated", uploadId: "unrelated-upload" },
          { id: sourceId, operation_key: `recorded-photo:${local.id}`, uploadId: "photo-upload" },
        ];
      if (path === `/api/classes/${sessionId}/sources`) return [{ assetId: sourceId }];
      return { state: "verified", parts: [] };
    });
    const put = vi.fn();
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      request: request as typeof workspaceRequest,
      put,
    });
    expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
    expect(request.mock.calls[0]?.[2]).toMatchObject({ action: "begin", batchId });
    expect(store.savePhoto).toHaveBeenCalledExactlyOnceWith(local);
    expect(put).not.toHaveBeenCalled();
  });
  it("keeps a group fenced when a declared local photo is missing or its capture is no longer authorized", async () => {
    const recording = row(),
      local = photo(recording);
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const key = `recalino:learning-photos:${userId}:${sessionId}`,
      batchId = randomUUID();
    localStorage.setItem(
      key,
      JSON.stringify({ batchId, fileIds: [local.id, randomUUID()], sources: {} }),
    );
    const request = vi.fn();
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, { store, request }),
    ).rejects.toThrow("approved recording");
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toContain(batchId);
    localStorage.removeItem(key);
    recording.autoGenerate = undefined;
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, { store, request }),
    ).rejects.toThrow("approved recording");
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects changed local photo bytes before acknowledging a cached source receipt", async () => {
    const recording = row(),
      local = photo(recording),
      request = vi.fn(),
      store = { savePhoto: vi.fn() };
    await expect(
      uploadAutomaticPhoto(recording, local, contract, {
        store,
        request,
        photoBatch: {
          id: randomUUID(),
          closed: false,
          source: { assetId: sourceId, uploadId: "photo-upload", sha256: "0".repeat(64) },
          saveSource: vi.fn(),
        },
      }),
    ).rejects.toThrow("saved bytes no longer match");
    expect(request).not.toHaveBeenCalled();
    expect(store.savePhoto).not.toHaveBeenCalled();
  });
  it("recovers a pre-upgrade photo group's lost closure without opening another group or uploading old photos", async () => {
    const recording = row(),
      local = photo(recording, { sourceAssetId: sourceId }),
      batchId = randomUUID();
    const key = `recalino:learning-photos:${userId}:${sessionId}`;
    localStorage.setItem(key, batchId);
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    let closed = false;
    const request = vi.fn(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action === "begin") return { batchId: closed ? null : body.batchId };
        if (body?.action === "complete") {
          closed = true;
          throw new TypeError("Lost legacy closure");
        }
        if (path.startsWith("/api/sources?"))
          return [
            { id: sourceId, operation_key: `recorded-photo:${local.id}`, uploadId: "photo-upload" },
          ];
        if (path === `/api/classes/${sessionId}/sources`) return [{ assetId: sourceId }];
        return { state: "verified", parts: [] };
      },
    );
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, {
        store,
        request: request as typeof workspaceRequest,
      }),
    ).rejects.toThrow("Lost legacy");
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      request: request as typeof workspaceRequest,
    });
    const posts = request.mock.calls.filter((call) => call[1] === "POST");
    expect(posts.map((call) => call[2])).toEqual([
      { action: "begin", batchId },
      { action: "complete", batchId },
      { action: "begin", batchId },
    ]);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("recovers after tab closure and server auto-sealing without reopening a fence or reuploading bytes", async () => {
    const recording = row(),
      local = photo(recording);
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    const abort = new AbortController();
    let received = false,
      confirmations = 0;
    const request = vi.fn(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action === "begin")
          return {
            state: received ? "processing" : "waiting_sources",
            batchId: received ? null : body.batchId,
          };
        if (body?.action === "register_file") return {};
        if (path === "/api/sources") return { assetId: sourceId, uploadId: "photo-upload" };
        if (path.endsWith("/parts/0") && _method === "POST")
          return { confirmed: ++confirmations % 2 === 0 };
        if (path.endsWith("/parts/0")) return { url: "https://storage.example.test/photo" };
        if (path.endsWith("complete")) {
          received = true;
          abort.abort(new DOMException("Tab closed before acknowledgement", "AbortError"));
          abort.signal.throwIfAborted();
        }
        return { state: received ? "verified" : "pending", parts: [] };
      },
    );
    const put = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, {
        store,
        request: request as typeof workspaceRequest,
        put,
        signal: abort.signal,
      }),
    ).rejects.toThrow("Tab closed");
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      request: request as typeof workspaceRequest,
      put,
    });
    const begins = request.mock.calls.filter((call) => call[2]?.action === "begin");
    expect(begins).toHaveLength(2);
    expect(begins[1]?.[2]).toEqual(begins[0]?.[2]);
    expect(put).toHaveBeenCalledOnce();
    expect(request.mock.calls.filter((call) => call[0] === "/api/sources")).toHaveLength(1);
    expect(request.mock.calls.filter((call) => call[2]?.action === "register_file")).toHaveLength(
      1,
    );
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
    expect(store.savePhoto).toHaveBeenCalledWith({ ...local, sourceAssetId: sourceId });
    expect(localStorage.getItem(`recalino:learning-photos:${userId}:${sessionId}`)).toBeNull();
  });
  it("cancels immediately when an in-flight board photo upload is aborted", async () => {
    const recording = row(),
      local = photo(recording),
      abort = new AbortController();
    const store = { savePhoto: vi.fn() };
    const request = vi.fn(async (path: string, method: string) => {
      if (path === "/api/sources") return { assetId: sourceId, uploadId: "photo-upload" };
      if (path.endsWith("/parts/0") && method === "POST") return { confirmed: false };
      if (path.endsWith("/parts/0")) return { url: "https://storage.example.test/photo" };
      return { parts: [] };
    });
    const put = vi.fn(async (_url: string, _blob: Blob, _type: string, signal?: AbortSignal) => {
      abort.abort(new DOMException("Deleting account", "AbortError"));
      signal?.throwIfAborted();
      return { ok: true, status: 200 };
    });
    await expect(
      uploadAutomaticPhoto(recording, local, contract, {
        store,
        request: request as typeof workspaceRequest,
        put,
        signal: abort.signal,
      }),
    ).rejects.toThrow("Deleting account");
    expect(store.savePhoto).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => call[0].endsWith("complete"))).toBe(false);
  });
});

describe("recording preparation authorization", () => {
  it("ignores historical recordings and waits for all new parts to register", () => {
    expect(automaticRecordingClasses([row({ autoGenerate: undefined })])).toEqual([]);
    expect(automaticRecordingClasses([row(), row({ sourceAssetId: null })])).toEqual([]);
    expect(automaticRecordingClasses([row(), row({ awaitingFinalData: true })])).toEqual([]);
    expect(
      automaticRecordingClasses([row(), row({ completedAt: undefined, status: "recording" })]),
    ).toEqual([]);
  });
  it("returns a stable finalized source-set fingerprint for one automatic request", () => {
    const second = row({ sourceAssetId: randomUUID() });
    const first = row();
    expect(automaticRecordingClasses([first, second])).toEqual(
      automaticRecordingClasses([second, first]),
    );
    expect(automaticRecordingClasses([first])).toEqual([{ sessionId, fingerprint: sourceId }]);
  });
});

describe("automatic temporary audio upload", () => {
  const blob = new Blob(["abcd"]);
  const snapshot: RunSnapshot = {
    sourcesVersion: 3,
    fingerprint: "a".repeat(64),
    sources: [
      {
        sourceId,
        kind: "audio",
        sha256: createHash("sha256").update("abcd").digest("hex"),
        mimeType: "audio/webm",
        durationMs: 1000,
        pageCount: null,
        objectId: null,
        contentVersionId: null,
        captureAnchor: null,
        ranges: [],
        units: [],
        blocks: [],
      },
    ],
  };
  const run: ProcessingRun = {
    id: randomUUID(),
    sessionId,
    reservationId: randomUUID(),
    state: "awaiting_upload",
    sourcesVersion: 3,
    lastError: null,
    outputVersionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const contract = { partBytes: 2 } as InputContract;
  const store = { list: vi.fn(async () => [row()]), blob: vi.fn(async () => blob) };

  it("does not start uploads or new work when polling a completed run", async () => {
    const local = { list: vi.fn(), blob: vi.fn() },
      request = vi.fn(),
      put = vi.fn();
    await uploadAutomaticAudio({ ...run, state: "ready" }, snapshot, contract, {
      userId,
      store: local,
      request,
      put,
    });
    expect(local.list).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("announces checking before reading or hashing saved audio and before any upload request", async () => {
    const onProgress = vi.fn();
    const onTransferProgress = vi.fn();
    const request = vi.fn(async (_path, method: string, body?: { action: string }) =>
      body?.action === "start"
        ? { uploadId: "upload" }
        : method === "GET"
          ? { state: "verifying", parts: [] }
          : {},
    );
    const assertChecking = () => {
      expect(onProgress).toHaveBeenLastCalledWith("Checking audio file 1 of 1 before upload…");
      expect(onTransferProgress).toHaveBeenLastCalledWith({
        runId: run.id,
        sentBytes: 0,
        totalBytes: 4,
        files: [
          { sourceId, displayName: "Audio file 1", sentBytes: 0, totalBytes: 4, phase: "checking" },
        ],
      });
      expect(request).not.toHaveBeenCalled();
    };
    const saved = new Blob(["abcd"]);
    const read = vi.spyOn(saved, "arrayBuffer").mockImplementation(async () => {
      assertChecking();
      return blob.arrayBuffer();
    });
    const local = {
      list: store.list,
      blob: vi.fn(async () => {
        assertChecking();
        return saved;
      }),
    };
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store: local,
      request: request as typeof workspaceRequest,
      onProgress,
      onTransferProgress,
    });
    expect(local.blob).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });

  it("skips verified parts, confirms unknown writes, and uses stable start/completion keys", async () => {
    const progress: AutomaticUploadProgress[] = [];
    const put = vi.fn(
      async (_url: string, _blob: Blob, _mimeType: string, _signal?: AbortSignal) => ({
        ok: true,
        status: 200,
      }),
    );
    let confirmations = 0;
    const request = vi.fn(
      async (path: string, method: string, body?: { action: string }, _key?: string) => {
        if (body?.action === "start") return { uploadId: "upload" };
        if (body?.action === "confirm_part") return { confirmed: ++confirmations > 1 };
        if (method === "GET" && path.includes("index="))
          return { url: "https://storage.example.test/part" };
        if (method === "GET")
          return {
            state: "pending",
            parts: [
              { index: 0, verifiedAt: "now" },
              { index: 1, verifiedAt: null },
            ],
          };
        return {};
      },
    );
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store,
      put,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[1].size).toBe(2);
    expect(request.mock.calls.filter((call) => call[2]?.action === "confirm_part")).toHaveLength(2);
    expect(request.mock.calls.find((call) => call[2]?.action === "start")?.[3]).toBe(
      `audio-start:${run.id}:${sourceId}`,
    );
    expect(request.mock.calls.find((call) => call[2]?.action === "complete")?.[3]).toBe(
      `audio-complete:${run.id}:${sourceId}`,
    );
    expect(progress[0]).toMatchObject({ sentBytes: 0, totalBytes: 4 });
    expect(progress).toContainEqual({
      runId: run.id,
      sentBytes: 2,
      totalBytes: 4,
      files: [
        { sourceId, displayName: "Audio file 1", sentBytes: 2, totalBytes: 4, phase: "uploading" },
      ],
    });
    expect(progress.at(-1)).toMatchObject({
      sentBytes: 4,
      totalBytes: 4,
      files: [{ phase: "verifying" }],
    });
    // Published snapshots must remain unchanged as later parts finish.
    expect(progress[0]?.files[0]?.sentBytes).toBe(0);
  });
  it("after a reload, a remembered upload the server verified is not checked or sent again", async () => {
    localStorage.setItem(`recalino:audio-upload:${userId}:${run.id}:${sourceId}`, "upload");
    const progress: AutomaticUploadProgress[] = [];
    const local = { list: store.list, blob: vi.fn(async () => blob) };
    const request = vi.fn(async (path: string, method: string) =>
      method === "GET" && path.endsWith("uploadId=upload") ? { state: "verified", parts: [] } : {},
    );
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store: local,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    expect(local.blob).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(progress.at(-1)).toMatchObject({ sentBytes: 4, files: [{ phase: "complete" }] });
    expect(
      localStorage.getItem(`recalino:audio-upload:${userId}:${run.id}:${sourceId}`),
    ).toBeNull();
  });
  it("after a reload, shows the parts the server holds before checking the original again", async () => {
    const key = `recalino:audio-upload:${userId}:${run.id}:${sourceId}`;
    localStorage.setItem(key, "upload");
    const progress: AutomaticUploadProgress[] = [];
    let reads = 0;
    const request = vi.fn(async (_path: string, method: string, body?: { action: string }) =>
      body?.action === "start"
        ? { uploadId: "upload" }
        : method === "GET"
          ? {
              // The reload reads the partial upload; the manifest after start finds it complete.
              state: reads++ ? "verifying" : "pending",
              parts: [{ index: 0, verifiedAt: "now" }],
            }
          : {},
    );
    let shown: unknown;
    const local = {
      list: store.list,
      blob: vi.fn(async () => {
        shown = progress.at(-1)?.files[0];
        return blob;
      }),
    };
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store: local,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    expect(shown).toMatchObject({ sentBytes: 2, phase: "checking" });
    expect(progress.at(-1)).toMatchObject({ sentBytes: 4, files: [{ phase: "verifying" }] });
    expect(localStorage.getItem(key)).toBe("upload");
  });
  it("drops a remembered upload the server no longer knows and checks the original", async () => {
    const key = `recalino:audio-upload:${userId}:${run.id}:${sourceId}`;
    localStorage.setItem(key, "gone");
    const request = vi.fn(async (path: string, method: string, body?: { action: string }) => {
      if (path.endsWith("uploadId=gone")) throw new Error("not_found");
      if (body?.action === "start") return { uploadId: "fresh" };
      return method === "GET" ? { state: "verified", parts: [] } : {};
    });
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store,
      request: request as typeof workspaceRequest,
    });
    expect(request.mock.calls.some((call) => call[2]?.action === "start")).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("combines live XHR bytes with unknown event totals across concurrent parts before either finishes", async () => {
    const progress: AutomaticUploadProgress[] = [];
    const transfers = new Map<number, AudioXMLHttpRequest>();
    const written = new Set<number>();
    class AudioXMLHttpRequest {
      index = -1;
      status = 0;
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      open(_method: string, url: string) {
        this.index = Number(new URL(url).searchParams.get("index"));
      }
      setRequestHeader = vi.fn();
      send() {
        transfers.set(this.index, this);
      }
      abort = vi.fn();
      advance(bytes: number) {
        this.upload.onprogress?.({
          loaded: bytes,
          total: 0,
          lengthComputable: false,
        } as ProgressEvent);
      }
      finish() {
        written.add(this.index);
        this.status = 200;
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", AudioXMLHttpRequest);
    const actual = await vi.importActual<typeof import("./upload-progress")>("./upload-progress");
    transport.upload.mockImplementation(actual.uploadWithProgress);
    const request = vi.fn(
      async (path: string, method: string, body?: { action: string; index: number }) => {
        if (body?.action === "start") return { uploadId: "upload" };
        if (body?.action === "confirm_part") return { confirmed: written.has(body.index) };
        if (method === "GET" && path.includes("index="))
          return { url: `https://storage.example.test${path}` };
        if (method === "GET") return { state: "pending", parts: [] };
        return {};
      },
    );
    const upload = uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    await vi.waitFor(() => expect(transfers.size).toBe(2));
    transfers.get(0)?.advance(1);
    transfers.get(1)?.advance(1);
    expect(progress.at(-1)).toMatchObject({
      runId: run.id,
      sentBytes: 2,
      totalBytes: 4,
      files: [{ sourceId, sentBytes: 2, totalBytes: 4, phase: "uploading" }],
    });
    expect(written.size).toBe(0);
    transfers.get(1)?.finish();
    expect(progress.at(-1)?.sentBytes).toBe(3);
    transfers.get(0)?.finish();
    await upload;
    expect(progress.at(-1)).toMatchObject({
      sentBytes: 4,
      totalBytes: 4,
      files: [{ phase: "verifying" }],
    });
    expect(progress.every((value) => value.sentBytes <= value.totalBytes)).toBe(true);
    expect(request.mock.calls.filter((call) => call[2]?.action === "complete")).toHaveLength(1);
  });
  it("does not upload completed audio again while the server verifies it", async () => {
    const put = vi.fn();
    const progress = vi.fn();
    const request = vi.fn(async (_path, method: string, body?: { action: string }) =>
      body?.action === "start"
        ? { uploadId: "upload" }
        : method === "GET"
          ? { state: "verifying", parts: [] }
          : {},
    );
    await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store,
      put,
      request: request as typeof workspaceRequest,
      onTransferProgress: progress,
    });
    expect(put).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
    expect(progress).toHaveBeenLastCalledWith({
      runId: run.id,
      sentBytes: 4,
      totalBytes: 4,
      files: [
        { sourceId, displayName: "Audio file 1", sentBytes: 4, totalBytes: 4, phase: "verifying" },
      ],
    });
  });
  it("resets only a retried part's transmitted bytes instead of adding them to the next attempt", async () => {
    const progress: AutomaticUploadProgress[] = [];
    let attempts = 0;
    transport.upload.mockImplementation(
      async (
        _url: string,
        _part: Blob,
        _type: string,
        onProgress: (bytes: number, total: number) => void,
      ) => {
        attempts++;
        onProgress(attempts === 1 ? 3 : 2, 4);
        return { ok: attempts > 1, status: attempts === 1 ? 503 : 200 };
      },
    );
    const request = vi.fn(async (_path: string, method: string, body?: { action: string }) => {
      if (body?.action === "start") return { uploadId: "upload" };
      if (body?.action === "confirm_part") return { confirmed: attempts > 1 };
      if (method === "GET" && _path.includes("index="))
        return { url: "https://storage.example.test/part" };
      if (method === "GET") return { state: "pending", parts: [] };
      return {};
    });
    await uploadAutomaticAudio(run, snapshot, { partBytes: 4 } as InputContract, {
      userId,
      store,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    const bytes = progress.map((value) => value.sentBytes);
    const firstAttempt = bytes.indexOf(3);
    expect(bytes.slice(firstAttempt, firstAttempt + 3)).toEqual([3, 0, 2]);
    expect(progress.at(-1)).toMatchObject({
      sentBytes: 4,
      totalBytes: 4,
      files: [{ phase: "verifying" }],
    });
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });
  it("an audio part whose XHR keeps timing out is interrupted with the cause timeout and a content-free diagnostic", async () => {
    resetUploadFailureDiagnostics();
    class StalledXMLHttpRequest {
      status = 0;
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      abort = vi.fn();
      send() {
        this.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true } as ProgressEvent);
        this.ontimeout?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", StalledXMLHttpRequest);
    const actual = await vi.importActual<typeof import("./upload-progress")>("./upload-progress");
    transport.upload.mockImplementation(actual.uploadWithProgress);
    const request = vi.fn(async (path: string, method: string, body?: { action: string }) => {
      if (body?.action === "start") return { uploadId: "upload" };
      if (body?.action === "confirm_part") return { confirmed: false };
      if (method === "GET" && path.includes("index="))
        return { url: "https://storage.example.test/private-lecture.webm" };
      if (method === "GET") return { state: "pending", parts: [] };
      return {};
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = Symbol("pending");
      let failure: unknown = pending;
      uploadAutomaticAudio(run, snapshot, { partBytes: 4 } as InputContract, {
        userId,
        store,
        request: request as typeof workspaceRequest,
      }).then(
        () => {
          failure = undefined;
        },
        (error: unknown) => {
          failure = error;
        },
      );
      await vi.waitFor(() => expect(failure).not.toBe(pending), { timeout: 5000, interval: 250 });
      expect(failure).toBeInstanceOf(UploadInterruptedError);
      expect(failure).toMatchObject({
        message: "Audio upload was interrupted. The original is saved on this device.",
        lastCause: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
    expect(transport.upload).toHaveBeenCalledTimes(3);
    const diagnostics = uploadFailureDiagnostics();
    expect(diagnostics).toEqual({
      total: 1,
      recent: [{ kind: "timeout", part: 0, sentBytes: 1 }],
    });
    for (const hidden of [userId, sourceId, run.id, "lecture", "storage.example", "upload"])
      expect(JSON.stringify(diagnostics.recent)).not.toContain(hidden);
  });
  it("names a missing local recording and performs no upload", async () => {
    const request = vi
      .fn()
      .mockResolvedValue([{ assetId: sourceId, displayName: "Lecture part 2.webm" }]);
    const put = vi.fn();
    await expect(
      uploadAutomaticAudio(run, snapshot, contract, {
        userId,
        store: { list: async () => [], blob: async () => blob },
        put,
        request,
      }),
    ).rejects.toThrow("Lecture part 2.webm is not on this device");
    expect(put).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });
  it("cancels before another server write when deletion starts", async () => {
    let deleted = false;
    const request = vi.fn(async () => {
      deleted = true;
      return { uploadId: "upload" };
    });
    const put = vi.fn();
    await expect(
      uploadAutomaticAudio(run, snapshot, contract, {
        userId,
        store,
        request: request as typeof workspaceRequest,
        put,
        checkAllowed: () => {
          if (deleted) throw new DOMException("Deleting", "AbortError");
        },
      }),
    ).rejects.toThrow("Deleting");
    expect(request).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });
  it("D59: a refused start is a stable non-retryable reason, not a generic validation failure", async () => {
    const request = vi.fn(async () => {
      throw new WorkspaceRequestError(
        "Some information is missing or not valid.",
        "validation_failed",
        undefined,
        400,
        { reservation: ["confirmed_processing_required"] },
      );
    });
    const failure = await uploadAutomaticAudio(run, snapshot, contract, {
      userId,
      store,
      put: vi.fn(),
      request: request as typeof workspaceRequest,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AudioUploadProblem);
    expect(failure).toMatchObject({
      reason: "upload_closed",
      message: uploadCopy.audio.uploadClosed,
    });
    // One refused start, no automatic retries of a request that cannot succeed.
    expect(request).toHaveBeenCalledOnce();
  });
  it("transfers several audio files side by side with bounded simultaneous parts and per-file progress", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const bytes = new Blob(["abcdef"]);
    const many: RunSnapshot = {
      ...snapshot,
      sources: ids.map((id) => ({
        ...(snapshot.sources[0] as RunSnapshot["sources"][number]),
        sourceId: id,
        sha256: createHash("sha256").update("abcdef").digest("hex"),
      })),
    };
    const local = {
      list: vi.fn(async () => ids.map((id) => row({ sourceAssetId: id, bytes: 6 }))),
      blob: vi.fn(async () => bytes),
    };
    let active = 0,
      peak = 0;
    const started = new Set<string>();
    let open = () => {};
    const gate = { promise: new Promise<void>((done) => (open = done)), resolve: () => open() };
    const written = new Set<string>();
    const put = vi.fn(async (url: string) => {
      started.add(url.split("/")[3] ?? "");
      written.add(url);
      active++;
      peak = Math.max(peak, active);
      // Hold the first parts until two files are transferring at once.
      if (started.size >= 2) gate.resolve();
      await gate.promise;
      active--;
      return { ok: true, status: 200 };
    });
    const request = vi.fn(
      async (path: string, method: string, body?: { action: string }, key?: string) => {
        const id = path.split("/")[3];
        if (body?.action === "start") return { uploadId: `upload-${id}`, key };
        const index = /index=(\d+)/.exec(path)?.[1] ?? (body as { index?: number })?.index;
        const url = `https://storage.example.test/${id}/${index}`;
        if (body?.action === "confirm_part") return { confirmed: written.has(url) };
        if (method === "GET" && path.includes("index=")) return { url };
        if (method === "GET") return { state: "pending", parts: [] };
        return {};
      },
    );
    const progress: AutomaticUploadProgress[] = [];
    await uploadAutomaticAudio(run, many, contract, {
      userId,
      store: local,
      put,
      request: request as typeof workspaceRequest,
      onTransferProgress: (value) => progress.push(value),
    });
    expect(started.size).toBe(3);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(AUDIO_PART_CONCURRENCY);
    expect(put).toHaveBeenCalledTimes(9);
    for (const id of ids) {
      expect(
        request.mock.calls.filter((call) => call[3] === `audio-start:${run.id}:${id}`),
      ).toHaveLength(1);
      expect(
        request.mock.calls.filter((call) => call[3] === `audio-complete:${run.id}:${id}`),
      ).toHaveLength(1);
    }
    expect(progress.at(-1)).toMatchObject({
      sentBytes: 18,
      totalBytes: 18,
      files: ids.map((id) => ({ sourceId: id, sentBytes: 6, phase: "verifying" })),
    });
  });
});
