import { createHash, randomUUID } from "node:crypto";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPhoto, Recording } from "../recording/store";
import type { workspaceRequest } from "./api";
import {
  type AutomaticLearningStatus,
  automaticRecordingClasses,
  automaticRecordingMaterial,
  automaticResultNeedsRefresh,
  inAutomaticLearningBatch,
  pendingLearningBatch,
  prepareAutomaticRecordingPhotos,
  uploadAutomaticAudio,
  uploadAutomaticPhoto,
} from "./automatic-learning";

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
  it("registers and confirms every board photo before completing its audio preparation batch", async () => {
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
      "put",
      "complete-photo",
      "saved-photo",
      "register-photo",
      "put",
      "complete-photo",
      "saved-photo",
      "complete",
    ]);
    expect(saved.map((savedPhoto) => savedPhoto.blob)).toEqual(
      local.map((localPhoto) => localPhoto.blob),
    );
    expect(saved.every((savedPhoto) => savedPhoto.sourceAssetId)).toBe(true);
    expect(
      request.mock.calls.filter((call) => call[0] === "/api/sources").map((call) => call[3]),
    ).toEqual(local.map((photo) => `recorded-photo:${photo.id}`));
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
    expect(request.mock.calls[2]?.[2]).toEqual({ action: "begin", batchId });
    expect(request.mock.calls.at(-1)?.[2]).toEqual({ action: "complete", batchId });
    expect(store.savePhoto).toHaveBeenCalledWith({ ...local, sourceAssetId: sourceId });
  });
  it("reopens a photo fence after a lost completion acknowledgement and never reuploads verified photos", async () => {
    const recording = row(),
      local = photo(recording);
    const store = { photos: async () => [local], savePhoto: vi.fn() };
    const material = await automaticRecordingMaterial(userId, sessionId, [recording], store);
    if (!material) throw new Error("Expected finalized capture");
    let lost = true,
      closedId: string | null = null;
    const request = vi.fn(
      async (path: string, _method: string, body?: { action?: string; batchId?: string }) => {
        if (body?.action === "begin")
          return {
            state: "waiting_sources",
            batchId: body.batchId === closedId ? null : body.batchId,
          };
        if (body?.action === "complete" && lost) {
          lost = false;
          closedId = body.batchId ?? null;
          throw new TypeError("Lost completion");
        }
        if (path === "/api/sources") return { assetId: sourceId, uploadId: "photo-upload" };
        return { state: "verified", parts: [] };
      },
    );
    const put = vi.fn();
    await expect(
      prepareAutomaticRecordingPhotos(userId, material, contract, {
        store,
        request: request as typeof workspaceRequest,
        put,
      }),
    ).rejects.toThrow("Lost completion");
    material.photos[0] = { ...local, sourceAssetId: sourceId };
    await prepareAutomaticRecordingPhotos(userId, material, contract, {
      store,
      request: request as typeof workspaceRequest,
      put,
    });
    const begins = request.mock.calls.filter((call) => call[2]?.action === "begin");
    expect(begins).toHaveLength(3);
    expect(begins[1]?.[2]?.batchId).toBe(closedId);
    expect(begins[2]?.[2]?.batchId).not.toBe(closedId);
    expect(put).not.toHaveBeenCalled();
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

  it("skips verified parts, confirms unknown writes, and uses stable start/completion keys", async () => {
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
  });
  it("does not upload completed audio again while the server verifies it", async () => {
    const put = vi.fn();
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
    });
    expect(put).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => call[2]?.action === "complete")).toBe(false);
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
});
