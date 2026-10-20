import "server-only";
import { requestClassProcessingReview } from "@recalino/core/ops";
import {
  beginAutomaticLearningBatch,
  cancelAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  foregroundGapSchema,
  recordForegroundGap,
  registerAutomaticLearningFile,
  requestAutomaticProcessing,
  skipAutomaticLearningFile,
} from "@recalino/core/proc";
import { z } from "zod";
import { type Handler, idempotencyKey, learnerActor } from "./api";
import {
  automaticLearningSync,
  readAutomaticLearning,
  scheduleAutomaticLearning,
} from "./automatic-learning";
import { PROCESSING_WAKE, runJobsSoon } from "./jobs";

const actions = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("begin"),
    batchId: z.uuid(),
    expectedFileIds: z.array(z.uuid()).min(1).max(250).optional(),
  }),
  z.strictObject({
    action: z.literal("register_file"),
    batchId: z.uuid(),
    fileId: z.uuid(),
    sourceId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("skip_file"), batchId: z.uuid(), fileId: z.uuid() }),
  z.strictObject({ action: z.literal("cancel_batch"), batchId: z.uuid() }),
  z.strictObject({ action: z.literal("complete"), batchId: z.uuid() }),
  z.strictObject({ action: z.literal("sync") }),
  // D105: the learner's "Process this session"; the only action that starts lesson work. The
  // revision is the status revision the learner confirmed (0 before the class has any intent).
  z.strictObject({ action: z.literal("process"), revision: z.int().nonnegative() }),
  z.strictObject({ action: z.literal("retry") }),
  z.strictObject({ action: z.literal("request_review"), runId: z.uuid() }),
  // NFR-07 (D71): an interval this device's page was hidden while the class was in progress.
  z.strictObject({ action: z.literal("foreground_gap"), ...foregroundGapSchema.shape }),
]);
interface Dependencies {
  read: typeof readAutomaticLearning;
  sync: typeof automaticLearningSync;
  wake: typeof runJobsSoon;
}
/** Learner requests express durable intent; provider work remains with the existing queue. */
export function automaticLearningHandler(
  sessionId: string,
  overrides: Partial<Dependencies> = {},
): Handler {
  const deps = {
    read: readAutomaticLearning,
    sync: automaticLearningSync,
    wake: runJobsSoon,
    ...overrides,
  };
  return async ({ db, ctx, request, input }) => {
    z.uuid().parse(sessionId);
    const learner = learnerActor(ctx);
    if (request.method === "GET") return { body: await deps.read(db, learner, sessionId) };
    const fields = actions.parse(input);
    if (fields.action === "request_review") {
      const requestId = idempotencyKey(request);
      await requestClassProcessingReview(db, learner, {
        sessionId,
        runId: fields.runId,
        requestId,
      });
      return { body: await deps.read(db, learner, sessionId) };
    }
    if (fields.action === "foreground_gap") {
      const { action: _action, ...gap } = fields;
      const recorded = await recordForegroundGap(db, learner, sessionId, gap);
      return { status: 202, body: { recorded } };
    }
    if (fields.action === "begin") {
      await beginAutomaticLearningBatch(
        db,
        learner,
        sessionId,
        fields.batchId,
        new Date(),
        fields.expectedFileIds,
      );
      return { body: await deps.read(db, learner, sessionId) };
    }
    if (fields.action === "register_file" || fields.action === "skip_file") {
      if (fields.action === "register_file")
        await registerAutomaticLearningFile(db, learner, sessionId, {
          batchId: fields.batchId,
          fileId: fields.fileId,
          sourceId: fields.sourceId,
        });
      else
        await skipAutomaticLearningFile(db, learner, sessionId, {
          batchId: fields.batchId,
          fileId: fields.fileId,
        });
      await scheduleAutomaticLearning(db, learner, sessionId, { changed: false });
      deps.wake(
        ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
        PROCESSING_WAKE.budgetSeconds,
        PROCESSING_WAKE.functionSeconds,
      );
      return { status: 202, body: await deps.read(db, learner, sessionId) };
    }
    if (fields.action === "cancel_batch") {
      await cancelAutomaticLearningBatch(db, learner, sessionId, fields.batchId);
      return { body: await deps.read(db, learner, sessionId) };
    }
    if (fields.action === "complete") {
      await completeAutomaticLearningBatch(db, learner, sessionId, fields.batchId);
      const body = await deps.sync(db, learner, sessionId, {});
      deps.wake(
        ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
        PROCESSING_WAKE.budgetSeconds,
        PROCESSING_WAKE.functionSeconds,
      );
      return { status: 202, body };
    }
    if (fields.action === "process") {
      // A replay, or a press after other material arrived, names a revision that is no longer
      // current and is refused; a press on the already requested revision has no second effect.
      idempotencyKey(request);
      await requestAutomaticProcessing(db, learner, sessionId, new Date(), fields.revision);
    }
    const retryKey = fields.action === "retry" ? idempotencyKey(request) : null;
    const body = await deps.sync(db, learner, sessionId, retryKey ? { retryKey } : {});
    deps.wake(
      ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
      PROCESSING_WAKE.budgetSeconds,
      PROCESSING_WAKE.functionSeconds,
    );
    return { status: 202, body };
  };
}
