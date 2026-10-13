import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import {
  AppError,
  assertOwner,
  composeOwnedObjects,
  confirmObject,
  createObject,
  deleteObject,
  errors,
  issueWriteLink,
  type LearnerContext,
  type ObjectStore,
  ownedObjectMetadata,
  type PltSettings,
  readOwnedObject,
} from "../plt";
import { reservationIsOpen } from "../quota";
import { readInputContract, sha256Schema } from "./contracts";
import { getSource } from "./service";

/** FR-SRC-007 rule 6: how often expired temporary class audio is deleted. */
export const TEMPORARY_AUDIO_SWEEP_SECONDS = 300;
/**
 * D29 allows at most 24 hours after a successful transcript. The copy expires two sweeps sooner:
 * the next sweep may start one interval later, and the cron minute and the queue get the other.
 */
const TRANSCRIBED_AUDIO_TTL_MS = (24 * 3600 - 2 * TEMPORARY_AUDIO_SWEEP_SECONDS) * 1000;

export const audioManifestSchema = z.strictObject({
  reservationId: z.uuid(),
  parts: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        sizeBytes: z.number().int().positive(),
        sha256: sha256Schema,
      }),
    )
    .min(1)
    .max(10000),
});

/** A staged capture part (D60) has no hold until its run exists; any other upload needs its open hold. */
export async function holdIsOpen(
  db: Database | Tx,
  ctx: LearnerContext,
  reservationId: string | null,
) {
  return reservationId === null || reservationIsOpen(db, ctx, reservationId);
}
/** A queued acoustic check may use only its exact, still-live temporary class original. */
export async function liveTemporaryAudioObject(
  db: Database | Tx,
  ctx: LearnerContext,
  assetId: string,
  objectId: string,
  now = new Date(),
): Promise<boolean> {
  const source = await getSource(db, ctx, assetId);
  if (source.kind !== "audio" || source.original_deleted_at) return false;
  const upload = await db
    .selectFrom("src.audio_upload")
    .select("id")
    .where("asset_id", "=", assetId)
    .where("user_id", "=", ctx.userId)
    .where("object_id", "=", objectId)
    .where("state", "=", "verified")
    .where("expires_at", ">", now)
    .executeTakeFirst();
  if (!upload) return false;
  try {
    return (await ownedObjectMetadata(db, ctx, objectId)).state === "verified";
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return false;
    throw error;
  }
}
/**
 * Temporary upload receipts of one confirmed hold, by source. A selected audio source without a
 * receipt never started its upload; the expiry sweep reports that separately from a rejection.
 */
export async function temporaryAudioUploadStates(
  db: Database | Tx,
  ctx: LearnerContext,
  reservationId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("src.audio_upload")
    .select(["asset_id", "state"])
    .where("user_id", "=", ctx.userId)
    .where("reservation_id", "=", reservationId)
    .execute();
  return new Map(rows.map((row) => [row.asset_id, row.state]));
}
/**
 * Operator report (NFR-07): when each confirmed hold's temporary audio upload started and when its
 * last original was verified (null until all are). Times only; no class content.
 */
export async function audioUploadWindows(
  db: Database | Tx,
  reservationIds: readonly string[],
): Promise<Map<string, { startedAt: Date; verifiedAt: Date | null }>> {
  if (!reservationIds.length) return new Map();
  const rows = await db
    .selectFrom("src.audio_upload")
    .select((eb) => [
      "reservation_id as reservationId",
      eb.fn.min("created_at").as("startedAt"),
      sql<Date | null>`case when bool_and(verified_at is not null) then max(verified_at) end`.as(
        "verifiedAt",
      ),
    ])
    .where("reservation_id", "in", [...reservationIds])
    .groupBy("reservation_id")
    .execute();
  return new Map(
    rows.map((row) => [
      row.reservationId,
      {
        startedAt: new Date(row.startedAt),
        verifiedAt: row.verifiedAt && new Date(row.verifiedAt),
      },
    ]),
  );
}
export async function beginTemporaryAudioUpload(
  db: Database,
  ctx: LearnerContext,
  assetId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = audioManifestSchema.parse(raw);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.userId}, 17))`.execute(tx);
    const source = await getSource(tx, ctx, assetId);
    if (source.kind !== "audio" || source.original_deleted_at) throw errors.conflict();
    // An open hold of this learner is required, not a positive audio amount: under D59 a
    // confirmed run reserves no audio seconds for content already paid for in this period.
    // The route binds the hold to its awaiting run first (`validateAudioUploadRun`).
    if (!(await reservationIsOpen(tx, ctx, input.reservationId)))
      throw errors.validationFailed({ reservation: ["confirmed_processing_required"] });
    const previous = await tx
      .selectFrom("src.audio_upload")
      .selectAll()
      .where("asset_id", "=", assetId)
      .where("reservation_id", "=", input.reservationId)
      .executeTakeFirst();
    if (previous) {
      const manifest = await tx
        .selectFrom("src.audio_upload_part")
        .select(["part_index as index", "size_bytes as sizeBytes", "sha256"])
        .where("upload_id", "=", previous.id)
        .orderBy("part_index")
        .execute();
      if (
        manifest.length !== input.parts.length ||
        manifest.some((part, i) => {
          const incoming = input.parts[i];
          return (
            !incoming ||
            part.index !== incoming.index ||
            Number(part.sizeBytes) !== incoming.sizeBytes ||
            part.sha256 !== incoming.sha256
          );
        })
      )
        throw errors.idempotencyMismatch();
      return { uploadId: previous.id, state: previous.state };
    }
    const contract = await readInputContract(tx, source.contract_version);
    if (
      input.parts.reduce((sum, part) => sum + part.sizeBytes, 0) !== Number(source.size_bytes) ||
      input.parts.some(
        (part, i) =>
          part.index !== i ||
          part.sizeBytes > contract.partBytes ||
          (i < input.parts.length - 1 && part.sizeBytes !== contract.partBytes),
      )
    )
      throw errors.validationFailed({ parts: ["invalid_manifest"] });
    const object = await createObject(tx, {
      module: "src",
      ownerUserId: ctx.userId,
      retention: "temporary",
      contentType: source.declared_mime,
      sizeBytes: Number(source.size_bytes),
      now,
    });
    const upload = await tx
      .insertInto("src.audio_upload")
      .values({
        user_id: ctx.userId,
        asset_id: assetId,
        reservation_id: input.reservationId,
        object_id: object.id,
        expires_at: new Date(now.getTime() + contract.uploadTtlSeconds * 1000),
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    for (const part of input.parts) {
      const storage =
        input.parts.length === 1
          ? object
          : await createObject(tx, {
              module: "src",
              ownerUserId: ctx.userId,
              retention: "temporary",
              contentType: source.declared_mime,
              sizeBytes: part.sizeBytes,
              now,
            });
      await tx
        .insertInto("src.audio_upload_part")
        .values({
          upload_id: upload.id,
          part_index: part.index,
          object_id: storage.id,
          size_bytes: part.sizeBytes,
          sha256: part.sha256,
        })
        .execute();
    }
    return { uploadId: upload.id, state: upload.state };
  });
}
export async function temporaryAudioManifest(
  db: Database | Tx,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
) {
  await getSource(db, ctx, assetId);
  const row = await db
    .selectFrom("src.audio_upload")
    .selectAll()
    .where("id", "=", uploadId)
    .where("asset_id", "=", assetId)
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  const parts = await db
    .selectFrom("src.audio_upload_part")
    .select(["part_index as index", "verified_at as verifiedAt"])
    .where("upload_id", "=", uploadId)
    .orderBy("part_index")
    .execute();
  return {
    uploadId: row.id,
    state: row.state,
    expiresAt: row.expires_at,
    reservationId: row.reservation_id,
    parts,
  };
}
export async function temporaryAudioPartLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
  index: number,
  settings: PltSettings["storage"],
  now = new Date(),
) {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const manifest = await temporaryAudioManifest(tx, ctx, assetId, uploadId);
    const source = await getSource(tx, ctx, assetId);
    if (
      source.original_deleted_at ||
      manifest.state !== "pending" ||
      manifest.expiresAt <= now ||
      !(await holdIsOpen(tx, ctx, manifest.reservationId))
    )
      throw errors.conflict();
    const part = await tx
      .selectFrom("src.audio_upload_part")
      .select("object_id")
      .where("upload_id", "=", uploadId)
      .where("part_index", "=", index)
      .executeTakeFirst();
    if (!part) throw errors.notFound();
    return issueWriteLink(tx, store, ctx, part.object_id, { settings, now });
  });
}
/** Authoritative retry acknowledgement for an immutable existing part after a failed browser PUT. */
export async function confirmTemporaryAudioPart(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
  index: number,
  now = new Date(),
) {
  z.uuid().parse(uploadId);
  z.number().int().nonnegative().parse(index);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.userId}, 17))`.execute(tx);
    const manifest = await temporaryAudioManifest(tx, ctx, assetId, uploadId);
    const source = await getSource(tx, ctx, assetId);
    const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
    if (
      source.kind !== "audio" ||
      source.original_deleted_at ||
      manifest.state !== "pending" ||
      manifest.expiresAt <= checkedAt ||
      !(await holdIsOpen(tx, ctx, manifest.reservationId))
    )
      throw errors.conflict();
    const part = await tx
      .selectFrom("src.audio_upload_part")
      .selectAll()
      .where("upload_id", "=", uploadId)
      .where("part_index", "=", index)
      .executeTakeFirst();
    if (!part) throw errors.notFound();
    const object = await ownedObjectMetadata(tx, ctx, part.object_id);
    if (object.contentType !== source.declared_mime || object.sizeBytes !== Number(part.size_bytes))
      throw errors.conflict();
    const result = await confirmObject(tx, store, ctx, part.object_id, {
      now: checkedAt,
      sha256: part.sha256,
    });
    const verifiedAt = new Date(Math.max(checkedAt.getTime(), Date.now()));
    if (manifest.expiresAt <= verifiedAt || !(await holdIsOpen(tx, ctx, manifest.reservationId)))
      throw errors.conflict();
    if (result === "verified")
      await tx
        .updateTable("src.audio_upload_part")
        .set({ verified_at: part.verified_at ?? verifiedAt })
        .where("upload_id", "=", uploadId)
        .where("part_index", "=", index)
        .execute();
    return result;
  });
}
export interface AudioVerifier {
  inspect(bytes: Uint8Array, mimeType: string): Promise<{ durationMs: number; audioOnly: boolean }>;
}
function rejectsTemporaryAudio(failure: unknown): failure is AppError {
  if (!(failure instanceof AppError)) return false;
  const fields = failure.details?.fields as Record<string, unknown> | undefined;
  return (
    failure.code === "unsupported_media" ||
    (failure.code === "validation_failed" && fields?.audio !== undefined)
  );
}
async function verifyPendingTemporaryAudio(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
  verifier: AudioVerifier,
  now = new Date(),
) {
  let stagedObjectId: string | undefined;
  try {
    const assembled = await db.transaction().execute(async (tx) => {
      // Source/account deletion and cleanup hold this same lock. A provider write must
      // finish with its durable source pointer registered before deletion can proceed.
      await lockAccount(tx, ctx.userId);
      const manifest = await temporaryAudioManifest(tx, ctx, assetId, uploadId);
      if (manifest.state === "verified") return { verified: true as const, manifest };
      if (
        manifest.state !== "pending" ||
        manifest.expiresAt <= now ||
        !(await holdIsOpen(tx, ctx, manifest.reservationId))
      )
        throw errors.conflict();
      const source = await getSource(tx, ctx, assetId);
      if (source.original_deleted_at) throw errors.notFound();
      const parts = await tx
        .selectFrom("src.audio_upload_part")
        .selectAll()
        .where("upload_id", "=", uploadId)
        .orderBy("part_index")
        .execute();
      if (!parts.length) throw errors.conflict();
      for (const part of parts) {
        const result = await confirmObject(tx, store, ctx, part.object_id, {
          now,
          sha256: part.sha256,
        });
        if (result === "missing") throw errors.conflict();
        if (result !== "verified") throw errors.validationFailed({ audio: ["integrity"] });
        await tx
          .updateTable("src.audio_upload_part")
          .set({ verified_at: now })
          .where("upload_id", "=", uploadId)
          .where("part_index", "=", part.part_index)
          .execute();
      }
      const original = await tx
        .selectFrom("src.audio_upload")
        .selectAll()
        .where("id", "=", uploadId)
        .where("user_id", "=", ctx.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      let objectId = original.object_id;
      if (parts.length > 1) {
        const existing = await ownedObjectMetadata(tx, ctx, objectId);
        if (existing.state !== "verified") {
          stagedObjectId = objectId;
          objectId = await composeOwnedObjects(tx, store, ctx, {
            targetObjectId: objectId,
            objectIds: parts.map((part) => part.object_id),
            contentType: source.declared_mime,
            sizeBytes: Number(source.size_bytes),
            now,
            retention: "temporary",
          });
        }
      }
      return { verified: false as const, source, objectId, reservationId: original.reservation_id };
    });
    if (assembled.verified) return assembled.manifest;
    const { source, objectId } = assembled;
    const bytes = await readOwnedObject(db, store, ctx, objectId);
    if (
      bytes.length !== Number(source.size_bytes) ||
      createHash("sha256").update(bytes).digest("hex") !== source.sha256
    )
      throw errors.validationFailed({ audio: ["integrity"] });
    const actual = await verifier.inspect(bytes, source.declared_mime);
    const contract = await readInputContract(db, source.contract_version);
    if (
      !actual.audioOnly ||
      !Number.isFinite(actual.durationMs) ||
      actual.durationMs <= 0 ||
      actual.durationMs > (contract.formats.audio.maxDurationMs ?? 0)
    )
      throw errors.unsupportedMedia();
    return await db.transaction().execute(async (tx) => {
      await lockAccount(tx, ctx.userId);
      const liveSource = await getSource(tx, ctx, assetId);
      if (liveSource.original_deleted_at) throw errors.notFound();
      const live = await tx
        .selectFrom("src.audio_upload")
        .selectAll()
        .where("id", "=", uploadId)
        .where("user_id", "=", ctx.userId)
        .where("asset_id", "=", assetId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const verifiedAt = new Date(Math.max(now.getTime(), Date.now()));
      if (
        live.object_id !== objectId ||
        !["pending", "verified"].includes(live.state) ||
        live.expires_at <= verifiedAt ||
        !(await holdIsOpen(tx, ctx, assembled.reservationId))
      )
        throw errors.conflict();
      // The measured duration is published only while the source and hold remain live.
      await tx
        .updateTable("src.audio_upload")
        .set({
          state: "verified",
          verified_at: verifiedAt,
          actual_duration_ms: Math.floor(actual.durationMs),
        })
        .where("id", "=", uploadId)
        .where("state", "=", "pending")
        .execute();
      return temporaryAudioManifest(tx, ctx, assetId, uploadId);
    });
  } catch (failure) {
    // Decoder availability/timeouts are retryable operational failures. Keep the verified
    // assembled object and its durable upload pointer so a later attempt can inspect it.
    if (stagedObjectId && rejectsTemporaryAudio(failure))
      await deleteObject(db, store, ctx, stagedObjectId, now);
    throw failure;
  }
}
export async function verifyTemporaryAudio(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
  verifier: AudioVerifier,
  now = new Date(),
) {
  await temporaryAudioManifest(db, ctx, assetId, uploadId);
  try {
    return await verifyPendingTemporaryAudio(db, store, ctx, assetId, uploadId, verifier, now);
  } catch (failure) {
    if (rejectsTemporaryAudio(failure)) {
      await db
        .updateTable("src.audio_upload")
        .set({ state: "rejected", expires_at: now })
        .where("id", "=", uploadId)
        .where("asset_id", "=", assetId)
        .where("user_id", "=", ctx.userId)
        .where("state", "=", "pending")
        .execute();
    }
    throw failure;
  }
}
export async function markAudioTranscribed(
  tx: Tx,
  ctx: LearnerContext,
  objectId: string,
  now = new Date(),
) {
  const row = await tx
    .selectFrom("src.audio_upload")
    .selectAll()
    .where("object_id", "=", objectId)
    .where("user_id", "=", ctx.userId)
    .where("state", "=", "verified")
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  if (!row.transcribed_at)
    await tx
      .updateTable("src.audio_upload")
      .set({
        transcribed_at: now,
        expires_at: new Date(
          Math.min(row.expires_at.getTime(), now.getTime() + TRANSCRIBED_AUDIO_TTL_MS),
        ),
      })
      .where("id", "=", row.id)
      .execute();
}

export async function markSourceAudioTranscribed(
  db: Database,
  ctx: LearnerContext,
  sourceId: string,
  now = new Date(),
) {
  await db.transaction().execute(async (tx) => {
    await getSource(tx, ctx, sourceId);
    const rows = await tx
      .selectFrom("src.audio_upload")
      .select("object_id")
      .where("asset_id", "=", sourceId)
      .where("user_id", "=", ctx.userId)
      .where("state", "=", "verified")
      .execute();
    for (const row of rows) await markAudioTranscribed(tx, ctx, row.object_id, now);
  });
}
