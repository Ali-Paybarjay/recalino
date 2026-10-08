import type { Database, Tx } from "../db";
import { getSession } from "../org";
import { errors, type LearnerContext, latestSubjectAudit } from "../plt";
import { getAutomaticLearningSession } from "./automatic-state";
import { listRuns } from "./runs";

/** Only owned class runs are used; voice and other auxiliary work never completes a review. */
export interface ProcessingReview {
  state: "not_requested" | "awaiting_review" | "retrying" | "resolved";
  runId: string;
  requestedRunId: string | null;
  requestedAt: string | null;
  updatedAt: string;
  errorCode: string | null;
  canRequest: boolean;
}

export async function readClassProcessingReview(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<ProcessingReview | null> {
  await getSession(db, ctx, sessionId);
  const [runs, intent] = await Promise.all([
    listRuns(db, ctx, sessionId),
    getAutomaticLearningSession(db, ctx, sessionId),
  ]);
  const latest = runs[0];
  if (!latest) return null;
  const request = await latestSubjectAudit(db, {
    actorKind: "learner",
    actorId: ctx.userId,
    action: "processing.review_requested",
    subjectType: "processing_run",
    subjectIds: runs.map((run) => run.id),
  });
  const failed = ["failed", "needs_input", "partial_ready"].includes(latest.state);
  if (!request && !failed && intent?.state !== "blocked") return null;
  const continuing = ["queued", "processing", "awaiting_upload"].includes(latest.state);
  const resolved =
    latest.state === "ready" &&
    !!latest.outputVersionId &&
    (!intent || (intent.state === "ready" && intent.runId === latest.id));
  const code = intent?.state === "blocked" ? intent.lastError : latest.lastError;
  return {
    state: resolved
      ? "resolved"
      : continuing
        ? "retrying"
        : request
          ? "awaiting_review"
          : "not_requested",
    runId: latest.id,
    requestedRunId: request?.subjectId ?? null,
    requestedAt: request?.occurredAt ?? null,
    updatedAt: latest.updatedAt,
    errorCode: code && /^[a-zA-Z0-9_.:-]{1,200}$/.test(code) ? code : null,
    canRequest: failed && request?.subjectId !== latest.id,
  };
}

/** Bind an explicit request to the current failed class run, never a caller-selected other run. */
export async function processingReviewTarget(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  runId: string,
) {
  const review = await readClassProcessingReview(db, ctx, sessionId);
  if (!review || review.runId !== runId || ["retrying", "resolved"].includes(review.state))
    throw errors.conflict();
  return review;
}
