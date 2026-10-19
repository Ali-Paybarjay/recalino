import "server-only";
import {
  changeLearningPreferences,
  itemFeedbackSchema,
  learningOverview,
  preferenceChangeSchema,
  recordItemFeedback,
} from "@recalino/core/pers";
import { type Handler, idempotencyKey, learnerActor } from "./api";
export function learningHandler(): Handler {
  return async ({ db, ctx }) => {
    return { body: await learningOverview(db, learnerActor(ctx)) };
  };
}
export function learningPreferencesHandler(): Handler {
  return async ({ input, db, ctx }) => {
    const learner = learnerActor(ctx);
    return {
      body: await changeLearningPreferences(db, learner, preferenceChangeSchema.parse(input)),
    };
  };
}
/** D49: correct a practice note about one owned learning goal; append-only and idempotent. */
export function learningFeedbackHandler(): Handler {
  return async ({ input, db, ctx, request }) => {
    const learner = learnerActor(ctx);
    const key = idempotencyKey(request);
    await recordItemFeedback(db, learner, itemFeedbackSchema.parse(input), { key });
    return { body: await learningOverview(db, learner) };
  };
}
