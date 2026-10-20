import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
import { assertSessionOwner } from "./sessions";

/**
 * D60 (owner decision 2026-10-12): while a learner records into a class, its sealed parts can be
 * registered and uploaded; automatic learning waits so no lesson is built from part of a class.
 * A lease, not a flag: a closed or frozen page stops renewing it. D105 (2026-10-20): neither Stop
 * nor a lapsed lease starts lesson work; that waits for the learner's Process this session, which
 * is refused while the lease is open.
 *
 * A capture renews its lease every few minutes.
 */
export const CAPTURE_LEASE_MS = 15 * 60 * 1000;

/** Opens or renews the capture lease; automatic learning waits while it is open. */
export async function renewCaptureLease(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<{ openUntil: Date }> {
  return db.transaction().execute(async (tx) => {
    await assertSessionOwner(tx, ctx, sessionId);
    const openUntil = new Date(now.getTime() + CAPTURE_LEASE_MS);
    await tx
      .updateTable("org.class_session")
      .set({ capture_open_until: openUntil })
      .where("id", "=", sessionId)
      .where("owner_id", "=", ctx.userId)
      .execute();
    return { openUntil };
  });
}
/** Stop ends the lease at once; Process this session need not wait for it to lapse. */
export async function releaseCaptureLease(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await assertSessionOwner(tx, ctx, sessionId);
    await tx
      .updateTable("org.class_session")
      .set({ capture_open_until: null })
      .where("id", "=", sessionId)
      .where("owner_id", "=", ctx.userId)
      .execute();
  });
}
export async function captureInProgress(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await db
    .selectFrom("org.class_session")
    .select("capture_open_until")
    .where("id", "=", sessionId)
    .where("owner_id", "=", ctx.userId)
    .executeTakeFirst();
  return !!row?.capture_open_until && row.capture_open_until > now;
}
