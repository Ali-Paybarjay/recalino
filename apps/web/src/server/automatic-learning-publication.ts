import "server-only";
import { synchronizeAutomaticCards } from "@recalino/core/card";
import type { Database } from "@recalino/core/db";
import { automaticPublishNotebook, getNotebook } from "@recalino/core/note";
import { AppError, enqueueJob, type LearnerContext, readPltSettings } from "@recalino/core/plt";
import {
  getAutomaticLearningSession,
  getRun,
  listRuns,
  type ProcessingRun,
  processingSelectionFingerprint,
  selectProcessingSourceSnapshot,
  sourceSnapshotSchema,
  updateAutomaticLearningProgress,
} from "@recalino/core/proc";
import { sessionSources } from "@recalino/core/src";
import { automaticLearningQueue } from "./automatic-learning-queue";

export async function publishAutomaticOutput(
  db: Database,
  ctx: LearnerContext,
  run: ProcessingRun,
  now: Date,
) {
  if (!run.outputVersionId) return;
  await automaticPublishNotebook(db, ctx, run.sessionId, run.outputVersionId, {
    key: `automatic-notes:${run.outputVersionId}`,
    now,
  });
  const notebook = await getNotebook(db, ctx, run.sessionId);
  if (notebook)
    await synchronizeAutomaticCards(db, ctx, run.sessionId, {
      key: `automatic-cards:${notebook.current.id}`,
      now,
    });
}
/** Complete deterministic publication after a run, including a replay after its output committed. */
export async function finalizeAutomaticRun(
  db: Database,
  ctx: LearnerContext,
  runId: string,
  now = new Date(),
) {
  const run = await getRun(db, ctx, runId);
  if (["queued", "processing", "awaiting_upload"].includes(run.state)) return;
  const intent = await getAutomaticLearningSession(db, ctx, run.sessionId);
  if (!intent) return;
  const newest = (await listRuns(db, ctx, run.sessionId))[0];
  if (newest && newest.id !== run.id) return;
  const complete = ["ready", "partial_ready"].includes(run.state) && !!run.outputVersionId;
  if (complete) await publishAutomaticOutput(db, ctx, run, now);
  if (intent.batchId) return;
  let sameSelection = false;
  try {
    const snapshot = sourceSnapshotSchema.parse(
      await selectProcessingSourceSnapshot(db, ctx, run.sessionId),
    );
    const materials = await sessionSources(db, ctx, run.sessionId);
    const pendingUploads = materials.some(
      (source) => source.selected && ["pending", "verifying"].includes(source.uploadState ?? ""),
    );
    sameSelection =
      !pendingUploads && processingSelectionFingerprint(snapshot) === run.selectionFingerprint;
  } catch (failure) {
    if (!(failure instanceof AppError && failure.code === "validation_failed")) throw failure;
  }
  await updateAutomaticLearningProgress(
    db,
    ctx,
    run.sessionId,
    intent.requestVersion,
    {
      state: sameSelection ? (complete ? "ready" : "blocked") : "waiting_sources",
      lastError: sameSelection && !complete ? (run.lastError ?? "processing_failed") : null,
      runId: run.id,
    },
    now,
  );
  if (!sameSelection)
    await db.transaction().execute((tx) =>
      enqueueJob(tx, automaticLearningQueue, {
        payload: {
          sessionId: run.sessionId,
          userId: ctx.userId,
          requestVersion: intent.requestVersion,
        },
        singletonKey: `after:${run.id}:${intent.requestVersion}`,
        now,
        defaults: readPltSettings().jobs,
      }),
    );
}
