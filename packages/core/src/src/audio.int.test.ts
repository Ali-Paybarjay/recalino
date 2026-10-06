import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { AppError, DEFAULT_PLT_SETTINGS, MemoryObjectStore, sha256Hex } from "../plt";
import {
  amounts,
  emptyAmounts,
  grantEntitlement,
  reservationIsOpen,
  reserveAllowance,
  settleAllowance,
} from "../quota";
import {
  beginTemporaryAudioUpload,
  confirmTemporaryAudioPart,
  temporaryAudioManifest,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "./audio";
import { readInputContract } from "./contracts";
import { sourceAudioVerificationJob } from "./jobs";
import { cleanupDeletedSource } from "./privacy";
import {
  acceptSourceNotice,
  confirmUploadPart,
  createSource,
  deleteSource,
  getSource,
  selectSourceSnapshot,
  uploadPartLink,
  verifyUpload,
} from "./service";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(multipart = false, storage = 0) {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  const contract = await readInputContract(db);
  const bytes = new Uint8Array(multipart ? contract.partBytes + 3 : 3);
  bytes.set([0x49, 0x44, 0x33]);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 100, storage }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic temporary audio tests",
  });
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic.mp3",
    durationMs: 4000,
    parts: [],
    operationKey: randomUUID(),
  });
  const hold = await db
    .transaction()
    .execute((tx) => reserveAllowance(tx, x.ctx, randomUUID(), amounts({ audio: 4 })));
  const parts = Array.from({ length: Math.ceil(bytes.length / contract.partBytes) }, (_, index) => {
    const chunk = bytes.subarray(index * contract.partBytes, (index + 1) * contract.partBytes);
    return { index, sizeBytes: chunk.length, sha256: sha256Hex(chunk) };
  });
  const upload = await beginTemporaryAudioUpload(db, x.ctx, source.assetId, {
    reservationId: hold.id,
    parts,
  });
  const store = new MemoryObjectStore();
  const link = await temporaryAudioPartLink(
    db,
    store,
    x.ctx,
    source.assetId,
    upload.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  return { ...x, bytes, source, hold, parts, upload, store, link, contract };
}
async function uploadAudioParts(x: Awaited<ReturnType<typeof fixture>>) {
  for (const part of x.parts) {
    const link = await temporaryAudioPartLink(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      x.upload.uploadId,
      part.index,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(
      x.store.upload(
        link.url,
        x.bytes.subarray(
          part.index * x.contract.partBytes,
          (part.index + 1) * x.contract.partBytes,
        ),
        "audio/mpeg",
      ),
    ).toBe(200);
  }
}
it("keeps original audio device-only, freezes the upload manifest and snapshots measured duration", async () => {
  const x = await fixture();
  expect(x.store.upload(x.link.url, x.bytes, "audio/mpeg")).toBe(200);
  await expect(
    beginTemporaryAudioUpload(db, x.ctx, x.source.assetId, {
      reservationId: x.hold.id,
      parts: [{ ...x.parts[0], index: 0, sizeBytes: x.bytes.length, sha256: "0".repeat(64) }],
    }),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  await verifyTemporaryAudio(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, {
    inspect: async () => ({ durationMs: 3200, audioOnly: true }),
  });
  expect((await getSource(db, x.ctx, x.source.assetId)).original_object_id).toBeNull();
  const snapshot = await selectSourceSnapshot(db, x.ctx, x.session.id);
  const source = snapshot.sources.find((s) => s.sourceId === x.source.assetId);
  expect(source?.durationMs).toBe(3200);
  expect(source?.objectId).toBeTruthy();
});
it("authoritatively confirms existing audio parts and refuses missing, corrupt, expired, foreign or closed-hold parts", async () => {
  const x = await fixture(),
    foreign = await fixture();
  expect(
    await confirmTemporaryAudioPart(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, 0),
  ).toBe("missing");
  expect(x.store.upload(x.link.url, x.bytes, "audio/mpeg")).toBe(200);
  // A repeated PUT may fail at Blob; no overwrite is needed to acknowledge already-arrived bytes.
  expect(
    await confirmTemporaryAudioPart(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, 0),
  ).toBe("verified");
  expect(
    await confirmTemporaryAudioPart(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, 0),
  ).toBe("verified");
  const manifest = await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId);
  expect(manifest.parts[0]?.verifiedAt).toBeInstanceOf(Date);
  const read = vi.spyOn(x.store, "head");
  await expect(
    confirmTemporaryAudioPart(db, x.store, foreign.ctx, x.source.assetId, x.upload.uploadId, 0),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(read).not.toHaveBeenCalled();
  await expect(
    confirmTemporaryAudioPart(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      x.upload.uploadId,
      0,
      new Date(manifest.expiresAt.getTime() + 1),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  await db.transaction().execute((tx) => settleAllowance(tx, x.ctx, x.hold.id, emptyAmounts()));
  await expect(
    confirmTemporaryAudioPart(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, 0),
  ).rejects.toMatchObject({ code: "conflict" });
  const corrupt = await fixture();
  expect(corrupt.store.upload(corrupt.link.url, new Uint8Array([1, 2, 3]), "audio/mpeg")).toBe(200);
  expect(
    await confirmTemporaryAudioPart(
      db,
      corrupt.store,
      corrupt.ctx,
      corrupt.source.assetId,
      corrupt.upload.uploadId,
      0,
    ),
  ).toBe("checksum_mismatch");
  expect(
    (await temporaryAudioManifest(db, corrupt.ctx, corrupt.source.assetId, corrupt.upload.uploadId))
      .parts[0]?.verifiedAt,
  ).toBeNull();
});
it("confirms audio and generic parts concurrently with only one database connection", async () => {
  const x = await fixture(false, 1000);
  const text = new TextEncoder().encode("Synthetic single connection text");
  const generic = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "text",
    mimeType: "text/plain",
    sizeBytes: text.length,
    sha256: sha256Hex(text),
    displayName: "one-connection.txt",
    operationKey: randomUUID(),
    parts: [{ index: 0, sizeBytes: text.length, sha256: sha256Hex(text) }],
  });
  if (!generic.uploadId) throw new Error("missing_upload");
  const link = await uploadPartLink(
    db,
    x.store,
    x.ctx,
    generic.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(x.store.upload(link.url, text, "text/plain")).toBe(200);
  expect(x.store.upload(x.link.url, x.bytes, "audio/mpeg")).toBe(200);
  const single = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
  try {
    await expect(
      Promise.all([
        confirmTemporaryAudioPart(single, x.store, x.ctx, x.source.assetId, x.upload.uploadId, 0),
        confirmUploadPart(single, x.store, x.ctx, generic.uploadId, 0),
      ]),
    ).resolves.toEqual(["verified", "verified"]);
  } finally {
    await single.destroy();
  }
}, 10000);
it("assembles multipart audio and generic sources with durable destinations on one connection", async () => {
  const contract = await readInputContract(db),
    x = await fixture(true, contract.partBytes + 6);
  const pdf = new Uint8Array(contract.partBytes + 6);
  pdf.set(new TextEncoder().encode("%PDF-1.6"));
  const parts = Array.from({ length: Math.ceil(pdf.length / contract.partBytes) }, (_, index) => {
    const chunk = pdf.subarray(index * contract.partBytes, (index + 1) * contract.partBytes);
    return { index, sizeBytes: chunk.length, sha256: sha256Hex(chunk) };
  });
  const generic = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: pdf.length,
    sha256: sha256Hex(pdf),
    displayName: "synthetic-multipart.pdf",
    parts,
    operationKey: randomUUID(),
  });
  if (!generic.uploadId) throw new Error("missing_upload");
  const destination = (await getSource(db, x.ctx, generic.assetId)).original_object_id;
  expect(destination).toBeTruthy();
  for (const part of x.parts) {
    const link = await temporaryAudioPartLink(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      x.upload.uploadId,
      part.index,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(
      x.store.upload(
        link.url,
        x.bytes.subarray(part.index * contract.partBytes, (part.index + 1) * contract.partBytes),
        "audio/mpeg",
      ),
    ).toBe(200);
  }
  for (const part of parts) {
    const link = await uploadPartLink(
      db,
      x.store,
      x.ctx,
      generic.uploadId,
      part.index,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(
      x.store.upload(
        link.url,
        pdf.subarray(part.index * contract.partBytes, (part.index + 1) * contract.partBytes),
        "application/pdf",
      ),
    ).toBe(200);
    expect(await confirmUploadPart(db, x.store, x.ctx, generic.uploadId, part.index)).toBe(
      "verified",
    );
  }
  const single = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
  try {
    const [audio, document] = await Promise.all([
      verifyTemporaryAudio(single, x.store, x.ctx, x.source.assetId, x.upload.uploadId, {
        inspect: async () => ({ durationMs: 3200, audioOnly: true }),
      }),
      verifyUpload(single, x.store, x.ctx, generic.uploadId, {
        verifier: { inspect: async () => ({ pageCount: 1 }) },
      }),
    ]);
    expect(audio.state).toBe("verified");
    expect(document.state).toBe("verified");
    expect((await getSource(single, x.ctx, generic.assetId)).original_object_id).toBe(destination);
  } finally {
    await single.destroy();
  }
}, 10000);
it("refund callback runs only after deterministic audio rejection, not before missing parts arrive", async () => {
  const x = await fixture();
  const verified = vi.fn(async () => undefined),
    rejected = vi.fn(async () => undefined);
  const job = sourceAudioVerificationJob(
    x.store,
    { inspect: async () => ({ durationMs: 0, audioOnly: false }) },
    verified,
    rejected,
  );
  const context = {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  };
  const input = {
    userId: x.ctx.userId,
    assetId: x.source.assetId,
    uploadId: x.upload.uploadId,
    runId: randomUUID(),
  };
  await expect(job.run(input, context)).rejects.toMatchObject({ code: "conflict" });
  expect(rejected).not.toHaveBeenCalled();
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "pending",
  );
  expect(x.store.upload(x.link.url, x.bytes, "audio/mpeg")).toBe(200);
  await expect(job.run(input, context)).rejects.toMatchObject({ code: "unsupported_media" });
  expect(rejected).toHaveBeenCalledOnce();
  expect(verified).not.toHaveBeenCalled();
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "rejected",
  );
});
it("FR-SRC-007 preserves multipart audio and its hold after an operational verifier failure so a retry can succeed", async () => {
  const x = await fixture(true);
  await uploadAudioParts(x);
  const operationalFailure = new AppError("internal");
  const compose = vi.spyOn(x.store, "compose");
  const inspect = vi
    .fn()
    .mockRejectedValueOnce(operationalFailure)
    .mockResolvedValueOnce({ durationMs: 3200, audioOnly: true });
  const verified = vi.fn(async () => undefined),
    rejected = vi.fn(async () => undefined);
  const job = sourceAudioVerificationJob(x.store, { inspect }, verified, rejected);
  const jobId = randomUUID(),
    runId = randomUUID();
  const input = {
    userId: x.ctx.userId,
    assetId: x.source.assetId,
    uploadId: x.upload.uploadId,
    runId,
  };
  const context = {
    db,
    now: () => new Date(),
    job: { id: jobId, attempt: 1 },
    step: async () => "ran" as const,
  };
  await expect(job.run(input, context)).rejects.toBe(operationalFailure);
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "pending",
  );
  expect(await reservationIsOpen(db, x.ctx, x.hold.id)).toBe(true);
  expect((await x.store.list("")).objects).toHaveLength(x.parts.length + 1);
  expect(verified).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();

  await job.run(input, { ...context, job: { id: jobId, attempt: 2 } });
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "verified",
  );
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(compose).toHaveBeenCalledOnce();
  expect(verified).toHaveBeenCalledExactlyOnceWith(
    db,
    { userId: x.ctx.userId, requestId: jobId },
    runId,
  );
  expect(rejected).not.toHaveBeenCalled();
});
it("FR-SRC-007 retries a multipart composition outage using the registered pending destination", async () => {
  const x = await fixture(true);
  await uploadAudioParts(x);
  const failure = new Error("Synthetic composition response was interrupted");
  const compose = x.store.compose.bind(x.store);
  const composing = vi.spyOn(x.store, "compose").mockImplementationOnce(async (...args) => {
    await compose(...args);
    throw failure;
  });
  const inspect = vi.fn(async () => ({ durationMs: 3200, audioOnly: true }));
  const verified = vi.fn(async () => undefined),
    rejected = vi.fn(async () => undefined);
  const job = sourceAudioVerificationJob(x.store, { inspect }, verified, rejected);
  const jobId = randomUUID();
  const input = {
    userId: x.ctx.userId,
    assetId: x.source.assetId,
    uploadId: x.upload.uploadId,
    runId: randomUUID(),
  };
  const context = {
    db,
    now: () => new Date(),
    job: { id: jobId, attempt: 1 },
    step: async () => "ran" as const,
  };
  await expect(job.run(input, context)).rejects.toBe(failure);
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "pending",
  );
  expect(await reservationIsOpen(db, x.ctx, x.hold.id)).toBe(true);
  expect(inspect).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();
  expect(verified).not.toHaveBeenCalled();
  expect((await x.store.list("")).objects).toHaveLength(x.parts.length);

  await job.run(input, { ...context, job: { id: jobId, attempt: 2 } });
  expect((await temporaryAudioManifest(db, x.ctx, x.source.assetId, x.upload.uploadId)).state).toBe(
    "verified",
  );
  expect(composing).toHaveBeenCalledTimes(2);
  expect(inspect).toHaveBeenCalledOnce();
  expect(verified).toHaveBeenCalledOnce();
  expect(rejected).not.toHaveBeenCalled();
});
it("waits for assembly before deletion and never republishes audio after physical cleanup", async () => {
  const x = await fixture(true);
  for (const part of x.parts) {
    const link = await temporaryAudioPartLink(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      x.upload.uploadId,
      part.index,
      DEFAULT_PLT_SETTINGS.storage,
    );
    const chunk = x.bytes.subarray(
      part.index * x.contract.partBytes,
      (part.index + 1) * x.contract.partBytes,
    );
    expect(x.store.upload(link.url, chunk, "audio/mpeg")).toBe(200);
  }
  const composing = gate(),
    allowCompose = gate(),
    inspecting = gate(),
    allowInspect = gate();
  const compose = x.store.compose.bind(x.store);
  vi.spyOn(x.store, "compose").mockImplementation(async (...args) => {
    composing.resolve();
    await allowCompose.promise;
    await compose(...args);
  });
  const verifying = verifyTemporaryAudio(db, x.store, x.ctx, x.source.assetId, x.upload.uploadId, {
    async inspect() {
      inspecting.resolve();
      await allowInspect.promise;
      return { durationMs: 3200, audioOnly: true };
    },
  });
  // Attach the rejection handler before deletion can interrupt the worker.
  const rejected = expect(verifying).rejects.toMatchObject({ code: "not_found" });
  await composing.promise;
  const deleting = deleteSource(db, x.ctx, x.source.assetId, "all");
  expect(
    await Promise.race([
      deleting.then(() => "deleted"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]),
  ).toBe("waiting");
  allowCompose.resolve();
  await inspecting.promise;
  await deleting;
  await cleanupDeletedSource(db, x.store, x.ctx, x.source.assetId);
  expect((await x.store.list("")).objects).toEqual([]);
  allowInspect.resolve();
  await rejected;
  const manifest = await db
    .selectFrom("src.audio_upload")
    .select(["state", "actual_duration_ms"])
    .where("id", "=", x.upload.uploadId)
    .executeTakeFirstOrThrow();
  expect(manifest).toEqual({ state: "deleted", actual_duration_ms: null });
  expect((await x.store.list("")).objects).toEqual([]);
});
