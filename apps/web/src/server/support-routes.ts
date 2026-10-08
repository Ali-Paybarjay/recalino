import "server-only";
import { errors } from "@recalino/core/plt";
import {
  addFeedbackMessage,
  getFeedbackThread,
  listFeedback,
  submitFeedback,
} from "@recalino/core/support";
import type { Handler } from "./api";

function key(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return value;
}
export function supportFeedbackHandler(): Handler {
  return async ({ db, ctx, input, request }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    const actor = { userId: ctx.userId, requestId: ctx.requestId };
    if (request.method === "GET") return { body: await listFeedback(db, actor) };
    return {
      status: 201,
      body: await submitFeedback(db, actor, {
        ...(input as Parameters<typeof submitFeedback>[2]),
        operationKey: key(request),
      }),
    };
  };
}
export function supportThreadHandler(id: string): Handler {
  return async ({ db, ctx, input, request }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    const actor = { userId: ctx.userId, requestId: ctx.requestId };
    if (request.method === "GET") return { body: await getFeedbackThread(db, actor, id) };
    return {
      status: 201,
      body: await addFeedbackMessage(db, actor, id, {
        ...(input as Parameters<typeof addFeedbackMessage>[3]),
        operationKey: key(request),
      }),
    };
  };
}
