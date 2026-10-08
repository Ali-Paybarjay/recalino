import type { InputContract } from "@recalino/core/src";
import { beforeEach, expect, it, vi } from "vitest";
import type { RecordingStore } from "../recording/store";
import type { workspaceRequest } from "./api";
import { prepareFileHashes } from "./file-hashes";
import { uploadSourceFileParts } from "./source-upload";
import { uploadQueuedFile } from "./upload-file";
import type { UploadBatch, UploadEntry } from "./upload-store";

vi.mock("./source-upload", () => ({ uploadSourceFileParts: vi.fn() }));
vi.mock("./file-hashes", () => ({ prepareFileHashes: vi.fn() }));
beforeEach(() => {
  vi.mocked(uploadSourceFileParts).mockReset().mockResolvedValue();
  vi.mocked(prepareFileHashes).mockReset().mockResolvedValue({ sha256: "fingerprint", parts: [] });
});
function fixture(audio = false) {
  const entry: UploadEntry = {
    id: "file",
    creationKey: "stable-key",
    displayName: audio ? "class.mp3" : "notes.txt",
    mimeType: audio ? "audio/mpeg" : "text/plain",
    lastModified: 0,
    sizeBytes: 4,
    phase: "queued",
    sentBytes: 0,
    startedAt: 0,
    serverSeen: false,
    prepared: {
      sha256: "fingerprint",
      parts: audio ? [] : [{ index: 0, sizeBytes: 4, sha256: "part" }],
      ...(audio ? { durationMs: 1000 } : {}),
    },
  };
  const batch = {
    id: "batch",
    userId: "owner",
    sessionId: "class",
    storageConfigured: true,
    entries: [entry],
    contract: {
      partBytes: 4,
      formats: { text: { maxBytes: 100 }, audio: { maxBytes: 100, maxDurationMs: 2000 } },
    } as InputContract,
  } as UploadBatch;
  const events: string[] = [];
  const request = vi.fn(async (path: string, method: string, body?: unknown) => {
    if (method === "GET") return [];
    if (path === "/api/sources") {
      events.push("created");
      return { assetId: "asset", uploadId: audio ? null : "upload" };
    }
    if ((body as { action?: string })?.action === "register_file") {
      events.push("registered");
      return {};
    }
    return {};
  });
  const recordings = {
    get: vi.fn().mockResolvedValue(null),
    blob: vi.fn().mockResolvedValue(new Blob(["data"])),
    put: vi.fn(async () => {
      events.push("recording-metadata");
    }),
    append: vi.fn(async () => {
      events.push("recording-bytes");
    }),
  };
  const deps = {
    request: request as typeof workspaceRequest,
    recordings: recordings as unknown as RecordingStore,
    recovery: {},
    patch: vi.fn(async (patch: Partial<UploadEntry>, persist?: boolean) => {
      Object.assign(entry, patch);
      if (persist && patch.source) events.push("source-checkpoint");
    }),
  };
  return { entry, batch, events, request, recordings, deps };
}
it("FR-SRC-004 checkpoints source identity before registering or transferring its bytes", async () => {
  const f = fixture();
  await uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps);
  expect(f.events.slice(0, 3)).toEqual(["created", "source-checkpoint", "registered"]);
  expect(
    vi
      .mocked(f.request as typeof workspaceRequest)
      .mock.calls.find((call) => call[0] === "/api/sources" && call[1] === "POST")?.[3],
  ).toBe("stable-key");
  expect(uploadSourceFileParts).toHaveBeenCalledWith(
    expect.objectContaining({ uploadId: "upload", file: expect.any(File) }),
    expect.objectContaining({ request: f.request }),
  );
  expect(f.entry.phase).toBe("verifying");
});
it("FR-REC-003 commits imported audio before telling the server that the declared file is registered", async () => {
  const f = fixture(true);
  await uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps);
  expect(f.events.indexOf("recording-bytes")).toBeLessThan(f.events.indexOf("registered"));
  expect(f.entry.phase).toBe("local_saved");
  expect(f.entry.sentBytes).toBe(0);
  expect(uploadSourceFileParts).not.toHaveBeenCalled();
});
it("FR-REC-003 a restart after audio append never appends the same original a second time", async () => {
  const f = fixture(true);
  f.recordings.get.mockResolvedValue({ id: "asset", bytes: 4 });
  await uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps);
  expect(f.recordings.append).not.toHaveBeenCalled();
  expect(f.events).toContain("registered");
});
it("FR-REC-003 a failed local save never unlocks an audio batch on the server", async () => {
  const f = fixture(true);
  f.recordings.append.mockRejectedValue(new Error("Device is full"));
  await expect(uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps)).rejects.toThrow(
    "Device is full",
  );
  expect(f.events).not.toContain("registered");
});
it("FR-REC-003 same-length corruption does not discard the queued original or acknowledge an audio file", async () => {
  const f = fixture(true);
  f.recordings.get.mockResolvedValue({ id: "asset", bytes: 4 });
  vi.mocked(prepareFileHashes).mockResolvedValue({ sha256: "different", parts: [] });
  await expect(uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps)).rejects.toThrow(
    "does not match",
  );
  expect(f.events).not.toContain("registered");
  expect(f.entry.phase).not.toBe("local_saved");
});
it("FR-SRC-004 a resumed transfer reuses persisted source/registration checkpoints", async () => {
  const f = fixture();
  await uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps);
  f.request.mockClear();
  await uploadQueuedFile(f.batch, f.entry, new Blob(["data"]), f.deps);
  expect(f.request).not.toHaveBeenCalled();
  expect(uploadSourceFileParts).toHaveBeenCalledTimes(2);
});
