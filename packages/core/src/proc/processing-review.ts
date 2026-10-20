import type { Database, Tx } from "../db";
import { getSession } from "../org";
import { errors, type LearnerContext, latestSubjectAudit, latestSubjectAudits } from "../plt";
import { type AutomaticLearningSession, getAutomaticLearningSession } from "./automatic-state";
import { listRuns, type ProcessingRun } from "./runs";

/** Only owned class runs are used; voice and other auxiliary work never completes a review. */
export interface ProcessingReview {
  state: "not_requested" | "awaiting_review" | "retrying" | "resolved";
  runId: string;
  requestedRunId: string | null;
  requestedAt: string | null;
  updatedAt: string;
  errorCode: string | null;
  canRequest: boolean;
  partialResult?: boolean;
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
    ...reviewRequests(ctx),
    subjectIds: runs.map((run) => run.id),
  });
  return classProcessingReview(latest, intent, request);
}

/** The learner's review requests, an audit of their class runs. */
function reviewRequests(ctx: LearnerContext) {
  return {
    actorKind: "learner",
    actorId: ctx.userId,
    action: "processing.review_requested",
    subjectType: "processing_run",
  } as const;
}

/**
 * PERF-04: readClassProcessingReview for many classes the caller found live, from their newest
 * class runs (listClassRunsBySession) and intents, with one read of the review requests.
 */
export async function readClassProcessingReviews(
  db: Database | Tx,
  ctx: LearnerContext,
  input: {
    runs: ReadonlyMap<string, readonly ProcessingRun[]>;
    intents: ReadonlyMap<string, AutomaticLearningSession>;
  },
): Promise<Map<string, ProcessingReview | null>> {
  const groups = new Map(
    [...input.runs].flatMap(([sessionId, runs]) =>
      runs.length ? [[sessionId, runs.map((run) => run.id)] as const] : [],
    ),
  );
  const requests = await latestSubjectAudits(db, { ...reviewRequests(ctx), groups });
  return new Map(
    [...input.runs].map(([sessionId, runs]) => {
      const latest = runs[0];
      return [
        sessionId,
        latest
          ? classProcessingReview(
              latest,
              input.intents.get(sessionId) ?? null,
              requests.get(sessionId) ?? null,
            )
          : null,
      ];
    }),
  );
}

/** Pure: a class's review from its newest class run, its intent and the latest request. */
function classProcessingReview(
  latest: ProcessingRun,
  intent: AutomaticLearningSession | null,
  request: { subjectId: string; occurredAt: string } | null,
): ProcessingReview | null {
  const failed = ["failed", "needs_input", "partial_ready"].includes(latest.state);
  if (!request && !failed && intent?.state !== "blocked") return null;
  const continuing = ["queued", "processing", "awaiting_upload"].includes(latest.state);
  const partialResult = latest.state === "partial_ready";
  // Partial source coverage remains historical. A review completes only after its
  // current output has been published by automatic learning, not merely generated.
  const resolved =
    (latest.state === "ready" || partialResult) &&
    !!latest.outputVersionId &&
    ((!intent && !partialResult) || (intent?.state === "ready" && intent.runId === latest.id));
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
    canRequest: failed && !resolved && request?.subjectId !== latest.id,
    partialResult,
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
