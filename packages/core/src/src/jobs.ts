import { z } from "zod";
import { lockAccountForCleanup } from "../acc";
import type { Database } from "../db";
import {
  deleteObject,
  errors,
  type JobDefinition,
  type LearnerContext,
  type ObjectStore,
  type PeriodicJob,
} from "../plt";
import { emptyAmounts, releaseStorage, reservationIsOpen, settleAllowance } from "../quota";
import { type AudioVerifier, temporaryAudioManifest, verifyTemporaryAudio } from "./audio";
import { confirmUploadPart, type SourceVerifier, uploadManifest, verifyUpload } from "./service";

const payload = z.strictObject({ userId: z.uuid(), uploadId: z.uuid() });
const audioPayload = z.strictObject({
  userId: z.uuid(),
  assetId: z.uuid(),
  uploadId: z.uuid(),
  runId: z.uuid(),
});
export function sourceAudioVerificationJob(
  store: ObjectStore,
  verifier: AudioVerifier,
  onVerified: (db: Database, ctx: LearnerContext, runId: string) => Promise<void>,
  onRejected?: (db: Database, ctx: LearnerContext, runId: string) => Promise<void>,
): JobDefinition<z.infer<typeof audioPayload>> {
  return {
    kind: "src.verify_audio",
    version: 1,
    payload: audioPayload,
    async run(input, job) {
      const actor = { userId: input.userId, requestId: job.job.id };
      try {
        await verifyTemporaryAudio(
          job.db,
          store,
          actor,
          input.assetId,
          input.uploadId,
          verifier,
          job.now(),
        );
      } catch (failure) {
        const manifest = await temporaryAudioManifest(job.db, actor, input.assetId, input.uploadId);
        if (manifest.state === "rejected") await onRejected?.(job.db, actor, input.runId);
        throw failure;
      }
      await onVerified(job.db, actor, input.runId);
    },
  };
}
/** File bytes are fetched by workers only; route handlers accept metadata and ids. */
export function sourceVerificationJob(
  store: ObjectStore,
  verifier: SourceVerifier,
): JobDefinition<z.infer<typeof payload>> {
  return {
    kind: "src.verify_upload",
    version: 1,
    payload,
    async run(input, job) {
      const actor = { userId: input.userId, requestId: job.job.id };
      const manifest = await uploadManifest(job.db, actor, input.uploadId);
      if (["verified", "rejected", "abandoned", "deleted"].includes(manifest.state)) return;
      for (const part of manifest.parts) {
        if (part.verifiedAt) continue;
        const result = await confirmUploadPart(
          job.db,
          store,
          actor,
          input.uploadId,
          part.index,
          job.now(),
        );
        if (result !== "verified") throw errors.conflict();
      }
      await verifyUpload(job.db, store, actor, input.uploadId, { verifier }, job.now());
    },
  };
}

/** FR-SRC-014 and FR-SRC-013: release pending holds and retry physical cleanup. */
export async function maintainSources(
  db: Database,
  store: ObjectStore,
  now = new Date(),
  scope?: { userId: string; assetIds: string[] },
) {
  const expired = await db
    .selectFrom("src.upload_session")
    .selectAll()
    .where("state", "in", ["pending", "verifying"])
    .where("expires_at", "<=", now)
    .$if(scope !== undefined, (qb) =>
      qb.where("user_id", "=", scope?.userId ?? "").where("asset_id", "in", scope?.assetIds ?? []),
    )
    .execute();
  let abandoned = 0,
    removed = 0;
  for (const upload of expired) {
    const ctx: LearnerContext = { userId: upload.user_id, requestId: "src-maintenance" };
    await db.transaction().execute(async (tx) => {
      await lockAccountForCleanup(tx, upload.user_id);
      const live = await tx
        .selectFrom("src.upload_session")
        .selectAll()
        .where("id", "=", upload.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!["pending", "verifying"].includes(live.state)) return;
      if (await reservationIsOpen(tx, ctx, live.reservation_id))
        await settleAllowance(tx, ctx, live.reservation_id, emptyAmounts(), now);
      await tx
        .updateTable("src.upload_session")
        .set({ state: "abandoned", completed_at: now })
        .where("id", "=", live.id)
        .execute();
      abandoned++;
    });
  }
  const uploads = await db
    .selectFrom("src.upload_session as upload")
    .innerJoin("src.asset as asset", "asset.id", "upload.asset_id")
    .select([
      "upload.id",
      "upload.user_id",
      "upload.state",
      "upload.reservation_id",
      "asset.original_object_id",
      "asset.original_deleted_at",
    ])
    .where((eb) =>
      eb.or([
        eb("upload.state", "in", ["verified", "rejected", "abandoned", "deleted"]),
        eb("asset.original_deleted_at", "is not", null),
      ]),
    )
    .$if(scope !== undefined, (qb) =>
      qb
        .where("asset.user_id", "=", scope?.userId ?? "")
        .where("asset.id", "in", scope?.assetIds ?? []),
    )
    .execute();
  for (const upload of uploads) {
    await db.transaction().execute(async (tx) => {
      await lockAccountForCleanup(tx, upload.user_id);
      const live = await tx
        .selectFrom("src.upload_session as upload")
        .innerJoin("src.asset as asset", "asset.id", "upload.asset_id")
        .select([
          "upload.state",
          "upload.reservation_id",
          "asset.original_object_id",
          "asset.original_deleted_at",
        ])
        .where("upload.id", "=", upload.id)
        .where("upload.user_id", "=", upload.user_id)
        .executeTakeFirstOrThrow();
      if (
        !["verified", "rejected", "abandoned", "deleted"].includes(live.state) &&
        !live.original_deleted_at
      )
        return;
      const actor = { userId: upload.user_id };
      const parts = await tx
        .selectFrom("src.upload_part")
        .select("object_id")
        .where("upload_id", "=", upload.id)
        .execute();
      for (const part of parts) {
        if (
          live.state === "verified" &&
          !live.original_deleted_at &&
          part.object_id === live.original_object_id
        )
          continue;
        await deleteObject(db, store, actor, part.object_id, now);
        removed++;
      }
      if ((live.original_deleted_at || live.state !== "verified") && live.original_object_id)
        await deleteObject(db, store, actor, live.original_object_id, now);
      if (live.original_deleted_at) {
        const ctx = { userId: upload.user_id, requestId: "src-cleanup" };
        if (await reservationIsOpen(tx, ctx, live.reservation_id))
          await settleAllowance(tx, ctx, live.reservation_id, emptyAmounts(), now);
        else await releaseStorage(tx, ctx, live.reservation_id, now);
        await tx
          .updateTable("src.upload_session")
          .set({ state: "deleted", completed_at: now })
          .where("id", "=", upload.id)
          .execute();
      }
    });
  }
  const audio = await db
    .selectFrom("src.audio_upload as upload")
    .innerJoin("src.asset as asset", "asset.id", "upload.asset_id")
    .select(["upload.id", "upload.object_id", "upload.user_id"])
    .$if(scope === undefined, (qb) => qb.where("upload.state", "!=", "deleted"))
    .where((eb) =>
      eb.or([eb("upload.expires_at", "<=", now), eb("asset.tombstoned_at", "is not", null)]),
    )
    .$if(scope !== undefined, (qb) =>
      qb
        .where("asset.user_id", "=", scope?.userId ?? "")
        .where("asset.id", "in", scope?.assetIds ?? []),
    )
    .execute();
  for (const upload of audio) {
    await db.transaction().execute(async (tx) => {
      await lockAccountForCleanup(tx, upload.user_id);
      const live = await tx
        .selectFrom("src.audio_upload as upload")
        .innerJoin("src.asset as asset", "asset.id", "upload.asset_id")
        .select(["upload.object_id", "upload.state", "upload.expires_at", "asset.tombstoned_at"])
        .where("upload.id", "=", upload.id)
        .where("upload.user_id", "=", upload.user_id)
        .executeTakeFirstOrThrow();
      if (!live.tombstoned_at && live.expires_at > now) return;
      const parts = await tx
        .selectFrom("src.audio_upload_part")
        .select("object_id")
        .where("upload_id", "=", upload.id)
        .execute();
      for (const id of new Set([live.object_id, ...parts.map((part) => part.object_id)]))
        await deleteObject(db, store, { userId: upload.user_id }, id, now);
      await tx
        .updateTable("src.audio_upload")
        .set({ state: "deleted", deleted_at: now })
        .where("id", "=", upload.id)
        .execute();
    });
  }
  return { abandoned, removed };
}
export function sourceMaintenanceJob(store: ObjectStore): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "src.maintenance",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, ctx) {
        await maintainSources(ctx.db, store, ctx.now());
      },
    },
  };
}
