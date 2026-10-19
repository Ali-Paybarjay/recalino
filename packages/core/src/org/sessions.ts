import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import type { Database, DB, Tx } from "../db";
import { assertOwner, errors, type LearnerContext, resolveTimeZone, studyDay } from "../plt";
import { type CreateOptions, createOnce, iso, lockOrgAccount, requireReadyAccount } from "./common";
import { defaultCourse, getCourse, getUnit } from "./courses";
import {
  type CreateSessionInput,
  createSessionSchema,
  type SessionListInput,
  sessionListSchema,
  type UpdateSessionInput,
  updateSessionSchema,
} from "./schemas";

export interface ClassSession {
  id: string;
  ownerId: string;
  courseId: string;
  unitId: string | null;
  title: string | null;
  classDate: string;
  displayTitle: string;
  sourcesVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeletionRequest {
  id: string;
  sessionId: string;
  status: "pending" | "completed";
  requestedAt: string;
}

export function sessionDisplayTitle(title: string | null, classDate: string): string {
  if (title) return title;
  return `Session — ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${classDate}T00:00:00.000Z`))}`;
}

function session(row: Selectable<DB["org.class_session"]>): ClassSession {
  if (row.deleted_at !== null || row.course_id === null) throw errors.notFound();
  const classDate =
    row.class_date instanceof Date
      ? `${row.class_date.getFullYear()}-${String(row.class_date.getMonth() + 1).padStart(2, "0")}-${String(row.class_date.getDate()).padStart(2, "0")}`
      : String(row.class_date).slice(0, 10);
  return {
    id: row.id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    unitId: row.unit_id,
    title: row.title,
    classDate,
    displayTitle: sessionDisplayTitle(row.title, classDate),
    sourcesVersion: row.sources_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function getSession(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<ClassSession> {
  const row = await db
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return assertOwner(row ? session(row) : undefined, ctx);
}

/** Scoped bulk read for learning projections; foreign and deleted identifiers are omitted. */
export async function getSessionsByIds(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<ClassSession[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "in", unique)
    .where("owner_id", "=", ctx.userId)
    .where("deleted_at", "is", null)
    .execute();
  return rows.map(session);
}

/** SRC/PROC call within their transaction: deletion cannot race a publish or attachment. */
export async function assertSessionOwner(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<ClassSession> {
  const row = await db
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  return assertOwner(row ? session(row) : undefined, ctx);
}

/** An input snapshot counter, not a stored display/processing status (FR-ORG-005). */
export async function bumpSessionSourcesVersion(
  tx: Tx,
  ctx: LearnerContext,
  id: string,
  now: Date,
): Promise<number> {
  await assertSessionOwner(tx, ctx, id);
  const row = await tx
    .updateTable("org.class_session")
    .set((eb) => ({ sources_version: eb("sources_version", "+", 1), updated_at: now }))
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .returning("sources_version")
    .executeTakeFirstOrThrow();
  return row.sources_version;
}

async function validateDestination(
  tx: Tx,
  ctx: LearnerContext,
  courseId: string,
  unitId: string | null,
) {
  await getCourse(tx, ctx, courseId);
  if (unitId !== null) {
    const target = await getUnit(tx, ctx, unitId);
    if (target.courseId !== courseId)
      throw errors.validationFailed({ unitId: ["belongs_to_another_course"] });
  }
}

export async function createSession(
  db: Database,
  ctx: LearnerContext,
  input: CreateSessionInput,
  options: CreateOptions,
): Promise<ClassSession> {
  const parsed = createSessionSchema.parse(input);
  if (parsed.unitId && !parsed.courseId)
    throw errors.validationFailed({ unitId: ["course_required"] });
  return createOnce(db, ctx, "org.create_session", parsed, options, async (tx, now) => {
    const state = await requireReadyAccount(tx, ctx);
    const courseId = parsed.courseId ?? (await defaultCourse(tx, ctx, now)).id;
    const unitId = parsed.unitId ?? null;
    await validateDestination(tx, ctx, courseId, unitId);
    const classDate =
      parsed.classDate ?? studyDay(now, resolveTimeZone(state.timezone).timeZone, 0);
    return session(
      await tx
        .insertInto("org.class_session")
        .values({
          owner_id: ctx.userId,
          course_id: courseId,
          unit_id: unitId,
          title: parsed.title ?? null,
          class_date: classDate,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  });
}

export async function listSessions(
  db: Database | Tx,
  ctx: LearnerContext,
  input: SessionListInput = {},
): Promise<{ items: ClassSession[]; total: number }> {
  const parsed = sessionListSchema.parse(input);
  if (parsed.courseId) await getCourse(db, ctx, parsed.courseId);
  if (parsed.unitId) {
    const target = await getUnit(db, ctx, parsed.unitId);
    if (parsed.courseId && target.courseId !== parsed.courseId)
      throw errors.validationFailed({ unitId: ["belongs_to_another_course"] });
  }
  let query = db
    .selectFrom("org.class_session")
    .where("owner_id", "=", ctx.userId)
    .where("deleted_at", "is", null);
  if (parsed.courseId) query = query.where("course_id", "=", parsed.courseId);
  if (parsed.unitId !== undefined)
    query =
      parsed.unitId === null
        ? query.where("unit_id", "is", null)
        : query.where("unit_id", "=", parsed.unitId);
  const count = await query
    .select((eb) => eb.fn.countAll<string>().as("total"))
    .executeTakeFirstOrThrow();
  const rows = await query
    .selectAll()
    .orderBy("class_date", parsed.order === "oldest" ? "asc" : "desc")
    .orderBy("id", parsed.order === "oldest" ? "asc" : "desc")
    .limit(parsed.limit ?? 30)
    .offset(parsed.offset ?? 0)
    .execute();
  return { items: rows.map(session), total: Number(count.total) };
}

export async function updateSession(
  db: Database,
  ctx: LearnerContext,
  id: string,
  input: UpdateSessionInput,
  options: { now?: Date } = {},
): Promise<ClassSession> {
  const parsed = updateSessionSchema.parse(input);
  return db.transaction().execute(async (tx) => {
    await lockOrgAccount(tx, ctx);
    const existing = await assertSessionOwner(tx, ctx, id);
    const courseId = parsed.courseId ?? existing.courseId;
    // Changing course drops an omitted unit; keeping a unit requires an explicit valid choice.
    const unitId =
      parsed.unitId !== undefined
        ? parsed.unitId
        : courseId === existing.courseId
          ? existing.unitId
          : null;
    await validateDestination(tx, ctx, courseId, unitId);
    return session(
      await tx
        .updateTable("org.class_session")
        .set({
          title: parsed.title !== undefined ? parsed.title : existing.title,
          class_date: parsed.classDate ?? existing.classDate,
          course_id: courseId,
          unit_id: unitId,
          updated_at: options.now ?? new Date(),
        })
        .where("id", "=", id)
        .where("deleted_at", "is", null)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  });
}

/** Hook lets PROC/QUOTA coordinate cancellation through their own public APIs in this txn. */
export async function deleteSession(
  db: Database,
  ctx: LearnerContext,
  id: string,
  options: {
    now?: Date;
    onDelete?: (tx: Tx, sessionId: string, deletionRequestId: string) => Promise<void>;
  } = {},
): Promise<DeletionRequest> {
  return db.transaction().execute((tx) => deleteSessionInTransaction(tx, ctx, id, options));
}

export async function deleteSessionInTransaction(
  tx: Tx,
  ctx: LearnerContext,
  id: string,
  options: {
    now?: Date;
    onDelete?: (tx: Tx, sessionId: string, deletionRequestId: string) => Promise<void>;
  } = {},
): Promise<DeletionRequest> {
  await lockOrgAccount(tx, ctx);
  const row = await tx
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.owner_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  if (row.deleted_at !== null) {
    const receipt = await tx
      .selectFrom("org.deletion_request")
      .selectAll()
      .where("session_id", "=", id)
      .executeTakeFirstOrThrow();
    return deletionRequest(receipt);
  }
  const now = options.now ?? new Date();
  const deletionId = randomUUID();
  await tx
    .updateTable("org.class_session")
    .set({ deleted_at: now, deletion_request_id: deletionId, updated_at: now })
    .where("id", "=", id)
    .execute();
  const receipt = await tx
    .insertInto("org.deletion_request")
    .values({ id: deletionId, owner_id: ctx.userId, session_id: id, requested_at: now })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("org.outbox")
    .values({
      owner_id: ctx.userId,
      session_id: id,
      event_type: "session_deleted",
      deletion_request_id: deletionId,
      created_at: now,
    })
    .execute();
  await options.onDelete?.(tx, id, deletionId);
  return deletionRequest(receipt);
}

/** Offline recovery marker only: no authentication, outbox, storage or provider side effects. */
export async function tombstoneRestoredSession(
  tx: Tx,
  ctx: LearnerContext,
  id: string,
  now: Date,
): Promise<boolean> {
  const row = await tx
    .selectFrom("org.class_session")
    .select(["id", "owner_id", "deleted_at"])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return false;
  assertOwner({ ownerId: row.owner_id }, ctx);
  if (row.deleted_at) return true;
  const receiptId = randomUUID();
  await tx
    .insertInto("org.deletion_request")
    .values({ id: receiptId, owner_id: ctx.userId, session_id: id, requested_at: now })
    .execute();
  await tx
    .updateTable("org.class_session")
    .set({ deleted_at: now, deletion_request_id: receiptId, updated_at: now })
    .where("id", "=", id)
    .where("owner_id", "=", ctx.userId)
    .execute();
  return true;
}

function deletionRequest(row: Selectable<DB["org.deletion_request"]>): DeletionRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status as DeletionRequest["status"],
    requestedAt: iso(row.requested_at),
  };
}
