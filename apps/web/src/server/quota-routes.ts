import "server-only";
import { errors } from "@recalino/core/plt";
import { allowance } from "@recalino/core/quota";
import type { Handler } from "./api";

export function quotaHandler(now: () => Date = () => new Date()): Handler {
  return async ({ db, ctx }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    return { body: await allowance(db, { userId: ctx.userId, requestId: ctx.requestId }, now()) };
  };
}
