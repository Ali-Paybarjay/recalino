import "server-only";
import { allowance } from "@recalino/core/quota";
import { type Handler, learnerActor } from "./api";

export function quotaHandler(now: () => Date = () => new Date()): Handler {
  return async ({ db, ctx }) => {
    return { body: await allowance(db, learnerActor(ctx), now()) };
  };
}
