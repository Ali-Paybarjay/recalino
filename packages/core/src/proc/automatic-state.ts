import type { Selectable } from "kysely";
import { z } from "zod";
import { liveAccountIdsQuery, lockAccount } from "../acc";
import { type Database, type DB, type Tx, withTransaction } from "../db";
import { assertSessionOwner, liveSessionIdsQuery } from "../org";
import { errors, type LearnerContext } from "../plt";

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
  batchId: string | null;
  lastBatchId: string | null;
  batchStartedAt: string | null;
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
    batchId: row.batch_id,
    lastBatchId: row.last_batch_id,
    batchStartedAt: row.batch_started_at?.toISOString() ?? null,
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
/** An ordinary sync initializes intent once; learner mutations explicitly increment it. */
export async function requestAutomaticLearning(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  options: { changed?: boolean; now?: Date } = {},
): Promise<AutomaticLearningSession> {
  const now = options.now ?? new Date();
  return withTransaction(db, async (tx) => {
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
/** Same open batch is a replay; a different batch cannot replace an unfinished upload group. */
export async function beginAutomaticLearningBatch(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  batchId: string,
  now = new Date(),
): Promise<AutomaticLearningSession> {
  z.uuid().parse(batchId);
  return withTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous?.batch_id) {
      if (previous.batch_id !== batchId) throw errors.conflict();
      return view(previous);
    }
    if (previous?.last_batch_id === batchId) return view(previous);
    const row = previous
      ? await tx
          .updateTable("proc.automatic_session")
          .set({
            batch_id: batchId,
            batch_started_at: now,
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
  return withTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await owned(tx, ctx, sessionId, true);
    if (previous && previous.batch_id === null && previous.last_batch_id === batchId)
      return view(previous);
    if (!previous || previous.batch_id !== batchId) throw errors.conflict();
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
  return withTransaction(db, async (tx) => {
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
        .executeTakeFirst();
      if (!run) throw errors.notFound();
      const latest = await tx
        .selectFrom("proc.processing_run")
        .select("id")
        .where("user_id", "=", ctx.userId)
        .where("session_id", "=", sessionId)
        .orderBy("created_at", "desc")
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

/** Internal reconciliation sees only explicitly enabled, live classes with no open batch. */
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
    )
    .where("automatic.batch_id", "is", null)
    .where("automatic.session_id", "in", liveSessionIdsQuery(db))
    .where("automatic.user_id", "in", liveAccountIdsQuery(db))
    .orderBy("automatic.updated_at")
    .orderBy("automatic.session_id")
    .limit(limit)
    .execute();
  return rows.map(view);
}
