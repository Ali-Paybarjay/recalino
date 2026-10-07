import { createHash, randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import sharp from "sharp";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import { type AiProvider, ProviderError, type ProviderResult, requireProvider } from "../aip";
import type { Database, DB, Tx } from "../db";
import { assertSessionOwner, getSession } from "../org";
import {
  AppError,
  assertOwner,
  canonicalJson,
  deleteObject,
  errors,
  issueReadLink,
  type JobContext,
  type JobDefinition,
  type LearnerContext,
  type ObjectStore,
  type PltSettings,
  readOwnedObject,
  readPltSettings,
  sha256Hex,
  writeOwnedObject,
} from "../plt";
import {
  type Amounts,
  amounts,
  releaseStorage,
  reservationForOperation,
  reserveAllowance,
  settleAllowance,
} from "../quota";
import {
  assertSourcesLive,
  detectBinaryMime,
  getSource,
  readInputContract,
  sessionSources,
} from "../src";

export const mediaSettingsSchema = z.strictObject({
  maxTtsCharacters: z.number().int().positive(),
  maxTtsBytes: z.number().int().positive(),
  pronunciationVoice: z.string().trim().min(1).max(200).optional(),
});
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;
export interface MediaAsset {
  id: string;
  sessionId: string;
  kind: "image" | "tts";
  state: "queued" | "processing" | "ready" | "failed" | "needs_input" | "deleted";
  objectId: string | null;
  mimeType: string | null;
  sourceId: string | null;
  synthetic: boolean;
  exportAllowed: boolean;
  lastError: string | null;
  createdAt: string;
}
function view(row: Selectable<DB["media.asset"]>): MediaAsset {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind as MediaAsset["kind"],
    state: row.state as MediaAsset["state"],
    objectId: row.object_id,
    mimeType: row.mime_type,
    sourceId: row.source_id,
    synthetic: row.synthetic,
    exportAllowed: row.export_allowed,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
  };
}
async function owned(db: Database | Tx, ctx: LearnerContext, id: string) {
  const row = await db
    .selectFrom("media.asset")
    .selectAll()
    .where("id", "=", id)
    .where("tombstoned_at", "is", null)
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  await getSession(db, ctx, row.session_id);
  if (row.source_id) await getSource(db, ctx, row.source_id);
  return row;
}
export async function getMediaAsset(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<MediaAsset> {
  return view(await owned(db, ctx, id));
}
export async function listMediaAssets(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<MediaAsset[]> {
  await getSession(db, ctx, sessionId);
  const rows = await db
    .selectFrom("media.asset")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map(view);
}
export async function mediaReadLink(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  id: string,
  settings: PltSettings["storage"],
  now = new Date(),
) {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const media = await owned(tx, ctx, id);
    if (media.state !== "ready" || !media.object_id) throw errors.notFound();
    return issueReadLink(tx, store, ctx, media.object_id, { settings, now });
  });
}
export async function readMediaBytes(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  id: string,
  forExport = false,
): Promise<{ bytes: Uint8Array; asset: MediaAsset }> {
  const asset = await getMediaAsset(db, ctx, id);
  if (asset.state !== "ready" || !asset.objectId || (forExport && !asset.exportAllowed))
    throw errors.notFound();
  return { bytes: await readOwnedObject(db, store, ctx, asset.objectId), asset };
}
export async function setMediaExportPermission(
  db: Database,
  ctx: LearnerContext,
  id: string,
  allowed: boolean,
): Promise<MediaAsset> {
  z.boolean().parse(allowed);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const current = await owned(tx, ctx, id);
    await assertSessionOwner(tx, ctx, current.session_id);
    return view(
      await tx
        .updateTable("media.asset")
        .set({ export_allowed: allowed })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  });
}

const imageRequest = z.strictObject({
  sessionId: z.uuid(),
  sourceId: z.uuid(),
  operationKey: z.string().min(8).max(200),
  exportAllowed: z.boolean(),
  crop: z
    .strictObject({
      left: z.number().int().nonnegative(),
      top: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
/** PRD-MEDIA-01: selected class images are decoded and rewritten, never fetched from a learner URL. */
export async function createImageMedia(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  raw: unknown,
  now = new Date(),
): Promise<MediaAsset> {
  const input = imageRequest.parse(raw);
  const requestHash = sha256Hex(canonicalJson(input));
  const initialized = await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await assertSessionOwner(tx, ctx, input.sessionId);
    const prior = await tx
      .selectFrom("media.asset")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (prior) {
      if (prior.request_hash !== requestHash) throw errors.idempotencyMismatch();
      return { prior };
    }
    const source = await getSource(tx, ctx, input.sourceId);
    if (
      !(await sessionSources(tx, ctx, input.sessionId)).some(
        (item) => item.assetId === source.id && item.selected,
      )
    )
      throw errors.validationFailed({ image: ["selected_class_source_required"] });
    if (
      source.kind !== "image" ||
      !source.verified_at ||
      !source.original_object_id ||
      source.original_deleted_at
    )
      throw errors.validationFailed({ image: ["verified_source_required"] });
    const contract = await readInputContract(tx, source.contract_version);
    const cacheKey = sha256Hex(
      canonicalJson({ sourceId: source.id, sha256: source.sha256, crop: input.crop ?? null }),
    );
    const cache = await tx
      .selectFrom("media.asset")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", input.sessionId)
      .where("cache_key", "=", cacheKey)
      .where("state", "in", ["queued", "processing", "ready"])
      .executeTakeFirst();
    if (cache) return { prior: cache };
    const id = randomUUID();
    const reservation = await reserveAllowance(
      tx,
      ctx,
      `image-media:${id}`,
      amounts({ storage: contract.formats.image.maxBytes }),
      now,
    );
    const row = await tx
      .insertInto("media.asset")
      .values({
        id,
        user_id: ctx.userId,
        session_id: input.sessionId,
        kind: "image",
        state: "processing",
        source_id: source.id,
        source_sha256: source.sha256,
        synthetic: false,
        export_allowed: input.exportAllowed,
        operation_key: input.operationKey,
        request_hash: requestHash,
        cache_key: cacheKey,
        request: JSON.stringify(input),
        generation: JSON.stringify({ method: "safe_image_rewrite", sourceSha256: source.sha256 }),
        reservation_id: reservation.id,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { row, source, contract };
  });
  if (initialized.prior) return view(initialized.prior);
  const { row, source, contract } = initialized;
  if (!row || !source?.original_object_id || !contract) throw errors.conflict();
  let stagedObjectId: string | null = null;
  try {
    const original = await readOwnedObject(db, store, ctx, source.original_object_id);
    if (createHash("sha256").update(original).digest("hex") !== source.sha256)
      throw errors.validationFailed({ source: ["integrity"] });
    let image = sharp(original, {
      limitInputPixels: contract.formats.image.maxPixels ?? 0,
      animated: false,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
      throw errors.unsupportedMedia();
    if (input.crop) {
      if (
        input.crop.left + input.crop.width > metadata.width ||
        input.crop.top + input.crop.height > metadata.height
      )
        throw errors.validationFailed({ crop: ["outside_image"] });
      image = image.extract(input.crop);
    }
    const bytes = await image.jpeg().toBuffer();
    if (bytes.length > contract.formats.image.maxBytes) throw errors.payloadTooLarge();
    const objectId = await writeOwnedObject(db, store, ctx, {
      module: "media",
      retention: "durable",
      contentType: "image/jpeg",
      bytes,
      now,
      onRegistered: async (id) => {
        stagedObjectId = id;
        await db.transaction().execute(async (tx) => {
          await lockAccount(tx, ctx.userId);
          await assertSessionOwner(tx, ctx, input.sessionId);
          await assertSourcesLive(tx, ctx, [source.id]);
          const current = await owned(tx, ctx, row.id);
          if (current.state !== "processing") throw errors.conflict();
          await tx
            .updateTable("media.asset")
            .set({ object_id: id })
            .where("id", "=", row.id)
            .execute();
        });
      },
    });
    return db.transaction().execute(async (tx) => {
      await lockAccount(tx, ctx.userId);
      await assertSessionOwner(tx, ctx, input.sessionId);
      await assertSourcesLive(tx, ctx, [source.id]);
      const current = await owned(tx, ctx, row.id);
      if (current.state !== "processing" || !current.reservation_id) throw errors.conflict();
      await settleAllowance(
        tx,
        ctx,
        current.reservation_id,
        amounts({ storage: bytes.length }),
        now,
      );
      return view(
        await tx
          .updateTable("media.asset")
          .set({ state: "ready", object_id: objectId, mime_type: "image/jpeg", completed_at: now })
          .where("id", "=", row.id)
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    });
  } catch (error) {
    if (stagedObjectId) await deleteObject(db, store, ctx, stagedObjectId, now);
    await db.transaction().execute(async (tx) => {
      await lockAccountForCleanup(tx, ctx.userId);
      if (row.reservation_id) await settleAllowance(tx, ctx, row.reservation_id, amounts({}), now);
      await tx
        .updateTable("media.asset")
        .set({
          state: "failed",
          last_error: error instanceof AppError ? error.code : "image_failed",
          completed_at: now,
        })
        .where("id", "=", row.id)
        .where("state", "=", "processing")
        .execute();
    });
    throw error;
  }
}

export interface MediaProcessor {
  schedule(
    tx: Tx,
    ctx: LearnerContext,
    input: {
      sessionId: string;
      operationKey: string;
      subjectId: string;
      requested: Amounts;
      request: unknown;
      settings: unknown;
      job: JobDefinition<{ runId: string; userId: string; subjectId: string }>;
    },
    now: Date,
  ): Promise<string>;
  execute<T>(
    job: JobContext,
    ctx: LearnerContext,
    runId: string,
    input: {
      step: string;
      model: string;
      provider: AiProvider;
      schema: z.ZodType<T>;
      effect: (operationKey: string) => Promise<ProviderResult<T>>;
    },
  ): Promise<T>;
  complete(
    tx: Tx,
    ctx: LearnerContext,
    runId: string,
    published: Amounts,
    now: Date,
  ): Promise<void>;
  fail(
    tx: Tx,
    ctx: LearnerContext,
    runId: string,
    input: { code: string; uncertain?: boolean; cancelled?: boolean },
    now: Date,
  ): Promise<void>;
}
export interface MediaDependencies {
  provider?: AiProvider;
  store: ObjectStore;
  settings: MediaSettings;
  processor: MediaProcessor;
}
const ttsRequest = z.strictObject({
  sessionId: z.uuid(),
  text: z.string().trim().min(1),
  operationKey: z.string().min(8).max(200),
  exportAllowed: z.boolean(),
  purpose: z.literal("pronunciation").optional(),
});

function ttsGeneration(dependencies: MediaDependencies, pronunciation: boolean) {
  const provider = requireProvider(dependencies.provider);
  if (!pronunciation) return provider.settings;
  const voice = mediaSettingsSchema.parse(dependencies.settings).pronunciationVoice;
  if (!voice) throw errors.validationFailed({ media: ["pronunciation_not_configured"] });
  return { ...provider.settings, voice };
}
const ttsPayload = z.strictObject({ runId: z.uuid(), userId: z.uuid(), subjectId: z.uuid() });
const audioOutput = z.strictObject({
  bytesBase64: z.string().min(1),
  mimeType: z.literal("audio/mpeg"),
});
/** AC-19: identical text/model/voice per owner/session reuses media without a new reservation/call. */
export async function requestTts(
  db: Database,
  ctx: LearnerContext,
  raw: unknown,
  dependencies: MediaDependencies,
  now = new Date(),
): Promise<MediaAsset> {
  const input = ttsRequest.parse(raw);
  input.text = input.text.normalize("NFC").replace(/\s+/g, " ");
  const generation = ttsGeneration(dependencies, input.purpose === "pronunciation");
  const limits = mediaSettingsSchema.parse(dependencies.settings);
  const characters = Array.from(input.text).length;
  if (
    characters > limits.maxTtsCharacters ||
    /[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}]/u.test(input.text) ||
    !/\p{Script=Latin}/u.test(input.text)
  )
    throw errors.validationFailed({ text: ["short_english_required"] });
  const hash = sha256Hex(canonicalJson(input));
  const cacheKey = sha256Hex(
    canonicalJson({
      text: input.text,
      model: generation.ttsModel,
      voice: generation.voice,
      version: generation.version,
    }),
  );
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await assertSessionOwner(tx, ctx, input.sessionId);
    const previous = await tx
      .selectFrom("media.asset")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== hash) throw errors.idempotencyMismatch();
      return view(previous);
    }
    const cache = await tx
      .selectFrom("media.asset")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", input.sessionId)
      .where("cache_key", "=", cacheKey)
      .where("state", "in", ["queued", "processing", "ready"])
      .executeTakeFirst();
    if (cache) return view(cache);
    const id = randomUUID();
    const job = mediaTtsJob(dependencies);
    const runId = await dependencies.processor.schedule(
      tx,
      ctx,
      {
        sessionId: input.sessionId,
        operationKey: `media-tts:${id}`,
        subjectId: id,
        requested: amounts({ tts: characters, storage: limits.maxTtsBytes }),
        request: { text: input.text },
        settings: generation,
        job,
      },
      now,
    );
    const row = await tx
      .insertInto("media.asset")
      .values({
        id,
        user_id: ctx.userId,
        session_id: input.sessionId,
        kind: "tts",
        state: "queued",
        synthetic: true,
        export_allowed: input.exportAllowed,
        operation_key: input.operationKey,
        request_hash: hash,
        cache_key: cacheKey,
        request: JSON.stringify(input),
        generation: JSON.stringify(generation),
        run_id: runId,
        reservation_id: (await reservationForOperation(tx, ctx, `auxiliary:${runId}`))?.id ?? null,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}
export function mediaTtsJob(
  dependencies: MediaDependencies,
): JobDefinition<z.infer<typeof ttsPayload>> {
  return {
    kind: "media.tts",
    version: 1,
    payload: ttsPayload,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      let stagedObjectId: string | null = null;
      try {
        const provider = requireProvider(dependencies.provider);
        const row = await owned(job.db, ctx, payload.subjectId);
        if (row.state === "ready" || row.state === "deleted") return;
        if (!["queued", "processing"].includes(row.state) || row.run_id !== payload.runId)
          throw errors.conflict();
        const request = ttsRequest.parse(row.request);
        const generation = ttsGeneration(dependencies, request.purpose === "pronunciation");
        if (canonicalJson(row.generation) !== canonicalJson(generation))
          throw errors.validationFailed({ provider: ["settings_changed"] });
        const limits = mediaSettingsSchema.parse(dependencies.settings);
        await job.db
          .updateTable("media.asset")
          .set({ state: "processing" })
          .where("id", "=", row.id)
          .where("state", "=", "queued")
          .execute();
        const output = await dependencies.processor.execute(job, ctx, payload.runId, {
          step: "speech",
          model: provider.settings.ttsModel,
          provider,
          schema: audioOutput,
          effect: async (operationKey) => {
            const result = await provider.speech({
              operationKey,
              text: request.text,
              model: generation.ttsModel,
              voice: generation.voice,
            });
            return {
              ...result,
              output: {
                bytesBase64: Buffer.from(result.output.bytes).toString("base64"),
                mimeType: result.output.mimeType,
              },
            };
          },
        });
        const bytes = Buffer.from(output.bytesBase64, "base64");
        if (!bytes.length || bytes.length > limits.maxTtsBytes) throw errors.payloadTooLarge();
        if (detectBinaryMime(bytes) !== "audio/mpeg") throw errors.unsupportedMedia();
        const objectId =
          row.object_id ??
          (await writeOwnedObject(job.db, dependencies.store, ctx, {
            module: "media",
            retention: "durable",
            contentType: output.mimeType,
            bytes,
            now: job.now(),
            onRegistered: async (id) => {
              stagedObjectId = id;
              await job.db.transaction().execute(async (tx) => {
                await lockAccount(tx, ctx.userId);
                await assertSessionOwner(tx, ctx, row.session_id);
                const current = await owned(tx, ctx, row.id);
                if (!["queued", "processing"].includes(current.state)) throw errors.conflict();
                await tx
                  .updateTable("media.asset")
                  .set({ object_id: id })
                  .where("id", "=", row.id)
                  .execute();
              });
            },
          }));
        await job.db.transaction().execute(async (tx) => {
          await lockAccount(tx, ctx.userId);
          await assertSessionOwner(tx, ctx, row.session_id);
          const current = await owned(tx, ctx, row.id);
          if (!["queued", "processing"].includes(current.state)) throw errors.conflict();
          await dependencies.processor.complete(
            tx,
            ctx,
            payload.runId,
            amounts({ tts: Array.from(request.text).length, storage: bytes.length }),
            job.now(),
          );
          await tx
            .updateTable("media.asset")
            .set({
              state: "ready",
              object_id: objectId,
              mime_type: output.mimeType,
              completed_at: job.now(),
            })
            .where("id", "=", row.id)
            .execute();
        });
      } catch (error) {
        const retryable =
          error instanceof ProviderError &&
          error.retryable &&
          job.job.attempt < readPltSettings().jobs.maxAttempts;
        if (retryable) throw error;
        if (stagedObjectId)
          await deleteObject(job.db, dependencies.store, ctx, stagedObjectId, job.now());
        const code =
          error instanceof ProviderError
            ? error.code
            : error instanceof AppError
              ? error.code
              : "media_failed";
        await job.db.transaction().execute(async (tx) => {
          await dependencies.processor.fail(
            tx,
            ctx,
            payload.runId,
            { code, uncertain: error instanceof ProviderError && error.uncertain },
            job.now(),
          );
          await tx
            .updateTable("media.asset")
            .set({
              state: error instanceof ProviderError && error.uncertain ? "needs_input" : "failed",
              last_error: code,
              completed_at: job.now(),
            })
            .where("id", "=", payload.subjectId)
            .where("user_id", "=", ctx.userId)
            .where("state", "in", ["queued", "processing"])
            .execute();
        });
      }
    },
  };
}
export async function tombstoneSessionMedia(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const rows = await tx
    .selectFrom("media.asset")
    .select(["reservation_id", "state"])
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .forUpdate()
    .execute();
  for (const row of rows)
    if (row.reservation_id && ["queued", "processing"].includes(row.state))
      await settleAllowance(tx, ctx, row.reservation_id, amounts({}), now);
  await tx
    .updateTable("media.asset")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .execute();
}

export async function tombstoneAccountMedia(
  tx: Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  const rows = await tx
    .selectFrom("media.asset")
    .select(["id", "reservation_id", "state"])
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is", null)
    .forUpdate()
    .execute();
  for (const row of rows)
    if (row.reservation_id && ["queued", "processing"].includes(row.state))
      await settleAllowance(tx, ctx, row.reservation_id, amounts({}), now);
  await tx
    .updateTable("media.asset")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is", null)
    .execute();
}
export async function tombstoneSourceMedia(
  tx: Tx,
  ctx: LearnerContext,
  sourceId: string,
  now = new Date(),
  sessionIds: readonly string[] = [],
): Promise<void> {
  const rows = await tx
    .selectFrom("media.asset")
    .select(["id", "reservation_id", "state"])
    .where("user_id", "=", ctx.userId)
    .where((eb) =>
      eb.or([
        eb("source_id", "=", sourceId),
        ...(sessionIds.length ? [eb("session_id", "in", [...sessionIds])] : []),
      ]),
    )
    .where("tombstoned_at", "is", null)
    .forUpdate()
    .execute();
  for (const row of rows)
    if (row.reservation_id && ["queued", "processing"].includes(row.state))
      await settleAllowance(tx, ctx, row.reservation_id, amounts({}), now);
  await tx
    .updateTable("media.asset")
    .set({ state: "deleted", tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where((eb) =>
      eb.or([
        eb("source_id", "=", sourceId),
        ...(sessionIds.length ? [eb("session_id", "in", [...sessionIds])] : []),
      ]),
    )
    .where("tombstoned_at", "is", null)
    .execute();
}
async function cleanupMedia(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  scope: { sessionId?: string; sourceId?: string; sessionIds?: readonly string[] },
  now: Date,
): Promise<void> {
  const rows = await db
    .selectFrom("media.asset")
    .select(["id", "object_id", "reservation_id"])
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is not", null)
    .$if(Boolean(scope.sessionId), (qb) => qb.where("session_id", "=", scope.sessionId ?? ""))
    .$if(Boolean(scope.sourceId), (qb) =>
      qb.where((eb) =>
        eb.or([
          eb("source_id", "=", scope.sourceId ?? ""),
          ...(scope.sessionIds?.length ? [eb("session_id", "in", [...scope.sessionIds])] : []),
        ]),
      ),
    )
    .execute();
  for (const row of rows) {
    if (row.object_id) await deleteObject(db, store, ctx, row.object_id, now);
    if (row.reservation_id)
      await db
        .transaction()
        .execute((tx) => releaseStorage(tx, ctx, row.reservation_id ?? "", now));
    await db
      .updateTable("media.asset")
      .set({
        object_id: null,
        request: "{}",
        generation: "{}",
        mime_type: null,
        source_sha256: null,
      })
      .where("id", "=", row.id)
      .where("user_id", "=", ctx.userId)
      .execute();
  }
}
export async function cleanupSessionMedia(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await cleanupMedia(db, store, ctx, { sessionId }, now);
}
export async function cleanupSourceMedia(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  sourceId: string,
  now = new Date(),
  sessionIds: readonly string[] = [],
): Promise<void> {
  await cleanupMedia(db, store, ctx, { sourceId, sessionIds }, now);
}
export async function cleanupAccountMedia(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await cleanupMedia(db, store, ctx, {}, now);
}
