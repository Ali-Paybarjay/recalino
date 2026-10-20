import type { Selectable } from "kysely";
import { z } from "zod";
import { liveAccountIdsQuery, lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import { assertSessionOwner, captureInProgress, liveSessionIdsQuery } from "../org";
import { errors, type LearnerContext } from "../plt";
import { batchSourceStates, detachSource, readInputContract } from "../src";

const batchFileSchema = z.strictObject({
  fileId: z.uuid(),
  sourceId: z.uuid().nullable(),
  skipped: z.boolean(),
  acknowledged: z.boolean().default(false),
});
export type AutomaticBatchFile = z.infer<typeof batchFileSchema>;
const batchManifestSchema = z.array(batchFileSchema).min(1).max(250);
function transaction<T>(db: Database | Tx, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.isTransaction ? work(db as Tx) : db.transaction().execute(work);
}

export const automaticLearningStates = [
  "waiting_sources",
  "waiting_upload",
  "processing",
  "ready",
  "blocked",
] as const;
export type AutomaticLearningState = (typeof automaticLearningStates)[number];
export interface AutomaticLearningSession {
  sessionId: string;
  userId: string;
  requestVersion: number;
  /**
   * D105: the request version the learner asked to process ("Process this session"); null until
   * the first press. Below requestVersion, material changed since, so the session waits again.
   */
  requestedVersion: number | null;
  requestedAt: string | null;
  batchId: string | null;
  lastBatchId: string | null;
  batchStartedAt: string | null;
  batchFiles: AutomaticBatchFile[] | null;
  state: AutomaticLearningState;
  lastError: string | null;
  runId: string | null;
  updatedAt: string;
  enabledAt: string;
}
type Row = Selectable<DB["proc.automatic_session"]>;
function view(row: Row): AutomaticLearningSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    requestVersion: row.request_version,
    requestedVersion: row.requested_version,
    requestedAt: row.requested_at?.toISOString() ?? null,
    batchId: row.batch_id,
    lastBatchId: row.last_batch_id,
    batchStartedAt: row.batch_started_at?.toISOString() ?? null,
    batchFiles: row.batch_manifest === null ? null : batchManifestSchema.parse(row.batch_manifest),
    state: z.enum(automaticLearningStates).parse(row.state),
    lastError: row.last_error,
    runId: row.run_id,
    updatedAt: row.updated_at.toISOString(),
    enabledAt: row.enabled_at.toISOString(),
  };
}
async function owned(tx: Database | Tx, ctx: LearnerContext, sessionId: string, lock = false) {
  await assertSessionOwner(tx, ctx, z.uuid().parse(sessionId));
  return tx
    .selectFrom("proc.automatic_session")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .$if(lock, (query) => query.forUpdate())
    .executeTakeFirst();
}
export async function getAutomaticLearningSession(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<AutomaticLearningSession | null> {
  const row = await owned(db, ctx, sessionId);
  return row ? view(row) : null;
}
/**
 * PERF-04: the intents of many sessions in one owner-scoped read, keyed by session. A foreign or
 * deleted session is omitted, as getAutomaticLearningSession would refuse it.
 */
export async function listAutomaticLearningSessions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<Map<string, AutomaticLearningSession>> {
  const ids = [...new Set(sessionIds)].filter((id) => z.uuid().safeParse(id).success);
  if (!ids.length) return new Map();
  const rows = await db
    .selectFrom("proc.automatic_session")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "in", ids)
    .where("session_id", "in", liveSessionIdsQuery(db).where("owner_id", "=", ctx.userId))
    .execute();
  return new Map(rows.map((row) => [row.session_id, view(row)]));
}
/** An ordinary sync initializes intent once; learner mutations explicitly increment it. */
export async function requestAutomaticLearning(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  options: { changed?: boolean; now?: Date } = {},
): Promise<AutomaticLearningSession> {
  const now = options.now ?? new Date();
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous && options.changed === false) return view(previous);
    const row = previous
      ? await tx
          .updateTable("proc.automatic_session")
          .set({
            request_version: previous.request_version + 1,
            state: "waiting_sources",
            last_error: null,
            updated_at: now,
          })
          .where("session_id", "=", sessionId)
          .where("user_id", "=", ctx.userId)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto("proc.automatic_session")
          .values({ session_id: sessionId, user_id: ctx.userId, enabled_at: now, updated_at: now })
          .returningAll()
          .executeTakeFirstOrThrow();
    return view(row);
  });
}
/**
 * D105 (owner decision 2026-10-20): the learner's "Process this session". The current material
 * becomes the request; a later material change raises requestVersion above it, so the session
 * waits for another press. Pressing again changes nothing. Refused while an upload group is open
 * or while any device records into the session: Process never stops a recording.
 */
export async function requestAutomaticProcessing(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<AutomaticLearningSession> {
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous?.batch_id) throw errors.conflict({ batch: ["batch_open"] });
    if (await captureInProgress(tx, ctx, sessionId, now))
      throw errors.conflict({ session: ["capture_in_progress"] });
    if (previous && previous.requested_version === previous.request_version) return view(previous);
    const row = previous
      ? await tx
          .updateTable("proc.automatic_session")
          .set({
            requested_version: previous.request_version,
            requested_at: now,
            state: "waiting_sources",
            last_error: null,
            updated_at: now,
          })
          .where("session_id", "=", sessionId)
          .where("user_id", "=", ctx.userId)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto("proc.automatic_session")
          .values({
            session_id: sessionId,
            user_id: ctx.userId,
            requested_version: 1,
            requested_at: now,
            enabled_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
    return view(row);
  });
}
/** Same open batch is a replay; a different batch cannot replace an unfinished upload group. */
export async function beginAutomaticLearningBatch(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  batchId: string,
  now = new Date(),
  expectedFileIds?: readonly string[],
): Promise<AutomaticLearningSession> {
  z.uuid().parse(batchId);
  const declared = expectedFileIds
    ? z.array(z.uuid()).min(1).max(250).parse(expectedFileIds)
    : null;
  if (declared && new Set(declared).size !== declared.length)
    throw errors.validationFailed({ expectedFileIds: ["duplicate"] });
  const manifest =
    declared?.map((fileId) => ({ fileId, sourceId: null, skipped: false, acknowledged: false })) ??
    null;
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous?.batch_id) {
      if (previous.batch_id !== batchId) throw errors.conflict();
      if (declared) {
        const saved =
          previous.batch_manifest === null
            ? null
            : batchManifestSchema.parse(previous.batch_manifest);
        if (
          !saved ||
          saved.length !== declared.length ||
          saved.some((file) => !declared.includes(file.fileId))
        )
          throw errors.conflict();
      }
      return view(previous);
    }
    if (previous?.last_batch_id === batchId) return view(previous);
    if (declared && declared.length > (await readInputContract(tx)).maxSourcesPerSession)
      throw errors.validationFailed({ expectedFileIds: ["too_many"] });
    const row = previous
      ? await tx
          .updateTable("proc.automatic_session")
          .set({
            batch_id: batchId,
            batch_started_at: now,
            batch_manifest: manifest ? JSON.stringify(manifest) : null,
            request_version: previous.request_version + 1,
            state: "waiting_sources",
            last_error: null,
            updated_at: now,
          })
          .where("session_id", "=", sessionId)
          .where("user_id", "=", ctx.userId)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto("proc.automatic_session")
          .values({
            session_id: sessionId,
            user_id: ctx.userId,
            batch_id: batchId,
            batch_started_at: now,
            batch_manifest: manifest ? JSON.stringify(manifest) : null,
            enabled_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
    return view(row);
  });
}
export async function completeAutomaticLearningBatch(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  batchId: string,
  now = new Date(),
): Promise<AutomaticLearningSession> {
  z.uuid().parse(batchId);
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous && previous.batch_id === null && previous.last_batch_id === batchId)
      return view(previous);
    if (!previous || previous.batch_id !== batchId) throw errors.conflict();
    if (previous.batch_manifest !== null) {
      const result = await batchReadiness(
        tx,
        ctx,
        sessionId,
        batchManifestSchema.parse(previous.batch_manifest),
      );
      if (!result.complete)
        throw errors.validationFailed({ batch: [result.problem ?? "incomplete"] });
    }
    const row = await tx
      .updateTable("proc.automatic_session")
      .set({
        batch_id: null,
        last_batch_id: batchId,
        batch_started_at: null,
        request_version: previous.request_version + 1,
        state: "waiting_sources",
        last_error: null,
        updated_at: now,
      })
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

async function batchReadiness(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  files: readonly AutomaticBatchFile[],
): Promise<{ complete: boolean; problem: string | null }> {
  const requested = files.filter((file) => !file.skipped);
  if (!requested.length) return { complete: false, problem: "select_at_least_one" };
  if (requested.some((file) => !file.sourceId)) return { complete: false, problem: "batch_open" };
  const rows = await batchSourceStates(
    tx,
    ctx,
    sessionId,
    requested.map((file) => file.sourceId as string),
  );
  for (const file of requested) {
    const source = rows.find((row) => row.sourceId === file.sourceId);
    if (
      !source ||
      source.tombstonedAt ||
      source.originalDeletedAt ||
      source.rejectionReason ||
      ["rejected", "abandoned", "deleted"].includes(source.uploadState ?? "")
    )
      return { complete: false, problem: "upload_needs_attention" };
    // Registering audio authorizes the existing awaiting_upload workflow, never transcription itself.
    if (source.kind === "audio" ? !file.acknowledged : !source.verifiedAt)
      return { complete: false, problem: "batch_open" };
  }
  return { complete: true, problem: null };
}

/** Only declared IDs and active sources owned by this class can acknowledge a file. */
export async function registerAutomaticLearningFile(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  input: { batchId: string; fileId: string; sourceId: string },
  now = new Date(),
  acknowledged = true,
): Promise<AutomaticLearningSession> {
  z.strictObject({ batchId: z.uuid(), fileId: z.uuid(), sourceId: z.uuid() }).parse(input);
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (
      !previous?.batch_manifest ||
      (previous.batch_id !== input.batchId && previous.last_batch_id !== input.batchId)
    )
      throw errors.conflict();
    const files = batchManifestSchema.parse(previous.batch_manifest);
    const file = files.find((entry) => entry.fileId === input.fileId);
    if (!file || file.skipped) throw errors.conflict();
    const sameSource = file.sourceId === input.sourceId;
    if (sameSource && (file.acknowledged || !acknowledged)) return view(previous);
    if (!previous.batch_id) throw errors.conflict();
    const [source] = await batchSourceStates(tx, ctx, sessionId, [input.sourceId]);
    if (!source || source.tombstonedAt || source.originalDeletedAt) throw errors.notFound();
    if (file.sourceId && !sameSource) {
      const [old] = await batchSourceStates(tx, ctx, sessionId, [file.sourceId], true);
      if (
        old &&
        !old.tombstonedAt &&
        old.active &&
        !old.rejectionReason &&
        !["rejected", "abandoned", "deleted"].includes(old.uploadState ?? "")
      )
        throw errors.conflict();
      if (old && !old.tombstonedAt && old.active)
        await detachSource(tx, ctx, sessionId, file.sourceId, now);
    }
    file.sourceId = input.sourceId;
    file.acknowledged = sameSource ? file.acknowledged || acknowledged : acknowledged;
    const row = await tx
      .updateTable("proc.automatic_session")
      .set({ batch_manifest: JSON.stringify(files), updated_at: now, last_error: null })
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

/** Explicit learner omission also detaches its source, so it cannot fence the remaining group. */
export async function skipAutomaticLearningFile(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  input: { batchId: string; fileId: string },
  now = new Date(),
): Promise<AutomaticLearningSession> {
  z.strictObject({ batchId: z.uuid(), fileId: z.uuid() }).parse(input);
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (
      !previous?.batch_manifest ||
      (previous.batch_id !== input.batchId && previous.last_batch_id !== input.batchId)
    )
      throw errors.conflict();
    const files = batchManifestSchema.parse(previous.batch_manifest);
    const file = files.find((entry) => entry.fileId === input.fileId);
    if (!file) throw errors.conflict();
    if (file.skipped) return view(previous);
    if (!previous.batch_id) throw errors.conflict();
    if (!files.some((entry) => entry.fileId !== input.fileId && !entry.skipped))
      throw errors.validationFailed({ batch: ["select_at_least_one"] });
    if (
      file.sourceId &&
      !files.some(
        (entry) =>
          entry.fileId !== file.fileId && !entry.skipped && entry.sourceId === file.sourceId,
      )
    ) {
      const [source] = await batchSourceStates(tx, ctx, sessionId, [file.sourceId]);
      if (source && !source.tombstonedAt)
        await detachSource(tx, ctx, sessionId, file.sourceId, now);
    }
    file.skipped = true;
    const row = await tx
      .updateTable("proc.automatic_session")
      .set({ batch_manifest: JSON.stringify(files), updated_at: now, last_error: null })
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

/** Cancellation is a durable fence against late receipts and queued automatic workers. */
export async function cancelAutomaticLearningBatch(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  batchId: string,
  now = new Date(),
): Promise<AutomaticLearningSession> {
  z.uuid().parse(batchId);
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (!previous?.batch_manifest) throw errors.conflict();
    if (
      previous.batch_id === null &&
      previous.last_batch_id === batchId &&
      previous.last_error === "upload_batch_cancelled"
    )
      return view(previous);
    if (previous.batch_id !== batchId) throw errors.conflict();
    const files = batchManifestSchema.parse(previous.batch_manifest);
    for (const sourceId of new Set(
      files.flatMap((file) => (file.sourceId ? [file.sourceId] : [])),
    )) {
      const [source] = await batchSourceStates(tx, ctx, sessionId, [sourceId]);
      if (source && !source.tombstonedAt) await detachSource(tx, ctx, sessionId, sourceId, now);
    }
    const row = await tx
      .updateTable("proc.automatic_session")
      .set({
        batch_id: null,
        batch_started_at: null,
        last_batch_id: batchId,
        batch_manifest: JSON.stringify(files.map((file) => ({ ...file, skipped: true }))),
        request_version: previous.request_version + 1,
        state: "blocked",
        last_error: "upload_batch_cancelled",
        updated_at: now,
      })
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

/** Reconciles server receipts; an incomplete or failed declared group is never silently sealed. */
export async function reconcileAutomaticLearningBatch(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<AutomaticLearningSession | null> {
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (!previous?.batch_id || !previous.batch_manifest) return previous ? view(previous) : null;
    const result = await batchReadiness(
      tx,
      ctx,
      sessionId,
      batchManifestSchema.parse(previous.batch_manifest),
    );
    const row = await tx
      .updateTable("proc.automatic_session")
      .set(
        result.complete
          ? {
              batch_id: null,
              batch_started_at: null,
              last_batch_id: previous.batch_id,
              request_version: previous.request_version + 1,
              state: "waiting_sources",
              last_error: null,
              updated_at: now,
            }
          : { state: "waiting_sources", last_error: result.problem, updated_at: now },
      )
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}
/** Late workers can only update the exact intent they observed. Open batches stay fenced. */
export async function updateAutomaticLearningProgress(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  expectedRequestVersion: number,
  input: { state: AutomaticLearningState; lastError?: string | null; runId?: string | null },
  now = new Date(),
): Promise<AutomaticLearningSession | null> {
  z.int().positive().parse(expectedRequestVersion);
  z.enum(automaticLearningStates).parse(input.state);
  if (input.lastError !== undefined && input.lastError !== null)
    z.string()
      .regex(/^[a-z0-9_.]{1,64}$/)
      .parse(input.lastError);
  if (input.runId) z.uuid().parse(input.runId);
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (!previous || previous.request_version !== expectedRequestVersion) return null;
    if (previous.batch_id && input.state !== "waiting_sources") return null;
    if (input.runId) {
      const run = await tx
        .selectFrom("proc.processing_run")
        .select("id")
        .where("id", "=", input.runId)
        .where("user_id", "=", ctx.userId)
        .where("session_id", "=", sessionId)
        .where("kind", "=", "class")
        .executeTakeFirst();
      if (!run) throw errors.notFound();
      const latest = await tx
        .selectFrom("proc.processing_run")
        .select("id")
        .where("user_id", "=", ctx.userId)
        .where("session_id", "=", sessionId)
        .where("kind", "=", "class")
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      if (latest?.id !== input.runId) return null;
    }
    const row = await tx
      .updateTable("proc.automatic_session")
      .set({
        state: input.state,
        ...(input.lastError !== undefined ? { last_error: input.lastError } : {}),
        ...(input.runId !== undefined ? { run_id: input.runId } : {}),
        updated_at: now,
      })
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .where("request_version", "=", expectedRequestVersion)
      .returningAll()
      .executeTakeFirst();
    return row ? view(row) : null;
  });
}

/**
 * Internal reconciliation sees only live classes whose current material the learner asked to
 * process (D105), plus open declared upload groups, whose verification recovery needs no request.
 * The predicate matches automatic_session_pending_idx.
 */
export async function listPendingAutomaticLearning(
  db: Database | Tx,
  limit = 50,
): Promise<AutomaticLearningSession[]> {
  z.int().min(1).max(250).parse(limit);
  const rows = await db
    .selectFrom("proc.automatic_session as automatic")
    .selectAll("automatic")
    .where((eb) =>
      eb.or([
        eb.and([
          eb("automatic.requested_version", "=", eb.ref("automatic.request_version")),
          eb.or([
            eb("automatic.state", "in", ["waiting_sources", "waiting_upload", "processing"]),
            eb.and([
              eb("automatic.state", "=", "blocked"),
              eb("automatic.last_error", "in", [
                "configuration_unavailable",
                "storage_unavailable",
                "settings_changed",
              ]),
            ]),
          ]),
        ]),
        eb.and([
          eb("automatic.batch_id", "is not", null),
          eb("automatic.batch_manifest", "is not", null),
        ]),
      ]),
    )
    .where((eb) =>
      eb.or([eb("automatic.batch_id", "is", null), eb("automatic.batch_manifest", "is not", null)]),
    )
    .where("automatic.session_id", "in", liveSessionIdsQuery(db))
    .where("automatic.user_id", "in", liveAccountIdsQuery(db))
    .orderBy("automatic.updated_at")
    .orderBy("automatic.session_id")
    .limit(limit)
    .execute();
  return rows.map(view);
}
