import { z } from "zod";
import type { Database, Tx } from "../db";
import { AppError, type LearnerContext, ownedObjectMetadata } from "../plt";

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
