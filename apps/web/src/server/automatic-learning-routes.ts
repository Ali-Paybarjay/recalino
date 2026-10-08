import "server-only";
import { errors, isValidIdempotencyKey, type LearnerContext } from "@recalino/core/plt";
import {
  beginAutomaticLearningBatch,
  cancelAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  registerAutomaticLearningFile,
  skipAutomaticLearningFile,
} from "@recalino/core/proc";
import { z } from "zod";
import type { Handler } from "./api";
import {
  automaticLearningSync,
  readAutomaticLearning,
  scheduleAutomaticLearning,
} from "./automatic-learning";
import { runJobsSoon } from "./jobs";

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
  z.strictObject({ action: z.literal("retry") }),
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
    if (!ctx.userId) throw errors.unauthenticated();
    const learner: LearnerContext = { userId: ctx.userId, requestId: ctx.requestId };
    if (request.method === "GET") return { body: await deps.read(db, learner, sessionId) };
    const fields = actions.parse(input);
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
        90,
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
        90,
      );
      return { status: 202, body };
    }
    const retryKey = fields.action === "retry" ? request.headers.get("idempotency-key") : null;
    if (fields.action === "retry" && (!retryKey || !isValidIdempotencyKey(retryKey)))
      throw errors.validationFailed({ "Idempotency-Key": [retryKey ? "invalid" : "required"] });
    const body = await deps.sync(db, learner, sessionId, retryKey ? { retryKey } : {});
    deps.wake(
      ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
      90,
    );
    return { status: 202, body };
  };
}
