import "server-only";
import {
  changeLearningPreferences,
  learningOverview,
  preferenceChangeSchema,
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
