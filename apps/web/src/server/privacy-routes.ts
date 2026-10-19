import "server-only";
import { AppError } from "@recalino/core/plt";
import {
  getPrivacyDeletionRequest,
  persistDeletionJournal,
  requestAccountDeletion,
} from "@recalino/core/priv";
import { z } from "zod";
import { type Handler, idempotencyKey, learnerActor } from "./api";
import { runJobsSoon } from "./jobs";
import { privacyDependencies } from "./privacy";
export function accountDeletionHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    const actor = learnerActor(ctx);
    const fields = z.strictObject({ confirm: z.literal("DELETE") }).parse(input);
    void fields;
    const key = idempotencyKey(request);
    const dependencies = privacyDependencies();
    const result = await requestAccountDeletion(db, actor, key, dependencies);
    try {
      await persistDeletionJournal(db, actor, result.id, dependencies);
    } catch {
      throw new AppError("internal", {
        details: {
          deletion: {
            requestId: result.id,
            kind: "account",
            state: "acknowledgement_pending",
          },
        },
      });
    }
    runJobsSoon(["priv.cleanup"], 90);
    return { status: 202, body: result };
  };
}
export function privacyRequestHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = learnerActor(ctx);
    return {
      body: await getPrivacyDeletionRequest(db, learner, z.uuid().parse(id)),
    };
  };
}
