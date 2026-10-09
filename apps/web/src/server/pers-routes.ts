import "server-only";
import {
  changeLearningPreferences,
  itemFeedbackSchema,
  learningOverview,
  preferenceChangeSchema,
  recordItemFeedback,
} from "@recalino/core/pers";
import { errors } from "@recalino/core/plt";
import type { Handler } from "./api";
export function learningHandler(): Handler {
  return async ({ db, ctx }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    return { body: await learningOverview(db, { userId: ctx.userId, requestId: ctx.requestId }) };
  };
}
export function learningPreferencesHandler(): Handler {
  return async ({ input, db, ctx }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    return {
      body: await changeLearningPreferences(
        db,
        { userId: ctx.userId, requestId: ctx.requestId },
        preferenceChangeSchema.parse(input),
      ),
    };
  };
}
/** D49: correct a practice note about one owned learning goal; append-only and idempotent. */
export function learningFeedbackHandler(): Handler {
  return async ({ input, db, ctx, request }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    const learner = { userId: ctx.userId, requestId: ctx.requestId };
    const key = request.headers.get("idempotency-key");
    if (!key) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    await recordItemFeedback(db, learner, itemFeedbackSchema.parse(input), { key });
    return { body: await learningOverview(db, learner) };
  };
}
