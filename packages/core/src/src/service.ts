import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { getAccountState, lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { assertSessionOwner, bumpSessionSourcesVersion } from "../org";
import {
  assertOwner,
  canonicalJson,
  composeOwnedObjects,
  confirmObject,
  createObject,
  deleteObject,
  errors,
  issueReadLink,
  issueWriteLink,
  type LearnerContext,
  type ObjectStore,
  ownedObjectMetadata,
  type PltSettings,
  readOwnedObject,
  sha256Hex,
} from "../plt";
import {
  amounts,
  emptyAmounts,
  reservationIsOpen,
  reserveAllowance,
  settleAllowance,
} from "../quota";
import {
  cleanDisplayName,
  decodeSourceText,
  detectBinaryMime,
  type InputContract,
  readInputContract,
  type SourceFile,
  sourceFileSchema,
  validateFileDeclaration,
} from "./contracts";
import { extractHtml, extractPlainText, MAX_EXTRACTED_BLOCK_LENGTH } from "./extract";
import {
  automaticSourceRole,
  type SourceRole,
  sourceClassificationSchema,
  sourceRoleSchema,
} from "./roles";
import { audioSelectionMatchesCache, extractionSettings } from "./selection-cache";

type Connection = Database | Tx;
const rangesSchema = z.array(
  z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive() }),
);
export const sourceSelectionSchema = z.strictObject({
  role: sourceRoleSchema,
  selected: z.boolean(),
  ranges: rangesSchema,
  timeStatus: z.enum(["exact", "estimated", "user_confirmed", "unknown"]),
  contentVersionId: z.uuid().nullable(),
});
export type SourceSelection = z.infer<typeof sourceSelectionSchema>;

async function lockOwner(tx: Tx, ctx: LearnerContext, maintenance = false): Promise<void> {
  if (!maintenance) await lockAccount(tx, ctx.userId);
  // Serialize source mutations for an owner so attach, delete and upload completion share order.
  await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.userId}, 17))`.execute(tx);
}
async function assetRow(db: Connection, ctx: LearnerContext, assetId: string) {
  z.uuid().parse(assetId);
  const row = await db
    .selectFrom("src.asset")
    .selectAll()
    .where("id", "=", assetId)
    .where("tombstoned_at", "is", null)
    .executeTakeFirst();
  return assertOwner(row ? { ...row, ownerId: row.user_id } : undefined, ctx);
}
async function uploadRow(db: Connection, ctx: LearnerContext, uploadId: string) {
  z.uuid().parse(uploadId);
  const row = await db
    .selectFrom("src.upload_session")
    .selectAll()
    .where("id", "=", uploadId)
    .executeTakeFirst();
  const upload = assertOwner(row ? { ...row, ownerId: row.user_id } : undefined, ctx);
  await assetRow(db, ctx, upload.asset_id);
  return upload;
}

export async function acceptSourceNotice(
  db: Database,
  ctx: LearnerContext,
  version: string,
  confirmed: boolean,
  now = new Date(),
): Promise<void> {
  const contract = await readInputContract(db);
  if (confirmed !== true || version !== contract.noticeVersion)
    throw errors.validationFailed({ notice: ["accept_current_version"] });
  await db
    .insertInto("src.notice_acceptance")
    .values({ user_id: ctx.userId, version, accepted_at: now })
    .onConflict((oc) => oc.columns(["user_id", "version"]).doNothing())
    .execute();
}
export async function sourceNoticeAccepted(
  db: Connection,
  ctx: LearnerContext,
  version: string,
): Promise<boolean> {
  return (
    (await db
      .selectFrom("src.notice_acceptance")
      .select("version")
      .where("user_id", "=", ctx.userId)
      .where("version", "=", version)
      .executeTakeFirst()) !== undefined
  );
}

async function snapshot(tx: Tx, ctx: LearnerContext, sessionId: string, now: Date): Promise<void> {
  const version = await bumpSessionSourcesVersion(tx, ctx, sessionId, now);
  const links = await tx
    .selectFrom("src.session_source")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .where("active", "=", true)
    .orderBy("id")
    .execute();
  await tx
    .insertInto("src.source_snapshot")
    .values({
      session_id: sessionId,
      user_id: ctx.userId,
      sources_version: version,
      sources: JSON.stringify(links),
      created_at: now,
    })
    .execute();
  await tx
    .insertInto("src.outbox")
    .values({
      user_id: ctx.userId,
      event_type: "session_sources_changed",
      subject_id: sessionId,
      payload: JSON.stringify({ sourcesVersion: version }),
      created_at: now,
    })
    .execute();
}
async function attach(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  assetId: string,
  contract: InputContract,
  now: Date,
  captureAnchor?: SourceFile["captureAnchor"],
) {
  await assertSessionOwner(tx, ctx, sessionId);
  const source = await assetRow(tx, ctx, assetId);
  if (captureAnchor) {
    if (source.kind !== "image") throw errors.validationFailed({ captureAnchor: ["image_only"] });
    const audio = await assetRow(tx, ctx, captureAnchor.sourceId);
    const anchor = await tx
      .selectFrom("src.session_source")
      .select("id")
      .where("session_id", "=", sessionId)
      .where("asset_id", "=", audio.id)
      .where("user_id", "=", ctx.userId)
      .where("active", "=", true)
      .executeTakeFirst();
    if (!anchor || audio.kind !== "audio" || captureAnchor.offsetMs > Number(audio.duration_ms))
      throw errors.validationFailed({ captureAnchor: ["invalid_audio_anchor"] });
  }
  const prior = await tx
    .selectFrom("src.session_source")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("asset_id", "=", assetId)
    .executeTakeFirst();
  if (prior?.active) return prior.id;
  const total = await tx
    .selectFrom("src.session_source")
    .select(sql<string>`count(*)`.as("count"))
    .where("session_id", "=", sessionId)
    .where("active", "=", true)
    .executeTakeFirstOrThrow();
  if (Number(total.count) >= contract.maxSourcesPerSession)
    throw errors.validationFailed({ sources: ["session_limit"] });
  let id: string;
  if (prior) {
    id = prior.id;
    await tx
      .updateTable("src.session_source")
      .set({ active: true, changed_at: now })
      .where("id", "=", id)
      .execute();
  } else {
    const link = await tx
      .insertInto("src.session_source")
      .values({
        user_id: ctx.userId,
        session_id: sessionId,
        asset_id: assetId,
        role: source.kind === "audio" ? "class_audio" : "class_material",
        selected: source.kind === "audio" || source.verified_at !== null,
        created_at: now,
        changed_at: now,
        anchor_source_id: captureAnchor?.sourceId ?? null,
        capture_offset_ms: captureAnchor?.offsetMs ?? null,
        capture_state: captureAnchor?.state ?? null,
        time_status: captureAnchor ? "estimated" : "unknown",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    id = link.id;
  }
  await snapshot(tx, ctx, sessionId, now);
  return id;
}

/** FR-SRC-001, 003, 004, 007: metadata and reservation commit before any write URL. */
export async function createSource(
  db: Connection,
  ctx: LearnerContext,
  raw: unknown,
  now = new Date(),
  recording = false,
) {
  const input = sourceFileSchema.parse(raw);
  input.displayName = cleanDisplayName(input.displayName);
  const hash = sha256Hex(canonicalJson(input));
  const create = async (tx: Tx) => {
    await lockOwner(tx, ctx);
    await assertSessionOwner(tx, ctx, input.sessionId);
    const previous = await tx
      .selectFrom("src.asset")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== hash) throw errors.idempotencyMismatch();
      await assetRow(tx, ctx, previous.id);
      const upload = await tx
        .selectFrom("src.upload_session")
        .select("id")
        .where("asset_id", "=", previous.id)
        .executeTakeFirst();
      return { assetId: previous.id, uploadId: upload?.id ?? null, replayed: true };
    }
    const contract = await readInputContract(tx);
    validateFileDeclaration(input, contract);
    if (recording) {
      const account = await getAccountState(tx, ctx.userId);
      if (input.kind !== "audio" || !account?.setupComplete || account.pending.recordingConsent)
        throw errors.validationFailed({ recordingConsent: ["acceptance_required"] });
    } else if (!(await sourceNoticeAccepted(tx, ctx, contract.noticeVersion)))
      throw errors.validationFailed({ notice: ["accept_current_version"] });
    const source = await tx
      .insertInto("src.asset")
      .values({
        user_id: ctx.userId,
        kind: input.kind,
        declared_mime: input.mimeType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256,
        display_name: input.displayName,
        contract_version: contract.version,
        retention: input.kind === "audio" ? "device_only" : "persistent",
        duration_ms: input.durationMs ?? null,
        operation_key: input.operationKey,
        request_hash: hash,
        created_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    let uploadId: string | null = null;
    if (input.kind !== "audio") {
      const reservation = await reserveAllowance(
        tx,
        ctx,
        `src:${source.id}`,
        amounts({ storage: input.sizeBytes }),
        now,
      );
      const upload = await tx
        .insertInto("src.upload_session")
        .values({
          user_id: ctx.userId,
          asset_id: source.id,
          reservation_id: reservation.id,
          expires_at: new Date(now.getTime() + contract.uploadTtlSeconds * 1000),
          created_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      uploadId = upload.id;
      if (input.parts.length > 1) {
        // The assembled destination and cleanup pointer commit before any worker writes bytes.
        const target = await createObject(tx, {
          module: "src",
          ownerUserId: ctx.userId,
          retention: "durable",
          contentType: input.mimeType,
          sizeBytes: input.sizeBytes,
          now,
        });
        await tx
          .updateTable("src.asset")
          .set({ original_object_id: target.id })
          .where("id", "=", source.id)
          .execute();
      }
      for (const part of input.parts) {
        const object = await createObject(tx, {
          module: "src",
          ownerUserId: ctx.userId,
          retention: input.parts.length === 1 ? "durable" : "temporary",
          contentType: input.mimeType,
          sizeBytes: part.sizeBytes,
          now,
        });
        await tx
          .insertInto("src.upload_part")
          .values({
            upload_id: upload.id,
            part_index: part.index,
            object_id: object.id,
            size_bytes: part.sizeBytes,
            sha256: part.sha256,
          })
          .execute();
        if (input.parts.length === 1)
          await tx
            .updateTable("src.asset")
            .set({ original_object_id: object.id })
            .where("id", "=", source.id)
            .execute();
      }
    }
    await attach(tx, ctx, input.sessionId, source.id, contract, now, input.captureAnchor);
    return { assetId: source.id, uploadId, replayed: false };
  };
  return db.isTransaction ? create(db as Tx) : db.transaction().execute(create);
}

export async function attachSource(
  db: Connection,
  ctx: LearnerContext,
  sessionId: string,
  assetId: string,
  now = new Date(),
) {
  const attachOwned = async (tx: Tx) => {
    await lockOwner(tx, ctx);
    return attach(tx, ctx, sessionId, assetId, await readInputContract(tx), now);
  };
  return db.isTransaction ? attachOwned(db as Tx) : db.transaction().execute(attachOwned);
}

export function createRecordedSource(
  db: Connection,
  ctx: LearnerContext,
  raw: unknown,
  now = new Date(),
) {
  return createSource(db, ctx, raw, now, true);
}
export async function sourceAssets(db: Database, ctx: LearnerContext, checksum?: string) {
  if (checksum)
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(checksum);
  return db
    .selectFrom("src.asset as asset")
    .leftJoin("src.upload_session as upload", "upload.asset_id", "asset.id")
    .selectAll("asset")
    .select(["upload.id as uploadId", "upload.state as uploadState"])
    .where("asset.user_id", "=", ctx.userId)
    .where("asset.tombstoned_at", "is", null)
    .$if(checksum !== undefined, (qb) => qb.where("asset.sha256", "=", checksum ?? ""))
    .orderBy("asset.created_at", "desc")
    .execute();
}
export async function sessionSources(db: Connection, ctx: LearnerContext, sessionId: string) {
  await assertSessionOwner(db, ctx, sessionId);
  return db
    .selectFrom("src.session_source as link")
    .innerJoin("src.asset as asset", "asset.id", "link.asset_id")
    .leftJoin("src.upload_session as upload", "upload.asset_id", "asset.id")
    .select([
      "link.id as linkId",
      "link.asset_id as assetId",
      "link.role",
      "link.selected",
      "link.ranges",
      "link.time_status as timeStatus",
      "link.anchor_source_id as anchorSourceId",
      "link.capture_offset_ms as captureOffsetMs",
      "link.capture_state as captureState",
      "link.selected_content_version_id as contentVersionId",
      "asset.kind",
      "asset.display_name as displayName",
      "asset.declared_mime as mimeType",
      "asset.size_bytes as sizeBytes",
      "asset.duration_ms as durationMs",
      "asset.page_count as pageCount",
      "asset.verified_at as verifiedAt",
      "asset.original_deleted_at as originalDeletedAt",
      "upload.id as uploadId",
      "upload.state as uploadState",
      "upload.rejection_reason as rejectionReason",
    ])
    .where("link.session_id", "=", sessionId)
    .where("link.user_id", "=", ctx.userId)
    .where("link.active", "=", true)
    .where("asset.tombstoned_at", "is", null)
    .orderBy("link.created_at")
    .execute();
}

export async function uploadManifest(db: Database, ctx: LearnerContext, uploadId: string) {
  const upload = await uploadRow(db, ctx, uploadId);
  const parts = await db
    .selectFrom("src.upload_part")
    .select([
      "part_index as index",
      "size_bytes as sizeBytes",
      "sha256",
      "verified_at as verifiedAt",
    ])
    .where("upload_id", "=", upload.id)
    .orderBy("part_index")
    .execute();
  return {
    id: upload.id,
    assetId: upload.asset_id,
    state: upload.state,
    rejectionReason: upload.rejection_reason,
    expiresAt: upload.expires_at,
    parts,
  };
}
export async function uploadPartLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  uploadId: string,
  index: number,
  settings: PltSettings["storage"],
  now = new Date(),
) {
  z.number().int().nonnegative().parse(index);
  return db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const upload = await uploadRow(tx, ctx, uploadId);
    const source = await assetRow(tx, ctx, upload.asset_id);
    if (
      source.original_deleted_at ||
      upload.state !== "pending" ||
      upload.expires_at <= now ||
      !(await reservationIsOpen(tx, ctx, upload.reservation_id))
    )
      throw errors.conflict();
    const part = await tx
      .selectFrom("src.upload_part")
      .selectAll()
      .where("upload_id", "=", uploadId)
      .where("part_index", "=", index)
      .executeTakeFirst();
    if (!part) throw errors.notFound();
    if (part.verified_at) throw errors.conflict();
    return issueWriteLink(tx, store, ctx, part.object_id, { now, settings });
  });
}

export async function confirmUploadPart(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  uploadId: string,
  index: number,
  now = new Date(),
) {
  z.number().int().nonnegative().parse(index);
  return db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const current = await uploadRow(tx, ctx, uploadId);
    const source = await assetRow(tx, ctx, current.asset_id);
    const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
    if (
      source.original_deleted_at ||
      current.state !== "pending" ||
      current.expires_at <= checkedAt ||
      !(await reservationIsOpen(tx, ctx, current.reservation_id))
    )
      throw errors.conflict();
    const live = await tx
      .selectFrom("src.upload_part")
      .selectAll()
      .where("upload_id", "=", uploadId)
      .where("part_index", "=", index)
      .executeTakeFirst();
    if (!live) throw errors.notFound();
    const object = await ownedObjectMetadata(tx, ctx, live.object_id);
    if (object.contentType !== source.declared_mime || object.sizeBytes !== Number(live.size_bytes))
      throw errors.conflict();
    const result = await confirmObject(tx, store, ctx, live.object_id, {
      now: checkedAt,
      sha256: live.sha256,
    });
    const verifiedAt = new Date(Math.max(checkedAt.getTime(), Date.now()));
    if (
      current.expires_at <= verifiedAt ||
      !(await reservationIsOpen(tx, ctx, current.reservation_id))
    )
      throw errors.conflict();
    // Resumption probes run before a PUT; absent bytes are not a corrupt upload attempt.
    if (result === "missing") return result;
    await tx
      .updateTable("src.upload_part")
      .set(
        result === "verified"
          ? { verified_at: live.verified_at ?? verifiedAt }
          : { attempts: live.attempts + 1 },
      )
      .where("upload_id", "=", uploadId)
      .where("part_index", "=", index)
      .execute();
    if (result !== "verified") {
      const contract = await readInputContract(tx, source.contract_version);
      if (live.attempts + 1 >= contract.maxPartAttempts)
        await rejectUpload(tx, ctx, current.id, current.reservation_id, result, verifiedAt);
    }
    return result;
  });
}
async function rejectUpload(
  tx: Tx,
  ctx: LearnerContext,
  uploadId: string,
  reservationId: string,
  reason: string,
  now: Date,
) {
  await tx
    .updateTable("src.upload_session")
    .set({ state: "rejected", rejection_reason: reason, completed_at: now })
    .where("id", "=", uploadId)
    .execute();
  await settleAllowance(tx, ctx, reservationId, emptyAmounts(), now);
}

/** Implementations run in the storage worker; a web request never assembles file bytes. */
export interface SourceVerifier {
  inspect(
    bytes: Uint8Array,
    mimeType: string,
    contract: InputContract,
  ): Promise<{
    durationMs?: number;
    pageCount?: number;
    width?: number;
    height?: number;
    passwordRequired?: boolean;
  }>;
}
export interface MultipartComposer {
  compose(input: {
    tx: Tx;
    targetObjectId: string;
    assetId: string;
    partObjectIds: string[];
    mimeType: string;
    sizeBytes: number;
    userId: string;
    onRegistered: (objectId: string) => Promise<void>;
  }): Promise<string>;
}
/** FR-SRC-005: completion remains fail-closed until required parser/composer is configured. */
export async function verifyUpload(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  uploadId: string,
  providers: { verifier?: SourceVerifier; composer?: MultipartComposer } = {},
  now = new Date(),
) {
  let stagedObjectId: string | undefined;
  // The durable source pointer makes pending/verified staging safe to retain on transient
  // storage or database failure. Deleting it would make the next worker retry unrecoverable.
  const manifest = await verifyPendingUpload(db, store, ctx, uploadId, providers, now, (id) => {
    stagedObjectId = id;
  });
  if (manifest.state === "rejected" && stagedObjectId)
    await deleteObject(db, store, ctx, stagedObjectId, now);
  return manifest;
}
async function verifyPendingUpload(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  uploadId: string,
  providers: { verifier?: SourceVerifier; composer?: MultipartComposer } = {},
  now = new Date(),
  onRegistered: (objectId: string) => void,
) {
  const upload = await uploadRow(db, ctx, uploadId);
  if (["verified", "rejected", "abandoned"].includes(upload.state))
    return uploadManifest(db, ctx, uploadId);
  if (!["pending", "verifying"].includes(upload.state) || upload.expires_at <= now)
    throw errors.conflict();
  const source = await assetRow(db, ctx, upload.asset_id);
  const parts = await db
    .selectFrom("src.upload_part")
    .selectAll()
    .where("upload_id", "=", uploadId)
    .orderBy("part_index")
    .execute();
  if (parts.some((part) => !part.verified_at))
    throw errors.validationFailed({ parts: ["incomplete"] });
  // Older pending manifests may lack a destination. Register it in a short committed
  // transaction before the owner-guarded IO transaction so rollback cannot lose its cleanup key.
  const destination = await db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const live = await uploadRow(tx, ctx, uploadId);
    const liveSource = await assetRow(tx, ctx, source.id);
    if (live.state === "verified") return null;
    if (
      !["pending", "verifying"].includes(live.state) ||
      live.expires_at <= now ||
      liveSource.original_deleted_at ||
      !(await reservationIsOpen(tx, ctx, live.reservation_id))
    )
      throw errors.conflict();
    if (liveSource.original_object_id) return liveSource.original_object_id;
    const target = await createObject(tx, {
      module: "src",
      ownerUserId: ctx.userId,
      retention: "durable",
      contentType: source.declared_mime,
      sizeBytes: Number(source.size_bytes),
      now,
    });
    await tx
      .updateTable("src.asset")
      .set({ original_object_id: target.id })
      .where("id", "=", source.id)
      .execute();
    return target.id;
  });
  if (!destination) return uploadManifest(db, ctx, uploadId);
  const objectId = await db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const live = await uploadRow(tx, ctx, uploadId);
    const liveSource = await assetRow(tx, ctx, source.id);
    if (
      !["pending", "verifying"].includes(live.state) ||
      live.expires_at <= now ||
      liveSource.original_deleted_at ||
      !(await reservationIsOpen(tx, ctx, live.reservation_id))
    )
      throw errors.conflict();
    let target = liveSource.original_object_id;
    if (!target || target !== destination) throw errors.conflict();
    if ((await ownedObjectMetadata(tx, ctx, target)).state !== "verified") {
      const register = async (id: string) => {
        if (id !== destination) throw errors.conflict();
        onRegistered(id);
      };
      await register(target);
      const input = {
        targetObjectId: target,
        objectIds: parts.map((part) => part.object_id),
        contentType: source.declared_mime,
        sizeBytes: Number(source.size_bytes),
        now,
        onRegistered: register,
      };
      target = providers.composer
        ? await providers.composer.compose({
            tx,
            targetObjectId: target,
            assetId: source.id,
            partObjectIds: input.objectIds,
            mimeType: input.contentType,
            sizeBytes: input.sizeBytes,
            userId: ctx.userId,
            onRegistered: register,
          })
        : await composeOwnedObjects(tx, store, ctx, input);
      // Custom worker implementations must return the same registered destination.
      await register(target);
    }
    await tx
      .updateTable("src.upload_session")
      .set({ state: "verifying" })
      .where("id", "=", uploadId)
      .execute();
    return target;
  });
  const bytes = await readOwnedObject(db, store, ctx, objectId);
  if (
    !bytes ||
    bytes.length !== Number(source.size_bytes) ||
    createHash("sha256").update(bytes).digest("hex") !== source.sha256
  ) {
    await db.transaction().execute(async (tx) => {
      await lockOwner(tx, ctx);
      const live = await uploadRow(tx, ctx, uploadId);
      if (live.state !== "verified")
        await rejectUpload(tx, ctx, uploadId, live.reservation_id, "integrity", now);
    });
    return uploadManifest(db, ctx, uploadId);
  }
  const contract = await readInputContract(db, source.contract_version);
  let metadata: {
    durationMs?: number;
    pageCount?: number;
    width?: number;
    height?: number;
    passwordRequired?: boolean;
  } = {};
  let extractedContent: z.infer<typeof sourceContentSchema> | undefined;
  try {
    const binaryMime = detectBinaryMime(bytes);
    if (source.kind === "text" || source.kind === "html") {
      if (binaryMime) throw errors.unsupportedMedia();
      metadata.pageCount = Math.max(1, Math.ceil(decodeSourceText(bytes).length / 3000));
      const blocks =
        source.kind === "html" ? extractHtml(bytes, contract) : extractPlainText(bytes);
      extractedContent = sourceContentSchema.parse({
        originKey: `upload:${uploadId}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: { method: "passive_text", contractVersion: contract.version },
        units: [
          {
            id: "document-1",
            kind: "document",
            start: 1,
            status: blocks.length ? "extracted" : "failed",
            ...(blocks.length ? {} : { reason: "no_text" }),
          },
        ],
        blocks: blocks.map((block) => ({ ...block, unitId: "document-1" })),
      });
    } else {
      if (binaryMime !== source.declared_mime) throw errors.unsupportedMedia();
      if (!providers.verifier) throw errors.validationFailed({ upload: ["verifier_unavailable"] });
      metadata = await providers.verifier.inspect(bytes, source.declared_mime, contract);
      const limits = contract.formats[source.kind as "pdf" | "image"];
      if (
        source.kind === "pdf" &&
        !metadata.passwordRequired &&
        (!metadata.pageCount || metadata.pageCount > (limits.maxPages ?? 0))
      )
        throw errors.payloadTooLarge();
      if (
        source.kind === "image" &&
        (!metadata.width ||
          !metadata.height ||
          metadata.width * metadata.height > (limits.maxPixels ?? 0))
      )
        throw errors.payloadTooLarge();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "details" in error &&
      canonicalJson(error.details).includes("unavailable")
    )
      throw error;
    await db.transaction().execute(async (tx) => {
      await lockOwner(tx, ctx);
      const live = await uploadRow(tx, ctx, uploadId);
      if (live.state !== "verified")
        await rejectUpload(tx, ctx, uploadId, live.reservation_id, "invalid_media", now);
    });
    return uploadManifest(db, ctx, uploadId);
  }
  await db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const live = await uploadRow(tx, ctx, uploadId);
    if (live.state === "verified") return;
    const liveSource = await assetRow(tx, ctx, source.id);
    const completedAt = new Date(Math.max(now.getTime(), Date.now()));
    if (
      live.state !== "verifying" ||
      live.expires_at <= completedAt ||
      liveSource.original_deleted_at ||
      liveSource.original_object_id !== objectId ||
      !(await reservationIsOpen(tx, ctx, live.reservation_id))
    )
      throw errors.conflict();
    await tx
      .updateTable("src.asset")
      .set({
        original_object_id: objectId,
        verified_mime: source.declared_mime,
        verified_at: now,
        page_count: metadata.pageCount ?? null,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
      })
      .where("id", "=", source.id)
      .where("tombstoned_at", "is", null)
      .execute();
    await tx
      .updateTable("src.upload_session")
      .set({
        state: "verified",
        completed_at: now,
        rejection_reason: metadata.passwordRequired ? "needs_password" : null,
      })
      .where("id", "=", uploadId)
      .execute();
    await settleAllowance(
      tx,
      ctx,
      live.reservation_id,
      amounts({ storage: Number(source.size_bytes) }),
      now,
    );
    const links = await tx
      .selectFrom("src.session_source")
      .select(["id", "session_id"])
      .where("asset_id", "=", source.id)
      .where("active", "=", true)
      .execute();
    for (const link of links) {
      await assertSessionOwner(tx, ctx, link.session_id);
      await tx
        .updateTable("src.session_source")
        .set({ selected: !metadata.passwordRequired, changed_at: now })
        .where("id", "=", link.id)
        .execute();
      await snapshot(tx, ctx, link.session_id, now);
    }
    // FR-SRC-005/010: verification, quota settlement and passive extraction commit together.
    // A retried worker must never observe a verified text source with its content missing.
    if (extractedContent) await appendContentVersion(tx, ctx, source.id, extractedContent, now);
  });
  return uploadManifest(db, ctx, uploadId);
}

/** Board block types; the text stays the exact reading, this only describes its place. */
export const blockLayoutTypes = [
  "heading",
  "list_item",
  "table",
  "relation",
  "example",
  "correction",
  "text",
] as const;
/** D78: how a span was marked on the photo or page, by the learner or in print. */
export const learnerMarkStyles = ["highlight", "underline", "circle"] as const;
export const LEARNER_MARKS_PER_BLOCK = 40;
const LEARNER_MARK_TEXT_MAXIMUM = 500;
export const learnerMarkSchema = z.strictObject({
  style: z.enum(learnerMarkStyles),
  /** The marked words, copied exactly from the block text. */
  text: z.string().min(1).max(LEARNER_MARK_TEXT_MAXIMUM),
});
export type LearnerMark = z.infer<typeof learnerMarkSchema>;
export const blockLayoutSchema = z.strictObject({
  type: z.enum(blockLayoutTypes),
  /** Reading order on the photo or page, from 1. */
  order: z.number().int().positive().max(100000),
  /** The reading of this block is not certain. */
  uncertain: z.literal(true).optional(),
  /** D78: highlighted, underlined or circled spans; absent when none was read. */
  marks: z.array(learnerMarkSchema).min(1).max(LEARNER_MARKS_PER_BLOCK).optional(),
});

/**
 * D78: the marks a block can still show. A mark is kept only when its text occurs exactly in the
 * block text (the model's reading is never trusted for that), once per text.
 */
export function learnerMarksIn(
  text: string,
  marks: readonly LearnerMark[] | undefined,
): LearnerMark[] {
  const kept: LearnerMark[] = [];
  const seen = new Set<string>();
  for (const mark of marks ?? []) {
    const span = mark.text.trim();
    if (!span || span.length > LEARNER_MARK_TEXT_MAXIMUM || !text.includes(span) || seen.has(span))
      continue;
    seen.add(span);
    kept.push({ style: mark.style, text: span });
    if (kept.length === LEARNER_MARKS_PER_BLOCK) break;
  }
  return kept;
}
export const sourceContentSchema = z.strictObject({
  originKey: z.string().min(1).max(200),
  schemaVersion: z.literal("1"),
  provenance: z.enum(["machine_extraction", "user_correction"]),
  settings: z.record(z.string(), z.unknown()),
  units: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        kind: z.enum(["page", "time", "document"]),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive().optional(),
        status: z.enum(["extracted", "partial", "failed"]).default("extracted"),
        reason: z.string().max(100).optional(),
      }),
    )
    .max(10000),
  blocks: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        kind: z.enum(["heading", "paragraph", "list_item", "table", "transcript"]),
        text: z.string().max(MAX_EXTRACTED_BLOCK_LENGTH),
        unitId: z.string().min(1).max(100),
        level: z.number().int().min(1).max(6).optional(),
        speakerRole: z.enum(["teacher", "student", "unknown"]).optional(),
        speakerId: z.string().min(1).max(100).optional(),
        timeStatus: z.enum(["exact", "estimated", "unknown"]).optional(),
        /** Structured reading of a photo or scanned page (lesson-quality-1); absent before. */
        layout: blockLayoutSchema.optional(),
      }),
    )
    .max(100000),
});

/** FR-SRC-010: immutable versions, validated before insertion; retries reuse their origin. */
export async function appendContentVersion(
  tx: Tx,
  ctx: LearnerContext,
  assetId: string,
  raw: unknown,
  now = new Date(),
) {
  const source = await assetRow(tx, ctx, assetId);
  if (!source.verified_at && source.kind !== "audio") throw errors.conflict();
  const input = sourceContentSchema.parse(raw);
  const ids = new Set(input.units.map((unit) => unit.id));
  if (
    ids.size !== input.units.length ||
    new Set(input.blocks.map((block) => block.id)).size !== input.blocks.length ||
    input.blocks.some((block) => !ids.has(block.unitId))
  )
    throw errors.validationFailed({ content: ["invalid_blocks"] });
  for (const unit of input.units) {
    if (
      (unit.end !== undefined && unit.end <= unit.start) ||
      (unit.kind === "page" && (unit.start < 1 || unit.start > (source.page_count ?? 0))) ||
      (unit.kind === "time" &&
        (source.kind !== "audio" ||
          unit.start >= Number(source.duration_ms) ||
          (unit.end ?? unit.start) > Number(source.duration_ms)))
    )
      throw errors.validationFailed({ content: ["invalid_locator"] });
  }
  const hash = sha256Hex(canonicalJson(input));
  const prior = await tx
    .selectFrom("src.content_version")
    .selectAll()
    .where("asset_id", "=", assetId)
    .where("origin_key", "=", input.originKey)
    .executeTakeFirst();
  if (prior) {
    if (prior.request_hash !== hash) throw errors.idempotencyMismatch();
    return prior.id;
  }
  const row = await tx
    .insertInto("src.content_version")
    .values({
      asset_id: assetId,
      user_id: ctx.userId,
      origin_key: input.originKey,
      sha256: source.sha256,
      schema_version: input.schemaVersion,
      provenance: input.provenance,
      extraction_settings: JSON.stringify(input.settings),
      units: JSON.stringify(input.units),
      blocks: JSON.stringify(input.blocks),
      request_hash: hash,
      created_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const links = await tx
    .selectFrom("src.session_source")
    .select(["id", "session_id"])
    .where("asset_id", "=", assetId)
    .where("active", "=", true)
    .execute();
  for (const link of links) {
    await assertSessionOwner(tx, ctx, link.session_id);
    await tx
      .updateTable("src.session_source")
      .set({
        selected_content_version_id: row.id,
        ...(input.provenance === "machine_extraction" && input.settings.sourceClassification
          ? { role: automaticSourceRole(source.kind, input.settings.sourceClassification) }
          : {}),
        changed_at: now,
      })
      .where("id", "=", link.id)
      .execute();
    await snapshot(tx, ctx, link.session_id, now);
  }
  return row.id;
}

export async function sourceContentVersions(db: Connection, ctx: LearnerContext, assetId: string) {
  await assetRow(db, ctx, assetId);
  return db
    .selectFrom("src.content_version")
    .selectAll()
    .where("asset_id", "=", assetId)
    .where("user_id", "=", ctx.userId)
    .orderBy("created_at", "desc")
    .execute();
}
export async function getSource(db: Connection, ctx: LearnerContext, assetId: string) {
  return assetRow(db, ctx, assetId);
}

/** Persist inferred categories only on the learner's active class links. */
export async function updateAutomaticSourceRoles(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  sources: readonly { sourceId: string; role: SourceRole }[],
  now = new Date(),
) {
  await lockOwner(tx, ctx);
  await assertSessionOwner(tx, ctx, sessionId);
  let changed = false;
  for (const source of sources) {
    const asset = await assetRow(tx, ctx, source.sourceId);
    const role = asset.kind === "audio" ? "class_audio" : sourceRoleSchema.parse(source.role);
    if (role === "class_audio" && asset.kind !== "audio") throw errors.conflict();
    if (role === "board_photo" && asset.kind !== "image") throw errors.conflict();
    const updated = await tx
      .updateTable("src.session_source")
      .set({ role, changed_at: now })
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", sessionId)
      .where("asset_id", "=", source.sourceId)
      .where("active", "=", true)
      .where("role", "!=", role)
      .executeTakeFirst();
    changed ||= Number(updated.numUpdatedRows) > 0;
  }
  if (changed) await snapshot(tx, ctx, sessionId, now);
}

export async function updateSourceSelection(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  assetId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = sourceSelectionSchema.parse(raw);
  return db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    await assertSessionOwner(tx, ctx, sessionId);
    const source = await assetRow(tx, ctx, assetId);
    const link = await tx
      .selectFrom("src.session_source")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("asset_id", "=", assetId)
      .where("active", "=", true)
      .executeTakeFirst();
    if (!link) throw errors.notFound();
    const contract = await readInputContract(tx, source.contract_version);
    if (input.ranges.length > contract.maxRanges)
      throw errors.validationFailed({ ranges: ["too_many"] });
    if (input.ranges.length && !["audio", "pdf"].includes(source.kind))
      throw errors.validationFailed({ ranges: ["unsupported_source_kind"] });
    if (input.selected && source.kind === "pdf" && !source.page_count)
      throw errors.validationFailed({ pdf: ["password_required"] });
    if (input.selected && source.kind !== "audio" && !source.verified_at) throw errors.conflict();
    const maximum =
      source.kind === "audio"
        ? Number(source.duration_ms)
        : source.kind === "image"
          ? 1
          : (source.page_count ?? 0);
    let previousEnd = source.kind === "audio" ? -1 : 0;
    for (const range of input.ranges) {
      if (
        range.start < (source.kind === "audio" ? 0 : 1) ||
        range.end < range.start ||
        (source.kind === "audio" && range.end === range.start) ||
        range.end > maximum ||
        range.start <= previousEnd
      )
        throw errors.validationFailed({ ranges: ["invalid_range"] });
      previousEnd = range.end;
    }
    if (input.contentVersionId) {
      const version = await tx
        .selectFrom("src.content_version")
        .select("id")
        .where("id", "=", input.contentVersionId)
        .where("asset_id", "=", source.id)
        .where("user_id", "=", ctx.userId)
        .executeTakeFirst();
      if (!version) throw errors.notFound();
    }
    // Categories come from processing; an older browser payload cannot replace them.
    const same =
      link.selected === input.selected &&
      canonicalJson(link.ranges) === canonicalJson(input.ranges) &&
      link.time_status === input.timeStatus &&
      link.selected_content_version_id === input.contentVersionId;
    if (!same) {
      await tx
        .updateTable("src.session_source")
        .set({
          selected: input.selected,
          ranges: JSON.stringify(input.ranges),
          time_status: input.timeStatus,
          selected_content_version_id: input.contentVersionId,
          changed_at: now,
        })
        .where("id", "=", link.id)
        .execute();
      await snapshot(tx, ctx, sessionId, now);
    }
    return { updated: true };
  });
}

/** Reset one selected extraction after processing has verified its immutable failed-version pin. */
export async function resetSourceExtractionSelection(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  assetId: string,
  expected: {
    contentVersionId: string;
    sourcesVersion: number;
    ranges: readonly { start: number; end: number }[];
  },
  now = new Date(),
): Promise<number> {
  await lockOwner(tx, ctx);
  const session = await assertSessionOwner(tx, ctx, sessionId);
  if (session.sourcesVersion !== expected.sourcesVersion)
    throw errors.validationFailed({ source: ["retry_selection_changed"] });
  const source = await assetRow(tx, ctx, z.uuid().parse(assetId));
  const link = await tx
    .selectFrom("src.session_source")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("asset_id", "=", assetId)
    .where("user_id", "=", ctx.userId)
    .where("active", "=", true)
    .forUpdate()
    .executeTakeFirst();
  if (!link) throw errors.notFound();
  if (
    !link.selected ||
    link.selected_content_version_id !== expected.contentVersionId ||
    canonicalJson(link.ranges) !== canonicalJson(expected.ranges)
  )
    throw errors.validationFailed({ source: ["retry_selection_changed"] });
  if (!["audio", "image", "pdf"].includes(source.kind))
    throw errors.validationFailed({ source: ["retry_requires_replacement"] });
  let objectId =
    source.verified_at && !source.original_deleted_at ? source.original_object_id : null;
  if (source.kind === "audio") {
    const audio = await tx
      .selectFrom("src.audio_upload")
      .select("object_id")
      .where("asset_id", "=", assetId)
      .where("user_id", "=", ctx.userId)
      .where("state", "=", "verified")
      .where("expires_at", ">", now)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    objectId = audio?.object_id ?? null;
  }
  if (!objectId || (await ownedObjectMetadata(tx, ctx, objectId)).state !== "verified")
    throw errors.validationFailed({ source: ["original_unavailable"] });
  await tx
    .updateTable("src.session_source")
    .set({ selected_content_version_id: null, changed_at: now })
    .where("id", "=", link.id)
    .execute();
  await snapshot(tx, ctx, sessionId, now);
  return expected.sourcesVersion + 1;
}

export async function detachSource(
  db: Connection,
  ctx: LearnerContext,
  sessionId: string,
  assetId: string,
  now = new Date(),
) {
  const detach = async (tx: Tx) => {
    await lockOwner(tx, ctx);
    await assertSessionOwner(tx, ctx, sessionId);
    await assetRow(tx, ctx, assetId);
    const row = await tx
      .selectFrom("src.session_source")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("asset_id", "=", assetId)
      .executeTakeFirst();
    if (!row) throw errors.notFound();
    if (!row.active) return false;
    await tx
      .updateTable("src.session_source")
      .set({ active: false, changed_at: now })
      .where("id", "=", row.id)
      .execute();
    await snapshot(tx, ctx, sessionId, now);
    return true;
  };
  // True when this call detached the source; false when it was already detached.
  return db.isTransaction ? detach(db as Tx) : db.transaction().execute(detach);
}
export async function sourceReadLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  settings: PltSettings["storage"],
  now = new Date(),
) {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const source = await assetRow(tx, ctx, assetId);
    if (
      !source.original_object_id ||
      !source.verified_at ||
      source.original_deleted_at ||
      source.kind === "audio"
    )
      throw errors.notFound();
    return issueReadLink(tx, store, ctx, source.original_object_id, {
      settings,
      now,
      download: source.kind === "text" || source.kind === "html",
    });
  });
}

/** FR-SRC-013: tombstone is durable before asynchronous private-object cleanup. */
export async function deleteSource(
  db: Database,
  ctx: LearnerContext,
  assetId: string,
  mode: "original" | "all",
  now = new Date(),
  options: {
    onDelete?: (tx: Tx, sourceId: string, receiptId: string, sessionIds: string[]) => Promise<void>;
  } = {},
) {
  return db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx);
    const source = await tx
      .selectFrom("src.asset")
      .selectAll()
      .where("id", "=", assetId)
      .executeTakeFirst();
    assertOwner(source ? { ownerId: source.user_id } : undefined, ctx);
    if (!source) throw errors.notFound();
    if (source.tombstoned_at) return { deletionRequestId: source.deletion_request_id };
    if (mode === "original") {
      if (source.original_deleted_at) return { deletionRequestId: source.deletion_request_id };
      const content = await tx
        .selectFrom("src.content_version")
        .select("id")
        .where("asset_id", "=", assetId)
        .executeTakeFirst();
      if (!content) throw errors.validationFailed({ source: ["content_required"] });
    }
    const id = randomUUID();
    await tx
      .updateTable("src.asset")
      .set({
        original_deleted_at: now,
        deletion_request_id: id,
        ...(mode === "all" ? { tombstoned_at: now } : {}),
      })
      .where("id", "=", assetId)
      .execute();
    const links = await tx
      .selectFrom("src.session_source")
      .select(["id", "session_id"])
      .where("asset_id", "=", assetId)
      .where("active", "=", true)
      .execute();
    for (const link of links) {
      if (mode === "all")
        await tx
          .updateTable("src.session_source")
          .set({ active: false, changed_at: now })
          .where("id", "=", link.id)
          .execute();
      try {
        await assertSessionOwner(tx, ctx, link.session_id);
        await snapshot(tx, ctx, link.session_id, now);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error;
      }
    }
    await tx
      .insertInto("src.outbox")
      .values({
        id,
        user_id: ctx.userId,
        event_type: mode === "all" ? "source_deleted" : "original_deleted",
        subject_id: assetId,
        payload: JSON.stringify({ deletionRequestId: id }),
        created_at: now,
      })
      .execute();
    if (mode === "all")
      await options.onDelete?.(
        tx,
        assetId,
        id,
        links.map((link) => link.session_id),
      );
    return { deletionRequestId: id };
  });
}

export async function selectSourceSnapshot(
  tx: Connection,
  ctx: LearnerContext,
  sessionId: string,
  confirmedSnapshot?: {
    sources: readonly { sourceId: string; contentVersionId: string | null; role?: SourceRole }[];
  },
  providers: {
    legacyAudioRanges?: (originKey: string, sourceId: string) => Promise<unknown>;
  } = {},
) {
  const session = await assertSessionOwner(tx, ctx, sessionId);
  const links = await sessionSources(tx, ctx, sessionId);
  const sources = await Promise.all(
    links
      .filter((link) => link.selected)
      .map(async (link) => {
        const asset = await assetRow(tx, ctx, link.assetId);
        if (!asset.verified_at && asset.kind !== "audio")
          throw errors.validationFailed({ sources: ["not_verified"] });
        let content = link.contentVersionId
          ? await tx
              .selectFrom("src.content_version")
              .selectAll()
              .where("id", "=", link.contentVersionId)
              .where("user_id", "=", ctx.userId)
              .executeTakeFirst()
          : undefined;
        // Activation preserves the exact content version already confirmed for an older run.
        const confirmedSource = confirmedSnapshot?.sources.find(
          (source) => source.sourceId === asset.id,
        );
        const preserveConfirmedContent =
          content && confirmedSource?.contentVersionId === content.id;
        if (
          !preserveConfirmedContent &&
          content?.provenance === "machine_extraction" &&
          asset.kind === "image" &&
          !asset.original_deleted_at &&
          asset.original_object_id &&
          !sourceClassificationSchema.safeParse(
            extractionSettings(content.extraction_settings).sourceClassification,
          ).success
        )
          content = undefined;
        if (content && asset.kind === "audio" && !preserveConfirmedContent) {
          const settings = extractionSettings(content.extraction_settings);
          let extractedRanges = rangesSchema.safeParse(settings.ranges);
          if (!extractedRanges.success && content.origin_key.startsWith("processing:")) {
            extractedRanges = rangesSchema.safeParse(
              await providers.legacyAudioRanges?.(content.origin_key, asset.id),
            );
          }
          if (
            content.origin_key.startsWith("processing:") &&
            (!extractedRanges.success ||
              !audioSelectionMatchesCache(rangesSchema.parse(link.ranges), extractedRanges.data))
          )
            content = undefined;
        }
        const audio =
          asset.kind === "audio"
            ? await tx
                .selectFrom("src.audio_upload")
                .select(["object_id", "actual_duration_ms"])
                .where("asset_id", "=", asset.id)
                .where("user_id", "=", ctx.userId)
                .where("state", "=", "verified")
                .where("expires_at", ">", new Date())
                .orderBy("created_at", "desc")
                .executeTakeFirst()
            : undefined;
        return {
          sourceId: asset.id,
          kind: asset.kind,
          role:
            confirmedSource?.role ??
            automaticSourceRole(
              asset.kind,
              extractionSettings(content?.extraction_settings).sourceClassification ??
                (asset.kind !== "image" || content?.provenance === "user_correction"
                  ? { role: link.role, confidence: "high" }
                  : undefined),
            ),
          sha256: asset.sha256,
          mimeType: asset.verified_mime ?? asset.declared_mime,
          durationMs: audio?.actual_duration_ms
            ? Number(audio.actual_duration_ms)
            : asset.duration_ms === null
              ? null
              : Number(asset.duration_ms),
          pageCount: asset.page_count,
          objectId:
            asset.kind === "audio"
              ? (audio?.object_id ?? null)
              : asset.original_deleted_at
                ? null
                : asset.original_object_id,
          contentVersionId: content?.id ?? null,
          ranges: link.ranges,
          captureAnchor: link.anchorSourceId
            ? {
                sourceId: link.anchorSourceId,
                offsetMs: Number(link.captureOffsetMs),
                state: link.captureState,
                timeStatus: link.timeStatus,
              }
            : null,
          units: content?.units ?? [],
          blocks: content?.blocks ?? [],
        };
      }),
  );
  if (!sources.length) throw errors.validationFailed({ sources: ["select_at_least_one"] });
  return {
    sourcesVersion: session.sourcesVersion,
    fingerprint: sha256Hex(
      canonicalJson(sources.map(({ objectId: _objectId, ...source }) => source)),
    ),
    sources,
  };
}

/** Locks ordered assets against deletion before a run can publish derived output. */
export async function assertSourcesLive(tx: Tx, ctx: LearnerContext, sourceIds: string[]) {
  for (const id of [...new Set(sourceIds)].sort()) {
    const source = await tx
      .selectFrom("src.asset")
      .select(["user_id", "tombstoned_at"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    assertOwner(source && !source.tombstoned_at ? { ownerId: source.user_id } : undefined, ctx);
  }
}

async function tombstoneAsset(tx: Tx, ctx: LearnerContext, assetId: string, now: Date) {
  const row = await tx
    .selectFrom("src.asset")
    .selectAll()
    .where("id", "=", assetId)
    .where("user_id", "=", ctx.userId)
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.tombstoned_at) return;
  const id = randomUUID();
  await tx
    .updateTable("src.asset")
    .set({ tombstoned_at: now, original_deleted_at: now, deletion_request_id: id })
    .where("id", "=", assetId)
    .execute();
  await tx
    .insertInto("src.outbox")
    .values({
      id,
      user_id: ctx.userId,
      event_type: "source_deleted",
      subject_id: assetId,
      payload: JSON.stringify({ deletionRequestId: id }),
      created_at: now,
    })
    .execute();
}
/** Called by an already-authorized class deletion transaction; shared assets remain live. */
export async function tombstoneSessionSources(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
) {
  await lockOwner(tx, ctx);
  const links = await tx
    .selectFrom("src.session_source")
    .select(["id", "asset_id"])
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .where("active", "=", true)
    .execute();
  await tx
    .updateTable("src.session_source")
    .set({ active: false, changed_at: now })
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .execute();
  for (const link of links) {
    const remaining = await tx
      .selectFrom("src.session_source")
      .select("id")
      .where("asset_id", "=", link.asset_id)
      .where("active", "=", true)
      .executeTakeFirst();
    if (!remaining) await tombstoneAsset(tx, ctx, link.asset_id, now);
  }
}
export async function tombstoneAccountSources(tx: Tx, ctx: LearnerContext, now = new Date()) {
  await lockOwner(tx, ctx, true);
  await tx
    .updateTable("src.session_source")
    .set({ active: false, changed_at: now })
    .where("user_id", "=", ctx.userId)
    .execute();
  const assets = await tx
    .selectFrom("src.asset")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is", null)
    .orderBy("id")
    .execute();
  for (const asset of assets) await tombstoneAsset(tx, ctx, asset.id, now);
}
/** Physical private text purge runs only after tombstones, in the deletion worker. */
export async function cleanupSourceContent(db: Database, ctx: LearnerContext, assetIds?: string[]) {
  await db.transaction().execute(async (tx) => {
    await lockOwner(tx, ctx, true);
    const rows = await tx
      .selectFrom("src.asset")
      .select("id")
      .where("user_id", "=", ctx.userId)
      .where("tombstoned_at", "is not", null)
      .$if(assetIds !== undefined, (qb) => qb.where("id", "in", assetIds ?? []))
      .execute();
    if (!rows.length) return;
    const ids = rows.map((row) => row.id);
    await tx
      .updateTable("src.session_source")
      .set({ selected_content_version_id: null })
      .where("asset_id", "in", ids)
      .where("user_id", "=", ctx.userId)
      .execute();
    await tx
      .deleteFrom("src.content_version")
      .where("asset_id", "in", ids)
      .where("user_id", "=", ctx.userId)
      .execute();
    await tx
      .updateTable("src.asset")
      .set({
        display_name: "Deleted source",
        sha256: "0".repeat(64),
        request_hash: "0".repeat(64),
        operation_key: sql<string>`'deleted:' || id::text`,
        duration_ms: null,
        page_count: null,
        width: null,
        height: null,
      })
      .where("id", "in", ids)
      .execute();
    await tx
      .updateTable("src.session_source")
      .set({ ranges: "[]", anchor_source_id: null, capture_offset_ms: null, capture_state: null })
      .where("asset_id", "in", ids)
      .execute();
    await tx
      .updateTable("src.session_source")
      .set({
        anchor_source_id: null,
        capture_offset_ms: null,
        capture_state: null,
        time_status: "unknown",
      })
      .where("anchor_source_id", "in", ids)
      .execute();
    // Remove erased-source link metadata from every immutable selection snapshot.
    await sql`update src.source_snapshot s set sources = coalesce((select jsonb_agg(e) from jsonb_array_elements(s.sources) e where not (coalesce(e->>'asset_id','') = any(${ids}::text[])) and not (coalesce(e->>'anchor_source_id','') = any(${ids}::text[]))), '[]'::jsonb) where s.user_id=${ctx.userId}`.execute(
      tx,
    );
    const uploads = await tx
      .selectFrom("src.upload_session")
      .select("id")
      .where("asset_id", "in", ids)
      .execute();
    if (uploads.length)
      await tx
        .updateTable("src.upload_part")
        .set({ sha256: "0".repeat(64) })
        .where(
          "upload_id",
          "in",
          uploads.map((r) => r.id),
        )
        .execute();
    const audio = await tx
      .selectFrom("src.audio_upload")
      .select("id")
      .where("asset_id", "in", ids)
      .execute();
    if (audio.length)
      await tx
        .updateTable("src.audio_upload_part")
        .set({ sha256: "0".repeat(64) })
        .where(
          "upload_id",
          "in",
          audio.map((r) => r.id),
        )
        .execute();
  });
}
/** Offline restore replay only: apply durable visibility markers without jobs or provider IO. */
export async function tombstoneSourceForReplay(
  tx: Tx,
  ctx: LearnerContext,
  sourceId: string,
  _sessionIds: string[],
  now = new Date(),
) {
  const source = await tx
    .selectFrom("src.asset")
    .select(["id", "user_id", "tombstoned_at", "original_deleted_at"])
    .where("id", "=", sourceId)
    .executeTakeFirst();
  if (!source) return false;
  assertOwner({ ownerId: source.user_id }, ctx);
  await tx
    .updateTable("src.asset")
    .set({
      tombstoned_at: source.tombstoned_at ?? now,
      original_deleted_at: source.original_deleted_at ?? now,
    })
    .where("id", "=", sourceId)
    .execute();
  await tx
    .updateTable("src.session_source")
    .set({ active: false, selected: false, changed_at: now })
    .where("asset_id", "=", sourceId)
    .where("user_id", "=", ctx.userId)
    .execute();
  return true;
}
