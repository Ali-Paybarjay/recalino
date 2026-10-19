import "server-only";
import {
  addFeedbackMessage,
  getFeedbackThread,
  listFeedback,
  submitFeedback,
} from "@recalino/core/support";
import { type Handler, idempotencyKey, learnerActor } from "./api";

export function supportFeedbackHandler(): Handler {
  return async ({ db, ctx, input, request }) => {
    const actor = learnerActor(ctx);
    if (request.method === "GET") return { body: await listFeedback(db, actor) };
    return {
      status: 201,
      body: await submitFeedback(db, actor, {
        ...(input as Parameters<typeof submitFeedback>[2]),
        operationKey: idempotencyKey(request),
      }),
    };
  };
}
export function supportThreadHandler(id: string): Handler {
  return async ({ db, ctx, input, request }) => {
    const actor = learnerActor(ctx);
    if (request.method === "GET") return { body: await getFeedbackThread(db, actor, id) };
    return {
      status: 201,
      body: await addFeedbackMessage(db, actor, id, {
        ...(input as Parameters<typeof addFeedbackMessage>[3]),
        operationKey: idempotencyKey(request),
      }),
    };
  };
}
