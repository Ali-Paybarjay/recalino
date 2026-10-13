import { z } from "zod";
import type { Database, Tx } from "../db";
import { assertSessionOwner } from "../org";
import { errors, type LearnerContext } from "../plt";

/** The longest hidden interval a device may report, and how far in the past it may start. */
export const FOREGROUND_GAP_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export const foregroundGapSchema = z.strictObject({
  hiddenAt: z.iso.datetime({ offset: true }),
  visibleAt: z.iso.datetime({ offset: true }),
});
export interface ForegroundGap {
  hiddenAt: Date;
  visibleAt: Date;
}

/**
 * NFR-07 (owner decision 2026-10-13, D71): a device reports an interval its page was hidden
 * while this class had work in progress, so the operator report can separate the service's
 * time from time the device could not upload (D47). Times only; idempotent per start time.
 * Returns whether a new interval was stored.
 */
export async function recordForegroundGap(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  raw: unknown,
  now = new Date(),
): Promise<boolean> {
  const input = foregroundGapSchema.parse(raw);
  const hiddenAt = new Date(input.hiddenAt);
  const visibleAt = new Date(input.visibleAt);
  if (
    visibleAt < hiddenAt ||
    visibleAt.getTime() - hiddenAt.getTime() > FOREGROUND_GAP_MAX_MS ||
    hiddenAt.getTime() < now.getTime() - FOREGROUND_GAP_MAX_MS ||
    visibleAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS
  )
    throw errors.validationFailed({ gap: ["out_of_range"] });
  await assertSessionOwner(db, ctx, z.uuid().parse(sessionId));
  const inserted = await db
    .insertInto("proc.foreground_gap")
    .values({
      user_id: ctx.userId,
      session_id: sessionId,
      hidden_at: hiddenAt,
      visible_at: visibleAt,
      created_at: now,
    })
    .onConflict((oc) => oc.columns(["user_id", "session_id", "hidden_at"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted !== undefined;
}

/** Operator report: hidden intervals reported for the given classes, by class and learner. */
export async function foregroundGaps(
  db: Database | Tx,
  sessionIds: readonly string[],
): Promise<(ForegroundGap & { sessionId: string; userId: string })[]> {
  if (!sessionIds.length) return [];
  return db
    .selectFrom("proc.foreground_gap")
    .select([
      "session_id as sessionId",
      "user_id as userId",
      "hidden_at as hiddenAt",
      "visible_at as visibleAt",
    ])
    .where("session_id", "in", [...sessionIds])
    .orderBy("hidden_at")
    .execute();
}
