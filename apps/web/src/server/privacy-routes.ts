import "server-only";
import { AppError, errors } from "@recalino/core/plt";
import {
  getPrivacyDeletionRequest,
  persistDeletionJournal,
  requestAccountDeletion,
} from "@recalino/core/priv";
import { z } from "zod";
import type { Handler } from "./api";
import { runJobsSoon } from "./jobs";
import { privacyDependencies } from "./privacy";
export function accountDeletionHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    const fields = z.strictObject({ confirm: z.literal("DELETE") }).parse(input);
    void fields;
    const key = request.headers.get("idempotency-key");
    if (!key) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const dependencies = privacyDependencies();
    const actor = { userId: ctx.userId, requestId: ctx.requestId };
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
    if (!ctx.userId) throw errors.unauthenticated();
    return {
      body: await getPrivacyDeletionRequest(
        db,
        { userId: ctx.userId, requestId: ctx.requestId },
        z.uuid().parse(id),
      ),
    };
  };
}
