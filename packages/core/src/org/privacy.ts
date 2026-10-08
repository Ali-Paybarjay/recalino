import { sql } from "kysely";
import { accountExists, lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import { assertOwner, errors, type LearnerContext } from "../plt";

async function redactSessions(tx: Tx, ctx: LearnerContext, now: Date, sessionId?: string) {
  await tx
    .updateTable("org.class_session")
    .set({
      title: null,
      // PRD-DEL-01: the required date becomes a fixed nonpersonal value in the retained tombstone.
      class_date: sql<Date>`date '1970-01-01'`,
      course_id: null,
      unit_id: null,
      updated_at: now,
    })
    .where("owner_id", "=", ctx.userId)
    .where("deleted_at", "is not", null)
    .$if(sessionId !== undefined, (qb) => qb.where("id", "=", sessionId ?? ""))
    .execute();
}

/** PRIV invokes this after the tombstone and private-link grace period; receipts stay replayable. */
export async function cleanupSessionOrg(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const row = await tx
      .selectFrom("org.class_session")
      .select(["owner_id", "deleted_at"])
      .where("id", "=", sessionId)
      .executeTakeFirst();
    assertOwner(row ? { ownerId: row.owner_id } : undefined, ctx);
    if (!row?.deleted_at) throw errors.conflict();
    await redactSessions(tx, ctx, now, sessionId);
  });
}

/** Keep only session/receipt identifiers needed by deletion and accounting, without course names. */
export async function cleanupAccountOrg(
  db: Database,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    if (!(await lockAccountForCleanup(tx, ctx.userId))) return;
    if (await accountExists(tx, ctx.userId)) throw errors.conflict();
    const live = await tx
      .selectFrom("org.class_session")
      .select("id")
      .where("owner_id", "=", ctx.userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (live) throw errors.conflict();
    await redactSessions(tx, ctx, now);
    await tx.deleteFrom("org.unit").where("owner_id", "=", ctx.userId).execute();
    await tx.deleteFrom("org.course").where("owner_id", "=", ctx.userId).execute();
  });
}
