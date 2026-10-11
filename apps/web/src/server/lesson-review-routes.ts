import "server-only";
import { requireProvider } from "@recalino/core/aip";
import { readLessonReview, scheduleLessonReview } from "@recalino/core/eval";
import { errors, isValidIdempotencyKey, type LearnerContext } from "@recalino/core/plt";
import { z } from "zod";
import { getAiProvider } from "./ai";
import type { Handler } from "./api";
import { PROCESSING_WAKE, runJobsSoon } from "./jobs";

interface Dependencies {
  read: typeof readLessonReview;
  schedule: typeof scheduleLessonReview;
  provider: typeof getAiProvider;
  wake: typeof runJobsSoon;
}

/** Reading a report never starts a provider request; only POST expresses that intent. */
export function classLessonReviewHandler(
  sessionId: string,
  overrides: Partial<Dependencies> = {},
): Handler {
  const deps = {
    read: readLessonReview,
    schedule: scheduleLessonReview,
    provider: getAiProvider,
    wake: runJobsSoon,
    ...overrides,
  };
  return async ({ db, ctx, request, input }) => {
    z.uuid().parse(sessionId);
    if (!ctx.userId) throw errors.unauthenticated();
    const learner: LearnerContext = { userId: ctx.userId, requestId: ctx.requestId };
    if (request.method === "GET") {
      const versionId = z.uuid().parse(new URL(request.url).searchParams.get("versionId"));
      return { body: await deps.read(db, learner, sessionId, versionId) };
    }
    const fields = z.strictObject({ knowledgeVersionId: z.uuid() }).parse(input);
    const key = request.headers.get("idempotency-key");
    if (!key || !isValidIdempotencyKey(key))
      throw errors.validationFailed({ "Idempotency-Key": [key ? "invalid" : "required"] });
    const result = await deps.schedule(db, learner, sessionId, fields, {
      key,
      provider: requireProvider(deps.provider()),
    });
    deps.wake(
      ["eval.lesson_review"],
      PROCESSING_WAKE.budgetSeconds,
      PROCESSING_WAKE.functionSeconds,
    );
    return { status: 202, body: result };
  };
}
