import "server-only";
import type { Database } from "@recalino/core/db";
import { AppError, createLogger, type LearnerContext } from "@recalino/core/plt";
import { getAutomaticLearningSession, getRun } from "@recalino/core/proc";
import { uploadSessionIds, verifiedUploadSessionIds } from "@recalino/core/src";
import { scheduleAutomaticLearning } from "./automatic-learning";

function logFailure(ctx: LearnerContext): void {
  createLogger()("error", "automatic_learning_notification_failed", {
    request_id: ctx.requestId,
    user_id: ctx.userId,
    code: "automatic_learning_notification_failed",
  });
}

/** A successful source mutation must not become a failed HTTP write because a wake-up failed. */
export async function notifyAutomaticLearning(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  changed = true,
): Promise<void> {
  try {
    // Old queued uploads do not silently opt an existing class into paid automatic processing.
    if (!changed && !(await getAutomaticLearningSession(db, ctx, sessionId))) return;
    await scheduleAutomaticLearning(db, ctx, sessionId, { changed });
  } catch {
    logFailure(ctx);
  }
}

/** Optional wake-up queries cannot change a committed verification into a failed upload. */
export async function notifyAutomaticLearningForVerifiedUpload(
  db: Database,
  ctx: LearnerContext,
  uploadId: string,
): Promise<void> {
  try {
    const sessionIds = await verifiedUploadSessionIds(db, ctx, uploadId);
    for (const sessionId of sessionIds) await notifyAutomaticLearning(db, ctx, sessionId, false);
  } catch {
    logFailure(ctx);
  }
}

/** A durable part receipt or rejection recovers declared batches without changing an HTTP outcome. */
export async function notifyAutomaticLearningForUpload(
  db: Database,
  ctx: LearnerContext,
  uploadId: string,
): Promise<void> {
  try {
    for (const sessionId of await uploadSessionIds(db, ctx, uploadId))
      await notifyAutomaticLearning(db, ctx, sessionId, false);
  } catch {
    logFailure(ctx);
  }
}

export async function notifyAutomaticLearningForRun(
  db: Database,
  ctx: LearnerContext,
  runId: string,
): Promise<void> {
  try {
    const run = await getRun(db, ctx, runId);
    await notifyAutomaticLearning(db, ctx, run.sessionId, false);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return;
    logFailure(ctx);
  }
}
