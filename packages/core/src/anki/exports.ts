import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import { cardTemplateSchema, getCard, liveCardIds, readCards } from "../card";
import type { Database, DB, Tx } from "../db";
import { getMediaAsset, readMediaBytes } from "../media";
import { getSession } from "../org";
import {
  AppError,
  assertExportSize,
  assertOwner,
  canonicalJson,
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
  type ObjectStore,
  ownedObjectMetadata,
  type PeriodicJob,
  type PltSettings,
  parseSnapshot,
  sha256Hex,
  storedObject,
  writeOwnedObject,
} from "../plt";
import {
  type AnkiCardSnapshot,
  type AnkiPackageInput,
  buildAnkiPackage,
  clozeOrdinals,
} from "./package";

export const ankiExportRequestSchema = z.strictObject({
  sessionId: z.uuid(),
  cardIds: z.array(z.uuid()).min(1).max(10000),
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .regex(/^[\p{L}\p{N}_:.-]+$/u),
    )
    .max(30)
    .default([]),
  includeMedia: z.boolean(),
  expectedVersions: z.record(z.uuid(), z.int().positive()).optional(),
});
export type AnkiExportRequest = z.input<typeof ankiExportRequestSchema>;
/** A card as copied into an Anki export snapshot (QUA-05); its claim was validated on write. */
const ankiCardSnapshotSchema = z.object({
  id: z.uuid(),
  template: cardTemplateSchema,
  direction: z.enum(["forward", "reverse"]),
  front: z.string(),
  back: z.string(),
  provenance: storedObject<AnkiCardSnapshot["provenance"]>(),
  contentVersion: z.number().int().positive(),
  frontMediaId: z.string().min(1).nullable(),
  backMediaId: z.string().min(1).nullable(),
  contentFormat: z.literal("lesson_html").optional(),
  studySet: z.enum(["production", "recognition"]).optional(),
  studyTags: z.array(z.string()).optional(),
}) satisfies z.ZodType<AnkiCardSnapshot>;
/** `anki.export_artifact.snapshot`, version 1 (QUA-05). */
export const ankiSnapshotSchema = z.looseObject({
  sessionId: z.uuid(),
  title: z.string(),
  cards: z.array(ankiCardSnapshotSchema),
  tags: z.array(z.string()),
  createdAt: z.string().min(1),
  media: z.array(exportMediaSchema),
}) satisfies z.ZodType<AnkiPackageInput & { media: ExportMedia[] }>;
type AnkiSnapshot = z.infer<typeof ankiSnapshotSchema>;
/** Ownership and listing only need each copied card's id. */
const ankiSnapshotCardIdsSchema = z.looseObject({
  cards: z.array(z.looseObject({ id: z.uuid() })),
});
const ankiSnapshotMediaSchema = ankiSnapshotSchema.pick({ media: true });
function view(row: Selectable<DB["anki.export_artifact"]>): ExportArtifact {
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
    .selectFrom("anki.export_artifact")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  assertOwner(row && !row.tombstoned_at ? { ownerId: row.user_id } : undefined, ctx);
  if (!row || row.expires_at <= now || !row.snapshot) throw errors.notFound();
  await getSession(db, ctx, row.session_id);
  // PERF-04: every copied card read at once and checked in snapshot order, as getCard checked it.
  const cards = parseSnapshot(ankiSnapshotCardIdsSchema, row.snapshot).cards;
  const live = await readCards(
    db,
    ctx,
    cards.map((card) => card.id),
  );
  for (const card of cards) live.take(card.id);
  return row;
}
async function describe(db: Database | Tx, ctx: LearnerContext, id: string): Promise<ExportMedia> {
  const asset = await getMediaAsset(db, ctx, id);
  if (!asset.exportAllowed || asset.state !== "ready" || !asset.objectId || !asset.mimeType)
    throw errors.validationFailed({ media: ["explicit_export_permission_required"] });
  const metadata = await ownedObjectMetadata(db, ctx, asset.objectId);
  if (metadata.state !== "verified" || metadata.contentType !== asset.mimeType)
    throw errors.conflict();
  return {
    id: asset.id,
    sessionId: asset.sessionId,
    objectId: asset.objectId,
    sourceId: asset.sourceId,
    kind: asset.kind,
    mimeType: asset.mimeType,
    byteLength: metadata.sizeBytes,
  };
}
export async function requestAnkiExport(
  db: Database,
  ctx: LearnerContext,
  raw: AnkiExportRequest,
  options: {
    key: string;
    settings: ExportSettings;
    now?: Date;
    onCreated?: (tx: Tx, artifact: ExportArtifact) => Promise<void>;
  },
): Promise<ExportArtifact> {
  const input = ankiExportRequestSchema.parse(raw);
  const settings = exportSettingsSchema.parse(options.settings);
  const now = options.now ?? new Date();
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  if (new Set(input.cardIds).size !== input.cardIds.length)
    throw errors.validationFailed({ cardIds: ["duplicate"] });
  if (input.cardIds.length > settings.maxItems)
    throw errors.validationFailed({ cardIds: ["export_limit"] });
  const hash = sha256Hex(canonicalJson(input));
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const prior = await tx
      .selectFrom("anki.export_artifact")
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
    const session = await getSession(tx, ctx, input.sessionId);
    const cards: AnkiSnapshot["cards"] = [];
    const mediaMap = new Map<string, ExportMedia>();
    // Each selected card is locked by its own getCard, in the learner's order: resolving an older
    // lesson card's pronunciation locks its class right after that card and before the next one,
    // a lock order one bulk FOR UPDATE would change (PERF-04 keeps it).
    for (const id of input.cardIds) {
      const card = await getCard(tx, ctx, id, true);
      if (input.expectedVersions && input.expectedVersions[id] !== card.contentVersion)
        throw errors.conflict();
      if (!card.sessionIds.includes(session.id) || ["rejected", "deleted"].includes(card.status))
        throw errors.validationFailed({ cardIds: ["available_selected_class_cards_required"] });
      if (card.template === "cloze") clozeOrdinals(card.front);
      if (card.template === "listening" && (!input.includeMedia || !card.frontMediaId))
        throw errors.validationFailed({ media: ["listening_audio_export_required"] });
      if (input.includeMedia)
        for (const mediaId of [card.frontMediaId, card.backMediaId]) {
          if (!mediaId) continue;
          const asset = await describe(tx, ctx, mediaId);
          if (!card.sessionIds.includes(asset.sessionId)) throw errors.notFound();
          mediaMap.set(asset.id, asset);
        }
      cards.push({
        id: card.id,
        template: card.template,
        direction: card.direction,
        front: card.front,
        back: card.back,
        contentFormat: card.contentFormat,
        studySet: card.studySet,
        studyTags: card.studyTags,
        provenance: card.provenance,
        contentVersion: card.contentVersion,
        frontMediaId: input.includeMedia ? card.frontMediaId : null,
        backMediaId: input.includeMedia ? card.backMediaId : null,
      });
    }
    const snapshot: AnkiSnapshot = {
      sessionId: session.id,
      title: session.displayTitle,
      cards,
      tags: input.tags,
      createdAt: now.toISOString(),
      media: [...mediaMap.values()],
    };
    const estimated =
      131072 +
      new TextEncoder().encode(JSON.stringify(snapshot)).length * 3 +
      snapshot.media.reduce((n, m) => n + m.byteLength, 0);
    assertExportSize(estimated, settings);
    const row = await tx
      .insertInto("anki.export_artifact")
      .values({
        user_id: ctx.userId,
        session_id: session.id,
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
export async function getAnkiExport(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
  now = new Date(),
): Promise<ExportArtifact> {
  return view(await owned(db, ctx, id, now));
}
export async function listAnkiExports(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<ExportArtifact[]> {
  await getSession(db, ctx, sessionId);
  const rows = await db
    .selectFrom("anki.export_artifact")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .where("expires_at", ">", now)
    .orderBy("created_at", "desc")
    .execute();
  // PERF-04: the same checks as getAnkiExport for every listed export, in a constant number of
  // reads. The session was checked above; an export is listed only while all its cards are.
  const snapshots = rows.flatMap((row) =>
    row.snapshot
      ? [{ row, cards: parseSnapshot(ankiSnapshotCardIdsSchema, row.snapshot).cards }]
      : [],
  );
  const live = await liveCardIds(
    db,
    ctx,
    snapshots.flatMap(({ cards }) => cards.map((card) => card.id)),
  );
  return snapshots
    .filter(({ cards }) => cards.every((card) => live.has(card.id)))
    .map(({ row }) => view(row));
}
export async function ankiExportReadLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  id: string,
  settings: PltSettings["storage"],
  now = new Date(),
) {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await owned(tx, ctx, id, now);
    if (row.state !== "ready" || !row.object_id) throw errors.notFound();
    for (const expected of parseSnapshot(ankiSnapshotMediaSchema, row.snapshot).media) {
      const live = await describe(tx, ctx, expected.id);
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
export function ankiExportJob(
  store: ObjectStore,
): JobDefinition<{ userId: string; artifactId: string }> {
  const definition: JobDefinition<{ userId: string; artifactId: string }> = {
    kind: "anki.build_export",
    version: 1,
    payload: z.strictObject({ userId: z.uuid(), artifactId: z.uuid() }),
    async run(input, job) {
      const actor = { userId: input.userId, requestId: job.job.id };
      const row = await owned(job.db, actor, input.artifactId, job.now());
      if (row.state === "ready") return;
      const snapshot = parseSnapshot(ankiSnapshotSchema, row.snapshot);
      const settings = exportSettingsSchema.parse(row.settings);
      const media: ExportMediaBytes[] = [];
      for (const item of snapshot.media) {
        const value = await readMediaBytes(job.db, store, actor, item.id, true);
        if (
          value.asset.objectId !== item.objectId ||
          value.asset.mimeType !== item.mimeType ||
          value.bytes.length !== item.byteLength
        )
          throw errors.conflict();
        media.push({ media: item, bytes: value.bytes });
      }
      const bytes = await buildAnkiPackage(snapshot, media);
      assertExportSize(bytes.length, settings);
      const destination = await job.db.transaction().execute(async (tx) => {
        await lockAccount(tx, actor.userId);
        const current = await owned(tx, actor, row.id, job.now());
        if (current.state === "ready") return null;
        if (current.object_id) {
          const object = await ownedObjectMetadata(tx, actor, current.object_id);
          if (
            object.state === "pending" &&
            object.contentType === "application/octet-stream" &&
            object.sizeBytes === bytes.length
          )
            return current.object_id;
          await deleteObject(tx, store, actor, current.object_id, job.now());
        }
        const target = await createObject(tx, {
          module: "anki",
          ownerUserId: actor.userId,
          retention: "temporary",
          contentType: "application/octet-stream",
          extension: "apkg",
          sizeBytes: bytes.length,
          now: job.now(),
        });
        await tx
          .updateTable("anki.export_artifact")
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
          for (const item of snapshot.media) {
            const live = await describe(tx, actor, item.id);
            if (live.objectId !== item.objectId) throw errors.conflict();
          }
          objectId = destination;
          await writeOwnedObject(tx, store, actor, {
            targetObjectId: destination,
            module: "anki",
            retention: "temporary",
            contentType: "application/octet-stream",
            extension: "apkg",
            bytes,
            now: job.now(),
          });
          await tx
            .updateTable("anki.export_artifact")
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
        .updateTable("anki.export_artifact")
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
export async function tombstoneSessionAnkiExports(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
) {
  await tx
    .updateTable("anki.export_artifact")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .execute();
}
export async function tombstoneAccountAnkiExports(tx: Tx, ctx: LearnerContext, now = new Date()) {
  await tx
    .updateTable("anki.export_artifact")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .execute();
}
export async function tombstoneSourceAnkiExports(
  tx: Tx,
  ctx: LearnerContext,
  _sourceId: string,
  sessionIds: string[],
  now = new Date(),
) {
  for (const id of sessionIds) await tombstoneSessionAnkiExports(tx, ctx, id, now);
}
export async function cleanupAnkiExports(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  options: { sessionId?: string; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const rows = await db
    .selectFrom("anki.export_artifact")
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
        .selectFrom("anki.export_artifact")
        .selectAll()
        .where("id", "=", row.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.cleaned_at) return;
      if (current.object_id) await deleteObject(tx, store, ctx, current.object_id, now);
      await tx
        .updateTable("anki.export_artifact")
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
export function ankiExportMaintenanceJob(store: ObjectStore): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "anki.cleanup_exports",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, job) {
        const users = await job.db
          .selectFrom("anki.export_artifact")
          .select("user_id")
          .distinct()
          .where("cleaned_at", "is", null)
          .where((eb) =>
            eb.or([eb("tombstoned_at", "is not", null), eb("expires_at", "<=", job.now())]),
          )
          .execute();
        for (const user of users)
          await cleanupAnkiExports(
            job.db,
            store,
            { userId: user.user_id, requestId: job.job.id },
            { now: job.now() },
          );
      },
    },
  };
}
