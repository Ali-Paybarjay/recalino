import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
/** Review rows contain no note/card text and cascade when their tombstoned card is purged. */
export async function tombstoneSessionSrs(
  _tx: Tx,
  _ctx: LearnerContext,
  _sessionId: string,
): Promise<void> {}
export async function tombstoneAccountSrs(_tx: Tx, _ctx: LearnerContext): Promise<void> {}
export async function cleanupSessionSrs(
  _db: Database,
  _ctx: LearnerContext,
  _sessionId: string,
): Promise<void> {}
export async function cleanupAccountSrs(db: Database, ctx: LearnerContext): Promise<void> {
  await db.deleteFrom("srs.settings").where("user_id", "=", ctx.userId).execute();
}
