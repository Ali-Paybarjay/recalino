import { z } from "zod";
import type { Database, Tx } from "../db";
import { assertSessionOwner } from "../org";
import { AppError, type LearnerContext, ownedObjectMetadata } from "../plt";

/** Owned class receipts for upload orchestration; source table access stays in this module. */
export async function batchSourceStates(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  sourceIds: readonly string[],
  includeInactive = false,
) {
  await assertSessionOwner(db, ctx, z.uuid().parse(sessionId));
  const ids = [...new Set(sourceIds.map((id) => z.uuid().parse(id)))];
  if (!ids.length) return [];
  return db
    .selectFrom("src.session_source as link")
    .innerJoin("src.asset as asset", "asset.id", "link.asset_id")
    .leftJoin("src.upload_session as upload", "upload.asset_id", "asset.id")
    .select([
      "asset.id as sourceId",
      "asset.kind",
      "asset.verified_at as verifiedAt",
      "asset.tombstoned_at as tombstonedAt",
      "asset.original_deleted_at as originalDeletedAt",
      "upload.state as uploadState",
      "upload.rejection_reason as rejectionReason",
      "link.active",
    ])
    .where("link.session_id", "=", sessionId)
    .where("link.user_id", "=", ctx.userId)
    .where("asset.user_id", "=", ctx.userId)
    .where("asset.id", "in", ids)
    .$if(!includeInactive, (query) => query.where("link.active", "=", true))
    .execute();
}

/** Source diagnostics expose availability, never storage keys or other learners' rows. */
export async function ownedSourceAvailability(
  db: Database | Tx,
  ctx: LearnerContext,
  sourceIds: readonly string[],
  now = new Date(),
): Promise<{ sourceId: string; displayName: string; originalAvailable: boolean }[]> {
  const ids = [...new Set(sourceIds.map((id) => z.uuid().parse(id)))];
  if (!ids.length) return [];
  const assets = await db
    .selectFrom("src.asset")
    .select(["id", "display_name", "kind", "original_object_id", "original_deleted_at"])
    .where("id", "in", ids)
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is", null)
    .execute();
  const audio = await db
    .selectFrom("src.audio_upload")
    .select(["asset_id", "object_id"])
    .where("asset_id", "in", ids)
    .where("user_id", "=", ctx.userId)
    .where("state", "=", "verified")
    .where("expires_at", ">", now)
    .execute();
  const objects = new Map<string, Promise<boolean>>();
  const verified = (objectId: string) => {
    let result = objects.get(objectId);
    if (!result) {
      result = ownedObjectMetadata(db, ctx, objectId)
        .then((object) => object.state === "verified")
        .catch((error: unknown) => {
          if (error instanceof AppError && error.code === "not_found") return false;
          throw error;
        });
      objects.set(objectId, result);
    }
    return result;
  };
  return Promise.all(
    assets.map(async (asset) => ({
      sourceId: asset.id,
      displayName: asset.display_name,
      originalAvailable:
        asset.kind === "audio"
          ? (
              await Promise.all(
                audio
                  .filter((upload) => upload.asset_id === asset.id)
                  .map((upload) => verified(upload.object_id)),
              )
            ).some(Boolean)
          : !asset.original_deleted_at &&
            !!asset.original_object_id &&
            (await verified(asset.original_object_id)),
    })),
  );
}

/** A verified upload can wake only its owner's active links. */
export async function verifiedUploadSessionIds(
  db: Database | Tx,
  ctx: LearnerContext,
  uploadId: string,
): Promise<string[]> {
  const upload = await db
    .selectFrom("src.upload_session")
    .select(["asset_id", "state"])
    .where("id", "=", z.uuid().parse(uploadId))
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (upload?.state !== "verified") return [];
  const links = await db
    .selectFrom("src.session_source")
    .select("session_id")
    .where("asset_id", "=", upload.asset_id)
    .where("user_id", "=", ctx.userId)
    .where("active", "=", true)
    .execute();
  return links.map((link) => link.session_id);
}

/** Recover a lost final complete request only after all parts have authoritative receipts. */
export async function receivedSourceUploadIds(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  sourceIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(sourceIds.map((id) => z.uuid().parse(id)))];
  if (!ids.length) return [];
  const rows = await db
    .selectFrom("src.upload_session as upload")
    .innerJoin("src.asset as asset", "asset.id", "upload.asset_id")
    .innerJoin("src.session_source as link", "link.asset_id", "asset.id")
    .select("upload.id")
    .where("upload.user_id", "=", ctx.userId)
    .where("upload.state", "in", ["pending", "verifying"])
    .where("asset.id", "in", ids)
    .where("asset.user_id", "=", ctx.userId)
    .where("asset.tombstoned_at", "is", null)
    .where("asset.original_deleted_at", "is", null)
    .where("link.session_id", "=", sessionId)
    .where("link.user_id", "=", ctx.userId)
    .where("link.active", "=", true)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("src.upload_part as part")
          .select("part.upload_id")
          .whereRef("part.upload_id", "=", "upload.id"),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("src.upload_part as missing")
            .select("missing.upload_id")
            .whereRef("missing.upload_id", "=", "upload.id")
            .where("missing.verified_at", "is", null),
        ),
      ),
    )
    .execute();
  return rows.map((row) => row.id);
}

/** Receipt/rejection wake-ups may only reach the source owner's active classes. */
export async function uploadSessionIds(
  db: Database,
  ctx: LearnerContext,
  uploadId: string,
): Promise<string[]> {
  const upload = await db
    .selectFrom("src.upload_session")
    .select("asset_id")
    .where("id", "=", z.uuid().parse(uploadId))
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (!upload) return [];
  const links = await db
    .selectFrom("src.session_source")
    .select("session_id")
    .where("asset_id", "=", upload.asset_id)
    .where("user_id", "=", ctx.userId)
    .where("active", "=", true)
    .execute();
  return links.map((link) => link.session_id);
}
