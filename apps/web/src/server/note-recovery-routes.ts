import "server-only";
import { errors } from "@recalino/core/plt";
import { prepareSourceExtractionRetry, sourceExtractionRetrySchema } from "@recalino/core/proc";
import { z } from "zod";
import type { Handler } from "./api";

/** Preparing a retry keeps the standard estimate/confirmation flow and does not start AI work. */
export function noteSourceRecoveryHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    z.uuid().parse(sessionId);
    if (!ctx.userId) throw errors.unauthenticated();
    const key = request.headers.get("idempotency-key");
    if (!key) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const result = await prepareSourceExtractionRetry(
      db,
      { userId: ctx.userId, requestId: ctx.requestId },
      sessionId,
      sourceExtractionRetrySchema.parse(input),
      { key },
    );
    return { body: { ...result, next: `/classes/${sessionId}/estimate` } };
  };
}
