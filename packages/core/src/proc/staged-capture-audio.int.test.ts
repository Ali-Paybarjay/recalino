import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import type { AiProvider } from "../aip";
import { createDatabase } from "../db";
import { captureInProgress, releaseCaptureLease, renewCaptureLease } from "../org";
import { DEFAULT_PLT_SETTINGS, errors, MemoryObjectStore, sha256Hex } from "../plt";
import { amounts, grantEntitlement } from "../quota";
import {
  acceptSourceNotice,
  beginStagedAudioUpload,
  confirmTemporaryAudioPart,
  createSource,
  expireTemporaryAudio,
  selectSourceSnapshot,
  stagedAudioManifest,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "../src";
import { createProcessingRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());

const unavailable = async (): Promise<never> => {
  throw new Error("Synthetic staging never calls an AI provider");
};
const provider: AiProvider = {
  name: "synthetic",
  mode: "mock",
  settings: {
    version: "fixture",
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "1",
    maxInputCharacters: 10000,
    maxOutputTokens: 1000,
    timeoutMs: 1000,
    maximumMicros: 10,
    currency: "USD",
    priceVersion: "fixture",
    charactersPerPage: 1000,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
  },
  structured: unavailable,
  transcribe: unavailable,
  speech: unavailable,
};

async function capturePart(operationKey = `recorded-source:${randomUUID()}`) {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 100, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic staged capture tests",
  });
  // A synthetic WebM-shaped header; the verifier below is synthetic too.
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/webm",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Session recording 2026-10-12 · Part 1",
    // What an old client would have declared from its clock; the copy holds 4.02 s.
    durationMs: 29 * 60 * 1000,
    parts: [],
    operationKey,
  });
  const store = new MemoryObjectStore();
  const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
  async function stage() {
    const staged = await beginStagedAudioUpload(db, x.ctx, source.assetId, { parts });
    const link = await temporaryAudioPartLink(
      db,
      store,
      x.ctx,
      source.assetId,
      staged.uploadId,
      0,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(store.upload(link.url, bytes, "audio/webm")).toBe(200);
    expect(
      await confirmTemporaryAudioPart(db, store, x.ctx, source.assetId, staged.uploadId, 0),
    ).toBe("verified");
    await verifyTemporaryAudio(db, store, x.ctx, source.assetId, staged.uploadId, {
      inspect: async () => ({ durationMs: 4020, audioOnly: true }),
    });
    return staged;
  }
  return { ...x, source, store, parts, stage };
}

async function heldAndConsumed(userId: string) {
  return db
    .selectFrom("quota.reservation")
    .select(["id", "operation_key"])
    .where("user_id", "=", userId)
    .execute();
}

it("stages a sealed part during capture without any hold, and the run after Stop adopts it (D60, D59)", async () => {
  const x = await capturePart();
  const staged = await x.stage();
  expect(await heldAndConsumed(x.ctx.userId)).toEqual([]);
  const manifest = await stagedAudioManifest(db, x.ctx, x.source.assetId, staged.uploadId);
  expect(manifest).toMatchObject({ state: "verified", reservationId: null });

  const snapshot = await selectSourceSnapshot(db, x.ctx, x.session.id);
  expect(snapshot.sources).toEqual([
    expect.objectContaining({ sourceId: x.source.assetId, durationMs: 4020 }),
  ]);
  expect(snapshot.sources[0]?.objectId).toBeTruthy();
  const run = await createProcessingRun(
    db,
    x.ctx,
    {
      sessionId: x.session.id,
      operationKey: randomUUID(),
      expectedFingerprint: snapshot.fingerprint,
      expectedSourcesVersion: snapshot.sourcesVersion,
    },
    { job: processingJob({ store: x.store, provider }), provider },
  );
  // No second transfer: the run is queued at once and reserves the measured seconds once,
  // never the 29 minutes a clock would have declared (D59, PRD-REC-05).
  expect(run.state).toBe("queued");
  const saved = await db
    .selectFrom("proc.processing_run")
    .select("requested_amounts")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  expect(saved.requested_amounts).toEqual(amounts({ audio: 5, regeneration: 1 }));
  expect(await heldAndConsumed(x.ctx.userId)).toHaveLength(1);
  // Staging again after the copy is verified sends nothing.
  expect(await beginStagedAudioUpload(db, x.ctx, x.source.assetId, { parts: x.parts })).toEqual({
    uploadId: staged.uploadId,
    state: "verified",
  });
});

it("resumes the same staged upload and refuses a different manifest", async () => {
  const x = await capturePart();
  const first = await beginStagedAudioUpload(db, x.ctx, x.source.assetId, { parts: x.parts });
  expect(await beginStagedAudioUpload(db, x.ctx, x.source.assetId, { parts: x.parts })).toEqual(
    first,
  );
  await expect(
    beginStagedAudioUpload(db, x.ctx, x.source.assetId, {
      parts: [{ ...x.parts[0], sha256: "0".repeat(64) }],
    }),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
});

it("stages only the learner's own in-app recording parts", async () => {
  const notRecorded = await capturePart(randomUUID());
  await expect(
    beginStagedAudioUpload(db, notRecorded.ctx, notRecorded.source.assetId, {
      parts: notRecorded.parts,
    }),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { audio: ["recorded_part_required"] } },
  });
  const owner = await capturePart();
  const other = await capturePart();
  await expect(
    beginStagedAudioUpload(db, other.ctx, owner.source.assetId, { parts: owner.parts }),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("deletes a rejected staged copy at the next sweep, far inside D29's seven days", async () => {
  const x = await capturePart();
  const staged = await beginStagedAudioUpload(db, x.ctx, x.source.assetId, { parts: x.parts });
  const link = await temporaryAudioPartLink(
    db,
    x.store,
    x.ctx,
    x.source.assetId,
    staged.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(
    x.store.upload(link.url, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), "audio/webm"),
  ).toBe(200);
  await confirmTemporaryAudioPart(db, x.store, x.ctx, x.source.assetId, staged.uploadId, 0);
  await expect(
    verifyTemporaryAudio(db, x.store, x.ctx, x.source.assetId, staged.uploadId, {
      inspect: async () => {
        throw errors.unsupportedMedia();
      },
    }),
  ).rejects.toThrow();
  const after = await db
    .selectFrom("src.audio_upload")
    .select(["state", "expires_at"])
    .where("id", "=", staged.uploadId)
    .executeTakeFirstOrThrow();
  expect(after.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 3600 * 1000);
  await expireTemporaryAudio(db, x.store, new Date(Date.now() + 7 * 24 * 3600 * 1000 + 1));
  const row = await db
    .selectFrom("src.audio_upload")
    .select("state")
    .where("id", "=", staged.uploadId)
    .executeTakeFirstOrThrow();
  expect(row.state).toBe("deleted");
  // The class run after Stop then transfers the part from the device as before.
  expect(
    await beginStagedAudioUpload(db, x.ctx, x.source.assetId, { parts: x.parts }),
  ).toMatchObject({
    uploadId: staged.uploadId,
    state: "deleted",
  });
});

it("deletes a staged copy that no run used when its upload window ends (D29)", async () => {
  const x = await capturePart();
  const staged = await x.stage();
  const later = new Date(Date.now() + 25 * 3600 * 1000);
  await expireTemporaryAudio(db, x.store, later);
  const row = await db
    .selectFrom("src.audio_upload")
    .select(["state", "deleted_at"])
    .where("id", "=", staged.uploadId)
    .executeTakeFirstOrThrow();
  expect(row.state).toBe("deleted");
  expect(row.deleted_at).toBeTruthy();
});

it("holds automatic learning with a capture lease that Stop releases and that lapses", async () => {
  const x = await capturePart();
  const now = new Date();
  expect(await captureInProgress(db, x.ctx, x.session.id, now)).toBe(false);
  await renewCaptureLease(db, x.ctx, x.session.id, now);
  expect(await captureInProgress(db, x.ctx, x.session.id, now)).toBe(true);
  expect(
    await captureInProgress(db, x.ctx, x.session.id, new Date(now.getTime() + 16 * 60000)),
  ).toBe(false);
  await releaseCaptureLease(db, x.ctx, x.session.id);
  expect(await captureInProgress(db, x.ctx, x.session.id, now)).toBe(false);
  const other = await capturePart();
  await expect(renewCaptureLease(db, other.ctx, x.session.id)).rejects.toMatchObject({
    code: "not_found",
  });
});
