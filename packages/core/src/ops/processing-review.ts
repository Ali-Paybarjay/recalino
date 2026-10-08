import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database } from "../db";
import { getSession } from "../org";
import { canonicalJson, type LearnerContext, recordAudit, runIdempotent, sha256Hex } from "../plt";
import { processingReviewTarget, readClassProcessingReview } from "../proc";
import { updateAdminTask } from "./admin-operations";

/** Reopen the existing class-run task once. No support message, allowance or AI call is created. */
export async function requestClassProcessingReview(
  db: Database,
  ctx: LearnerContext,
  input: { sessionId: string; runId: string; requestId: string },
) {
  z.uuid().parse(input.sessionId);
  z.uuid().parse(input.runId);
  z.string().min(8).max(200).parse(input.requestId);
  await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: input.requestId,
      route: `/classes/${input.sessionId}/processing-review`,
      requestHash: sha256Hex(canonicalJson({ sessionId: input.sessionId, runId: input.runId })),
      ttlSeconds: 86400,
      beforeKey: async (tx) => {
        await lockAccount(tx, ctx.userId);
        await getSession(tx, ctx, input.sessionId);
      },
    },
    async (tx) => {
      const review = await processingReviewTarget(tx, ctx, input.sessionId, input.runId);
      if (review.canRequest) {
        await updateAdminTask(tx, {
          taskId: `run:${review.runId}`,
          state: "open",
          reason: "Learner requested review of this class's stopped processing.",
        });
        await recordAudit(tx, {
          actorKind: "learner",
          actorId: ctx.userId,
          action: "processing.review_requested",
          subjectType: "processing_run",
          subjectId: review.runId,
          reason: review.errorCode ?? "processing_failed",
          requestId: input.requestId,
        });
      }
      return { status: 200, body: { ok: true } };
    },
  );
  return readClassProcessingReview(db, ctx, input.sessionId);
}
