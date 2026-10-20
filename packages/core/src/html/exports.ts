import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import type { Database, DB, Tx } from "../db";
import { getNotebookRevision, liveNotebookRevisionIds } from "../note";
import {
  AppError,
  assertExportSize,
  assertOwner,
  canonicalJson,
  createLogger,
  createObject,
  deleteObject,
  type ExportArtifact,
  type ExportMedia,
  type ExportMediaBytes,
  type ExportSettings,
  errors,
  exportMediaSchema,
  exportSettingsSchema,
  issueReadLink,
  isValidIdempotencyKey,
  type JobDefinition,
  type LearnerContext,
  type Logger,
  type ObjectStore,
  ownedObjectMetadata,
  type PeriodicJob,
  type PltSettings,
  parseSnapshot,
  sha256Hex,
  storedObject,
  writeOwnedObject,
} from "../plt";
import { renderNotebookHtml } from "./render";

export const htmlExportRequestSchema = z.strictObject({
  revisionId: z.uuid(),
  mediaIds: z.array(z.uuid()).max(100).default([]),
});
export type HtmlExportRequest = z.input<typeof htmlExportRequestSchema>;
export interface HtmlMediaReader {
  describe(db: Database | Tx, ctx: LearnerContext, id: string): Promise<ExportMedia>;
  read(
    db: Database,
    store: ObjectStore,
    ctx: LearnerContext,
    expected: ExportMedia,
  ): Promise<ExportMediaBytes>;
}
/**
 * `html.export_artifact.snapshot`, version 1 (QUA-05). The notes model was validated, projected
 * and frozen when the export was requested, so only its container is checked on read.
 */
export const htmlSnapshotSchema = z.looseObject({
  revisionId: z.uuid(),
  revisionNumber: z.number().int().positive(),
  model: storedObject<Awaited<ReturnType<typeof getNotebookRevision>>["model"]>(),
  createdAt: z.string().min(1),
  media: z.array(exportMediaSchema),
});
type HtmlSnapshot = z.infer<typeof htmlSnapshotSchema>;
const htmlSnapshotRevisionSchema = htmlSnapshotSchema.pick({ revisionId: true });
const htmlSnapshotMediaSchema = htmlSnapshotSchema.pick({ media: true });
function view(row: Selectable<DB["html.export_artifact"]>): ExportArtifact {
  return {
    id: row.id,
    sessionId: row.session_id,
    schemaVersion: "1",
    state: row.state as ExportArtifact["state"],
    estimatedBytes: Number(row.estimated_bytes),
    actualBytes: row.actual_bytes === null ? null : Number(row.actual_bytes),
    sha256: row.sha256,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastError: row.last_error,
  };
}
async function owned(db: Database | Tx, ctx: LearnerContext, id: string, now: Date) {
  z.uuid().parse(id);
  const row = await db
    .selectFrom("html.export_artifact")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  assertOwner(row && !row.tombstoned_at ? { ownerId: row.user_id } : undefined, ctx);
  if (!row || row.expires_at <= now || !row.snapshot) throw errors.notFound();
  const snapshot = parseSnapshot(htmlSnapshotRevisionSchema, row.snapshot);
  await getNotebookRevision(db, ctx, snapshot.revisionId);
  return row;
}
export async function requestHtmlExport(
  db: Database,
  ctx: LearnerContext,
  raw: HtmlExportRequest,
  options: {
    key: string;
    settings: ExportSettings;
    media?: HtmlMediaReader;
    now?: Date;
    onCreated?: (tx: Tx, artifact: ExportArtifact) => Promise<void>;
  },
): Promise<ExportArtifact> {
  const input = htmlExportRequestSchema.parse(raw);
  const settings = exportSettingsSchema.parse(options.settings);
  const now = options.now ?? new Date();
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const hash = sha256Hex(canonicalJson(input));
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const prior = await tx
      .selectFrom("html.export_artifact")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", options.key)
      .executeTakeFirst();
    if (prior) {
      if (prior.request_hash !== hash) throw errors.idempotencyMismatch();
      await owned(tx, ctx, prior.id, now);
      const replay = view(prior);
      await options.onCreated?.(tx, replay);
      return replay;
    }
    const revision = await getNotebookRevision(tx, ctx, input.revisionId);
    if (new Set(input.mediaIds).size !== input.mediaIds.length)
      throw errors.validationFailed({ mediaIds: ["duplicate"] });
    if (input.mediaIds.length && !options.media)
      throw errors.validationFailed({ media: ["reader_unavailable"] });
    const media: ExportMedia[] = [];
    for (const id of input.mediaIds) {
      const asset = await options.media?.describe(tx, ctx, id);
      if (
        !asset ||
        asset.sessionId !== revision.sessionId ||
        asset.kind !== "image" ||
        !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)
      )
        throw errors.validationFailed({ media: ["owned_permitted_image_required"] });
      media.push(asset);
    }
    const snapshot: HtmlSnapshot = {
      revisionId: revision.id,
      revisionNumber: revision.number,
      model: revision.model,
      createdAt: revision.createdAt,
      media,
    };
    const items =
      revision.model.learningItems.length +
      revision.model.topics.reduce((n, t) => n + t.claims.length, 0) +
      revision.model.summary.length +
      revision.model.homework.length +
      revision.model.uncertainties.length;
    if (items > settings.maxItems) throw errors.validationFailed({ items: ["export_limit"] });
    const estimated =
      renderNotebookHtml(snapshot).length +
      media.reduce((n, m) => n + Math.ceil(m.byteLength / 3) * 4 + 512, 0);
    assertExportSize(estimated, settings);
    const row = await tx
      .insertInto("html.export_artifact")
      .values({
        user_id: ctx.userId,
        session_id: revision.sessionId,
        schema_version: "1",
        operation_key: options.key,
        request_hash: hash,
        snapshot: JSON.stringify(snapshot),
        settings: JSON.stringify(settings),
        estimated_bytes: estimated,
        created_at: now,
        expires_at: new Date(now.getTime() + settings.retentionSeconds * 1000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const artifact = view(row);
    await options.onCreated?.(tx, artifact);
    return artifact;
  });
}
export async function getHtmlExport(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
  now = new Date(),
): Promise<ExportArtifact> {
  return view(await owned(db, ctx, id, now));
}
export async function listHtmlExports(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
  log: Logger = createLogger(),
): Promise<ExportArtifact[]> {
  const rows = await db
    .selectFrom("html.export_artifact")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .where("expires_at", ">", now)
    .orderBy("created_at", "desc")
    .execute();
  // PERF-04: the same checks as getHtmlExport for every listed export, in a constant number of
  // reads: an export is listed only while the notes revision it copied is readable.
  const snapshots = rows.flatMap((row) => {
    if (!row.snapshot) return [];
    // D100: one export whose stored snapshot is malformed is left out (logged by its id only, no
    // content) so the others still list; reading or downloading it still fails as snapshot_invalid.
    const snapshot = htmlSnapshotRevisionSchema.safeParse(row.snapshot);
    if (!snapshot.success) {
      log("error", "html_export_snapshot_invalid", { export_id: row.id });
      return [];
    }
    return [{ row, revisionId: snapshot.data.revisionId }];
  });
  const live = await liveNotebookRevisionIds(
    db,
    ctx,
    snapshots.map(({ revisionId }) => revisionId),
  );
  return snapshots.filter(({ revisionId }) => live.has(revisionId)).map(({ row }) => view(row));
}
export async function htmlExportReadLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  id: string,
  settings: PltSettings["storage"],
  now = new Date(),
  media?: HtmlMediaReader,
) {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await owned(tx, ctx, id, now);
    if (row.state !== "ready" || !row.object_id) throw errors.notFound();
    for (const expected of parseSnapshot(htmlSnapshotMediaSchema, row.snapshot).media) {
      if (!media) throw errors.notFound();
      const live = await media.describe(tx, ctx, expected.id);
      if (live.objectId !== expected.objectId) throw errors.notFound();
    }
    return issueReadLink(tx, store, ctx, row.object_id, {
      settings,
      now,
      download: true,
      validForSeconds: Math.min(
        settings.readLinkSeconds,
        Math.floor((row.expires_at.getTime() - now.getTime()) / 1000),
      ),
    });
  });
}
export function htmlExportJob(
  store: ObjectStore,
  media?: HtmlMediaReader,
): JobDefinition<{ userId: string; artifactId: string }> {
  const definition: JobDefinition<{ userId: string; artifactId: string }> = {
    kind: "html.build_export",
    version: 1,
    payload: z.strictObject({ userId: z.uuid(), artifactId: z.uuid() }),
    async run(input, job) {
      const actor = { userId: input.userId, requestId: job.job.id };
      const row = await owned(job.db, actor, input.artifactId, job.now());
      if (row.state === "ready") return;
      const snapshot = parseSnapshot(htmlSnapshotSchema, row.snapshot);
      const settings = exportSettingsSchema.parse(row.settings);
      const images: ExportMediaBytes[] = [];
      for (const image of snapshot.media) {
        if (!media) throw errors.validationFailed({ media: ["reader_unavailable"] });
        const value = await media.read(job.db, store, actor, image);
        if (
          value.media.objectId !== image.objectId ||
          value.media.mimeType !== image.mimeType ||
          value.bytes.length !== image.byteLength
        )
          throw errors.conflict();
        images.push(value);
      }
      const bytes = renderNotebookHtml(snapshot, images);
      assertExportSize(bytes.length, settings);
      const destination = await job.db.transaction().execute(async (tx) => {
        await lockAccount(tx, actor.userId);
        const current = await owned(tx, actor, row.id, job.now());
        if (current.state === "ready") return null;
        if (current.object_id) {
          const object = await ownedObjectMetadata(tx, actor, current.object_id);
          if (
            object.state === "pending" &&
            object.contentType === "text/html" &&
            object.sizeBytes === bytes.length
          )
            return current.object_id;
          await deleteObject(tx, store, actor, current.object_id, job.now());
        }
        const target = await createObject(tx, {
          module: "html",
          ownerUserId: actor.userId,
          retention: "temporary",
          contentType: "text/html",
          extension: "html",
          sizeBytes: bytes.length,
          now: job.now(),
        });
        await tx
          .updateTable("html.export_artifact")
          .set({ object_id: target.id })
          .where("id", "=", row.id)
          .execute();
        return target.id;
      });
      if (!destination) return;
      let objectId: string | null = null;
      try {
        await job.db.transaction().execute(async (tx) => {
          await lockAccount(tx, actor.userId);
          const current = await owned(tx, actor, row.id, job.now());
          if (current.state === "ready") return;
          if (current.object_id !== destination) throw errors.conflict();
          for (const image of snapshot.media) {
            if (!media) throw errors.conflict();
            const live = await media.describe(tx, actor, image.id);
            if (live.objectId !== image.objectId || live.mimeType !== image.mimeType)
              throw errors.conflict();
          }
          objectId = destination;
          await writeOwnedObject(tx, store, actor, {
            targetObjectId: destination,
            module: "html",
            retention: "temporary",
            contentType: "text/html",
            extension: "html",
            bytes,
            now: job.now(),
          });
          await tx
            .updateTable("html.export_artifact")
            .set({
              state: "ready",
              actual_bytes: bytes.length,
              sha256: sha256Hex(bytes),
              last_error: null,
            })
            .where("id", "=", row.id)
            .execute();
        });
      } catch (failure) {
        if (objectId) await deleteObject(job.db, store, actor, objectId, job.now());
        throw failure;
      }
    },
  };
  const build = definition.run;
  definition.run = async (input, job) => {
    try {
      await build(input, job);
    } catch (failure) {
      await job.db
        .updateTable("html.export_artifact")
        .set({
          state: "failed",
          last_error: failure instanceof AppError ? failure.code : "internal",
        })
        .where("id", "=", input.artifactId)
        .where("user_id", "=", input.userId)
        .where("tombstoned_at", "is", null)
        .where("state", "!=", "ready")
        .execute();
      throw failure;
    }
  };
  return definition;
}
export async function tombstoneSessionHtmlExports(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
) {
  await tx
    .updateTable("html.export_artifact")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .execute();
}
export async function tombstoneAccountHtmlExports(tx: Tx, ctx: LearnerContext, now = new Date()) {
  await tx
    .updateTable("html.export_artifact")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .execute();
}
export async function tombstoneSourceHtmlExports(
  tx: Tx,
  ctx: LearnerContext,
  _sourceId: string,
  sessionIds: string[],
  now = new Date(),
) {
  for (const id of sessionIds) await tombstoneSessionHtmlExports(tx, ctx, id, now);
}
export async function cleanupHtmlExports(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  options: { sessionId?: string; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const rows = await db
    .selectFrom("html.export_artifact")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("cleaned_at", "is", null)
    .where((eb) => eb.or([eb("tombstoned_at", "is not", null), eb("expires_at", "<=", now)]))
    .$if(options.sessionId !== undefined, (q) =>
      q.where("session_id", "=", options.sessionId ?? ""),
    )
    .execute();
  for (const row of rows) {
    await db.transaction().execute(async (tx) => {
      await lockAccountForCleanup(tx, ctx.userId);
      const current = await tx
        .selectFrom("html.export_artifact")
        .selectAll()
        .where("id", "=", row.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.cleaned_at) return;
      if (current.object_id) await deleteObject(tx, store, ctx, current.object_id, now);
      await tx
        .updateTable("html.export_artifact")
        .set({
          state: "deleted",
          snapshot: null,
          object_id: null,
          tombstoned_at: current.tombstoned_at ?? now,
          cleaned_at: now,
        })
        .where("id", "=", row.id)
        .execute();
    });
  }
}
export function htmlExportMaintenanceJob(store: ObjectStore): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "html.cleanup_exports",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, job) {
        const users = await job.db
          .selectFrom("html.export_artifact")
          .select("user_id")
          .distinct()
          .where("cleaned_at", "is", null)
          .where((eb) =>
            eb.or([eb("tombstoned_at", "is not", null), eb("expires_at", "<=", job.now())]),
          )
          .execute();
        for (const user of users)
          await cleanupHtmlExports(
            job.db,
            store,
            { userId: user.user_id, requestId: job.job.id },
            { now: job.now() },
          );
      },
    },
  };
}
