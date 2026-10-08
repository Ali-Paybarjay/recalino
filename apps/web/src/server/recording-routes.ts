import "server-only";
import { errors } from "@recalino/core/plt";
import { createRecordedSource } from "@recalino/core/src";
import type { Handler } from "./api";
export function recordingSourceHandler(): Handler {
  return async ({ db, ctx, input, request }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    const operationKey = request.headers.get("idempotency-key");
    if (!operationKey) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const result = await createRecordedSource(
      db,
      { userId: ctx.userId, requestId: ctx.requestId },
      { ...(input as Record<string, unknown>), operationKey },
    );
    return { status: 201, body: result };
  };
}
