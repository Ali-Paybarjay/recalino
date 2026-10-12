import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import type { JobDefinition } from "../plt";
import { createObject, errors, type LearnerContext, type ObjectStore } from "../plt";
import {
  type AudioVerifier,
  audioManifestSchema,
  temporaryAudioManifest,
  verifyTemporaryAudio,
} from "./audio";
import { readInputContract } from "./contracts";
import { getSource } from "./service";

/**
 * D60 (owner decision 2026-10-12): sealed in-app recording parts are uploaded while the class is
 * still being recorded. The copy is staged without an allowance hold; the class run created after
 * Stop reserves and charges by the usual rules (D59) and adopts the verified copy, so the part is
 * never transferred, reserved or charged twice. The copy keeps D29 retention: it expires with its
 * upload window if no run transcribes it, and within 24 hours of a successful transcription.
 */

/** Recorded parts are registered by the app with this idempotency prefix (source-sync). */
const RECORDED_PART_KEY = "recorded-source:";

export const stagedAudioManifestSchema = audioManifestSchema.pick({ parts: true });

/**
 * Starts (or resumes) the staged upload of one registered in-app recording part. Only parts the
 * app registered from its own capture, linked to one of the learner's classes, can be staged.
 */
export async function beginStagedAudioUpload(
  db: Database,
  ctx: LearnerContext,
  assetId: string,
  raw: unknown,
  now = new Date(),
): Promise<{ uploadId: string; state: string }> {
  const input = stagedAudioManifestSchema.parse(raw);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.userId}, 17))`.execute(tx);
    const source = await getSource(tx, ctx, assetId);
    if (
      source.kind !== "audio" ||
      source.original_deleted_at ||
      !source.operation_key?.startsWith(RECORDED_PART_KEY)
    )
      throw errors.validationFailed({ audio: ["recorded_part_required"] });
    const linked = await tx
      .selectFrom("src.session_source")
      .select("session_id")
      .where("asset_id", "=", assetId)
      .where("user_id", "=", ctx.userId)
      .where("active", "=", true)
      .executeTakeFirst();
    if (!linked) throw errors.validationFailed({ audio: ["class_required"] });
    // A verified copy, staged or bound to a run, is already on the server: nothing to send.
    const verified = await tx
      .selectFrom("src.audio_upload")
      .select(["id", "state"])
      .where("asset_id", "=", assetId)
      .where("user_id", "=", ctx.userId)
      .where("state", "=", "verified")
      .where("expires_at", ">", now)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (verified) return { uploadId: verified.id, state: verified.state };
    const previous = await tx
      .selectFrom("src.audio_upload")
      .selectAll()
      .where("asset_id", "=", assetId)
      .where("user_id", "=", ctx.userId)
      .where("reservation_id", "is", null)
      .executeTakeFirst();
    if (previous) {
      const stored = await tx
        .selectFrom("src.audio_upload_part")
        .select(["part_index as index", "size_bytes as sizeBytes", "sha256"])
        .where("upload_id", "=", previous.id)
        .orderBy("part_index")
        .execute();
      if (
        stored.length !== input.parts.length ||
        stored.some((part, i) => {
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
      // A rejected, expired or deleted staged copy is final; the run after Stop uploads instead.
      return {
        uploadId: previous.id,
        state:
          previous.state === "pending" && previous.expires_at <= now ? "expired" : previous.state,
      };
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
        reservation_id: null,
        staged_at: now,
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

/** The manifest of a staged copy only; a run's upload is never reachable through this path. */
export async function stagedAudioManifest(
  db: Database | Tx,
  ctx: LearnerContext,
  assetId: string,
  uploadId: string,
) {
  const manifest = await temporaryAudioManifest(db, ctx, assetId, uploadId);
  if (manifest.reservationId !== null) throw errors.notFound();
  return manifest;
}

const stagedPayload = z.strictObject({
  userId: z.uuid(),
  assetId: z.uuid(),
  uploadId: z.uuid(),
});
/** Decodes and verifies a staged copy like any class audio; nothing is reserved or charged. */
export function stagedAudioVerificationJob(
  store: ObjectStore,
  verifier: AudioVerifier,
  onVerified?: (db: Database, ctx: LearnerContext, assetId: string) => Promise<void>,
): JobDefinition<z.infer<typeof stagedPayload>> {
  return {
    kind: "src.verify_staged_audio",
    version: 1,
    payload: stagedPayload,
    async run(input, job) {
      const actor = { userId: input.userId, requestId: job.job.id };
      const manifest = await stagedAudioManifest(job.db, actor, input.assetId, input.uploadId);
      if (manifest.state === "rejected" || manifest.state === "deleted") return;
      await verifyTemporaryAudio(
        job.db,
        store,
        actor,
        input.assetId,
        input.uploadId,
        verifier,
        job.now(),
      );
      await onVerified?.(job.db, actor, input.assetId);
    },
  };
}
