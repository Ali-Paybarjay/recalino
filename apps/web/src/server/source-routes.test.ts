import { createDatabase } from "@recalino/core/db";
import { errors, MemoryObjectStore } from "@recalino/core/plt";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { uploadWithConfirmation } from "../ui/workspace/upload";
import { sourceAudioHandler, sourcePartHandler } from "./source-routes";

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  run: vi.fn(),
  manifest: vi.fn(),
  validateRun: vi.fn(),
  confirmPart: vi.fn(),
  uploadManifest: vi.fn(),
  confirmUploadPart: vi.fn(),
  uploadSessionIds: vi.fn(),
  enqueue: vi.fn(),
  runJobsSoon: vi.fn(),
  audioJob: vi.fn(),
}));
vi.mock("@recalino/core/plt", async (original) => ({
  ...(await original<object>()),
  enqueueJob: mocks.enqueue,
}));
vi.mock("@recalino/core/src", async (original) => ({
  ...(await original<object>()),
  getSource: mocks.source,
  temporaryAudioManifest: mocks.manifest,
  confirmTemporaryAudioPart: mocks.confirmPart,
  uploadManifest: mocks.uploadManifest,
  confirmUploadPart: mocks.confirmUploadPart,
  uploadSessionIds: mocks.uploadSessionIds,
}));
vi.mock("@recalino/core/proc", async (original) => ({
  ...(await original<object>()),
  getRun: mocks.run,
  validateAudioUploadRun: mocks.validateRun,
}));
vi.mock("./storage", () => ({ getObjectStore: () => new MemoryObjectStore() }));
vi.mock("./jobs", () => ({ runJobsSoon: mocks.runJobsSoon }));
vi.mock("./source-jobs", () => ({
  sourceAudioJobDefinition: mocks.audioJob,
  sourceUploadJobDefinition: vi.fn(),
}));

// Domain calls are mocked; constructing the pool never connects to a database.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
const assetId = "12345678-1234-4234-8234-123456789aaa";
const uploadId = "12345678-1234-4234-8234-123456789bbb";
const runId = "12345678-1234-4234-8234-123456789ccc";
const reservationId = "12345678-1234-4234-8234-123456789ddd";
const ctx = {
  userId: "12345678-1234-4234-8234-123456789abc",
  route: "sourceAudio",
  requestId: "synthetic-audio-confirmation",
};
const learner = { userId: ctx.userId, requestId: ctx.requestId };
afterAll(() => db.destroy());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.source.mockResolvedValue({ kind: "audio" });
  mocks.run.mockResolvedValue({ id: runId });
  mocks.manifest.mockResolvedValue({ reservationId });
  mocks.validateRun.mockResolvedValue(undefined);
  mocks.uploadSessionIds.mockResolvedValue([]);
});
function confirm() {
  return sourceAudioHandler(assetId)({
    db,
    ctx,
    request: new Request(`https://recalino.test/api/sources/${assetId}/audio`, { method: "POST" }),
    input: { action: "confirm_part", runId, uploadId, index: 3 },
  });
}

function confirmPhotoPart() {
  return sourcePartHandler(
    uploadId,
    "0",
  )({
    db,
    ctx,
    request: new Request(`https://recalino.test/api/sources/uploads/${uploadId}/parts/0`, {
      method: "POST",
    }),
    input: undefined,
  });
}

it("FR-SRC-004 permits a new board photo PUT after its preflight finds no stored bytes", async () => {
  mocks.confirmUploadPart.mockResolvedValueOnce("missing").mockResolvedValueOnce("verified");
  const write = vi.fn().mockResolvedValue({ ok: true, status: 201 });
  await uploadWithConfirmation(
    write,
    async () => (await confirmPhotoPart()).body,
    "Synthetic photo upload interrupted",
    { attempts: 3, confirmBeforeWrite: true, confirmSuccess: true },
  );
  expect(write).toHaveBeenCalledTimes(1);
  expect(mocks.confirmUploadPart).toHaveBeenCalledTimes(2);
  expect(mocks.confirmUploadPart.mock.invocationCallOrder[0]).toBeLessThan(
    write.mock.invocationCallOrder[0] ?? 0,
  );
});

it.each(["size_mismatch", "type_mismatch", "checksum_mismatch"])(
  "FR-SRC-004 keeps a photo %s distinct from absent bytes",
  async (result) => {
    mocks.confirmUploadPart.mockResolvedValue(result);
    await expect(confirmPhotoPart()).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { upload: ["part_not_verified"] } },
    });
  },
);

it("FR-SRC-004 distinguishes an absent audio part from a verified part for safe retries", async () => {
  mocks.confirmPart.mockResolvedValueOnce("missing").mockResolvedValueOnce("verified");
  await expect(confirm()).resolves.toEqual({ body: { confirmed: false } });
  await expect(confirm()).resolves.toEqual({ body: { confirmed: true } });
  expect(mocks.validateRun).toHaveBeenCalledWith(db, learner, runId, assetId, reservationId);
  expect(mocks.confirmPart).toHaveBeenCalledWith(
    db,
    expect.any(MemoryObjectStore),
    learner,
    assetId,
    uploadId,
    3,
  );
});

it.each(["size_mismatch", "type_mismatch", "checksum_mismatch"])(
  "FR-SRC-004 exposes %s as a terminal audio integrity error",
  async (result) => {
    mocks.confirmPart.mockResolvedValue(result);
    await expect(confirm()).rejects.toMatchObject({
      status: 400,
      code: "validation_failed",
      details: { fields: { audio: ["part_integrity_mismatch"] } },
    });
  },
);

it("FR-PLT-002 never treats a foreign source as an absent transferable part", async () => {
  mocks.source.mockRejectedValue(errors.ownershipDenied());
  await expect(confirm()).rejects.toMatchObject({ code: "not_found" });
  expect(mocks.confirmPart).not.toHaveBeenCalled();
});

it("FR-SRC-004 preserves expired or closed processing reservations as terminal conflicts", async () => {
  mocks.validateRun.mockRejectedValue(errors.conflict());
  await expect(confirm()).rejects.toMatchObject({ code: "conflict" });
  expect(mocks.confirmPart).not.toHaveBeenCalled();
});

it("moves a completed audio upload through verification into processing without waiting for cron", async () => {
  const definition = { kind: "src.verify_audio" };
  mocks.audioJob.mockReturnValue(definition);
  mocks.enqueue.mockResolvedValue("audio-verification-job");
  const transaction = db.transaction();
  const transactionSpy = vi.spyOn(db, "transaction").mockReturnValue(transaction);
  const executeSpy = vi
    .spyOn(transaction, "execute")
    .mockImplementation(async (effect) => effect(db as unknown as Parameters<typeof effect>[0]));
  try {
    await expect(
      sourceAudioHandler(assetId)({
        db,
        ctx,
        request: new Request(`https://recalino.test/api/sources/${assetId}/audio`, {
          method: "POST",
        }),
        input: { action: "complete", runId, uploadId },
      }),
    ).resolves.toEqual({
      status: 202,
      body: { reservationId, jobId: "audio-verification-job" },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      db,
      definition,
      expect.objectContaining({
        payload: { userId: ctx.userId, assetId, uploadId, runId },
        singletonKey: `audio:${uploadId}`,
      }),
    );
    expect(mocks.runJobsSoon).toHaveBeenCalledExactlyOnceWith(
      ["src.verify_audio", "proc.process"],
      90,
    );
  } finally {
    executeSpy.mockRestore();
    transactionSpy.mockRestore();
  }
});
