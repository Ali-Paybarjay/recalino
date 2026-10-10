import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";

/** Feedback names only owned goal ids; tombstoned cards already hide it from every read. */
export async function tombstoneSessionPers(
  _tx: Tx,
  _ctx: LearnerContext,
  _sessionId: string,
): Promise<void> {}
export async function tombstoneAccountPers(_tx: Tx, _ctx: LearnerContext): Promise<void> {}
export async function cleanupSessionPers(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db
    .deleteFrom("pers.item_feedback")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .execute();
}
export async function cleanupAccountPers(db: Database, ctx: LearnerContext): Promise<void> {
  await db.deleteFrom("pers.item_feedback").where("user_id", "=", ctx.userId).execute();
}
