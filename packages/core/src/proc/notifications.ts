import { lockAccount } from "../acc";
import type { Database } from "../db";
import { getSession } from "../org";
import { AppError, errors, type LearnerContext, recordLearnerNotification } from "../plt";
import { ownedRun } from "./runs";

const TERMINAL_STATES = ["ready", "partial_ready", "failed", "needs_input"] as const;

export async function recordProcessingNotification(
  db: Database,
  ctx: LearnerContext,
  runId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, runId, true);
    if (
      run.kind !== "class" ||
      run.notification_recorded_at ||
      !TERMINAL_STATES.includes(run.state as (typeof TERMINAL_STATES)[number])
    )
      return;
    await getSession(tx, ctx, run.session_id);
    const newest = await tx
      .selectFrom("proc.processing_run")
      .select("id")
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", run.session_id)
      .where("kind", "=", "class")
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (newest && newest.id !== run.id) {
      await tx
        .updateTable("proc.processing_run")
        .set({ notification_recorded_at: now })
        .where("id", "=", run.id)
        .where("user_id", "=", ctx.userId)
        .execute();
      return;
    }
    const complete = ["ready", "partial_ready"].includes(run.state) && !!run.output_version_id;
    if (["ready", "partial_ready"].includes(run.state) && !complete) throw errors.conflict();
    await recordLearnerNotification(
      tx,
      ctx,
      {
        deduplicationKey: run.output_version_id
          ? `processing:output:${run.output_version_id}`
          : `processing:run:${run.id}:${run.state}`,
        kind: complete
          ? run.state === "ready"
            ? "processing_ready"
            : "processing_partial"
          : "processing_failed",
        href: `/classes/${run.session_id}/${complete ? "notes" : "processing"}`,
      },
      now,
    );
    await tx
      .updateTable("proc.processing_run")
      .set({ notification_recorded_at: now })
      .where("id", "=", run.id)
      .where("user_id", "=", ctx.userId)
      .execute();
  });
}

/** Cron repairs the crash window between committed processing output and its completion hook. */
export async function reconcileProcessingNotifications(
  db: Database,
  now = new Date(),
  options: {
    beforeRecord?: (ctx: LearnerContext, runId: string) => Promise<void>;
    userId?: string;
    limit?: number;
    deadline?: Date;
  } = {},
): Promise<number> {
  const requested = options.limit ?? 25;
  if (!Number.isInteger(requested) || requested < 1)
    throw new RangeError("Invalid notification recovery limit");
  const deadline = options.deadline ?? new Date(Date.now() + 8000);
  const runs = await db
    .selectFrom("proc.processing_run")
    .select(["id", "user_id"])
    .where("kind", "=", "class")
    .where("state", "in", TERMINAL_STATES)
    .where("notification_recorded_at", "is", null)
    .$if(!!options.userId, (query) => query.where("user_id", "=", options.userId as string))
    .orderBy("updated_at")
    .limit(Math.min(250, requested))
    .execute();
  let failure: unknown;
  let attempted = 0;
  for (const run of runs) {
    if (new Date() >= deadline) break;
    attempted++;
    try {
      const ctx = { userId: run.user_id, requestId: `notification:${run.id}` };
      await options.beforeRecord?.(ctx, run.id);
      await recordProcessingNotification(db, ctx, run.id, now);
    } catch (error) {
      if (!(error instanceof AppError && error.code === "not_found")) {
        // One publication failure must not keep every other learner's result out of the inbox.
        failure ??= error;
        // Creation time remains the authoritative newest-run fence. Advance recovery order only.
        await db
          .updateTable("proc.processing_run")
          .set({ updated_at: now })
          .where("id", "=", run.id)
          .where("user_id", "=", run.user_id)
          .where("notification_recorded_at", "is", null)
          .execute();
        continue;
      }
      // Deleted accounts and classes must not be resurrected by an old queued completion.
      await db
        .updateTable("proc.processing_run")
        .set({ notification_recorded_at: now })
        .where("id", "=", run.id)
        .where("user_id", "=", run.user_id)
        .execute();
    }
  }
  if (failure) throw failure;
  return attempted;
}
