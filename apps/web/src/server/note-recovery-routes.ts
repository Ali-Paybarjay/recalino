import "server-only";
import { prepareSourceExtractionRetry, sourceExtractionRetrySchema } from "@recalino/core/proc";
import { z } from "zod";
import { type Handler, idempotencyKey, learnerActor } from "./api";

/** Preparing a retry keeps the standard estimate/confirmation flow and does not start AI work. */
export function noteSourceRecoveryHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    z.uuid().parse(sessionId);
    const learner = learnerActor(ctx);
    const key = idempotencyKey(request);
    const result = await prepareSourceExtractionRetry(
      db,
      learner,
      sessionId,
      sourceExtractionRetrySchema.parse(input),
      { key },
    );
    return { body: { ...result, next: `/sessions/${sessionId}/estimate` } };
  };
}
