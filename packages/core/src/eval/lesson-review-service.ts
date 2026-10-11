import { z } from "zod";
import { lockAccount } from "../acc";
import { type AiProvider, ProviderError, providerSettingsSchema, requireProvider } from "../aip";
import type { Database, Tx } from "../db";
import {
  AppError,
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  JobCancelled,
  type JobDefinition,
  type LearnerContext,
  readPltSettings,
  sha256Hex,
} from "../plt";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  latestAuxiliaryRun,
  type RunState,
  readAuxiliaryCheckpoint,
  readAuxiliaryRun,
  readClassRunSettings,
  readKnowledgeSourceSnapshot,
  runSettingsSchema,
  scheduleAuxiliaryRun,
} from "../proc";
import { amounts } from "../quota";
import { assertSourcesLive } from "../src";
import {
  buildLessonReviewInput,
  LESSON_REVIEW_RUBRIC_VERSION,
  LESSON_REVIEW_SYSTEM_PROMPT,
  type LessonReviewResponse,
  type LessonReviewVerdict,
  lessonReviewVerdict,
} from "./lesson-review";

const REQUEST_KIND = "lesson_review";
const REVIEW_STEP = "lesson-review:report";
const payloadSchema = z.strictObject({ runId: z.uuid(), userId: z.uuid(), subjectId: z.uuid() });
const requestSchema = z.strictObject({
  kind: z.literal(REQUEST_KIND),
  knowledgeVersionId: z.uuid(),
  rubricVersion: z.literal(LESSON_REVIEW_RUBRIC_VERSION),
});
const snapshotSchema = z.strictObject({ subjectId: z.uuid(), request: requestSchema });

export interface LessonReviewView {
  runId: string;
  knowledgeVersionId: string;
  knowledgeVersion: number;
  state: RunState;
  lastError: string | null;
  reviewerModel: string;
  rubricVersion: typeof LESSON_REVIEW_RUBRIC_VERSION;
  createdAt: string;
  response: LessonReviewResponse | null;
  verdict: LessonReviewVerdict | null;
}

/** Called under the account lock; source locks keep deletion from racing a saved report. */
async function reviewMaterial(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  knowledgeVersionId: string,
) {
  const material = await readKnowledgeSourceSnapshot(tx, ctx, knowledgeVersionId);
  if (material.knowledge.sessionId !== sessionId) throw errors.notFound();
  await assertSourcesLive(
    tx,
    ctx,
    material.sources.map((source) => source.sourceId),
  );
  const settings = runSettingsSchema.parse(
    await readClassRunSettings(tx, ctx, material.knowledge.runId),
  );
  const level = settings.learnerContext?.declaredLevel;
  return {
    ...material,
    learner: {
      declaredLevel: level && level !== "not_sure" ? level : null,
      goal: settings.learnerContext?.goal ?? null,
    },
  };
}

/** A separate, explicit assessment of an immutable generated version; no learner-state writes. */
export async function scheduleLessonReview(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  raw: { knowledgeVersionId: string },
  options: { key: string; provider: AiProvider; now?: Date },
): Promise<{ runId: string; knowledgeVersionId: string }> {
  z.uuid().parse(sessionId);
  const { knowledgeVersionId } = z.strictObject({ knowledgeVersionId: z.uuid() }).parse(raw);
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const provider = requireProvider(options.provider);
  const now = options.now ?? new Date();
  const operationKey = `lesson-review:${sessionId}:${sha256Hex(options.key)}`;
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const material = await reviewMaterial(tx, ctx, sessionId, knowledgeVersionId);
    // Fail an oversized or structurally invalid lesson before reserving or queueing paid work.
    buildLessonReviewInput({
      ...material,
      maxInputCharacters: provider.settings.maxInputCharacters,
    });
    const prior = await latestAuxiliaryRun(tx, ctx, sessionId, {
      subjectId: knowledgeVersionId,
      requestKind: REQUEST_KIND,
    });
    // A fresh key must not duplicate a bill whose outcome an operator still needs to reconcile.
    if (prior?.state === "needs_input" && prior.operationKey !== operationKey)
      throw errors.validationFailed({ review: ["provider_outcome_unresolved"] });
    const runId = await scheduleAuxiliaryRun(
      tx,
      ctx,
      {
        sessionId,
        operationKey,
        subjectId: knowledgeVersionId,
        requested: amounts({}),
        request: {
          kind: REQUEST_KIND,
          knowledgeVersionId,
          rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
        },
        settings: provider.settings,
        job: lessonReviewJob({ provider }),
      },
      now,
    );
    return { runId, knowledgeVersionId };
  });
}

export async function readLessonReview(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  knowledgeVersionId: string,
): Promise<LessonReviewView | null> {
  z.uuid().parse(sessionId);
  z.uuid().parse(knowledgeVersionId);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const material = await reviewMaterial(tx, ctx, sessionId, knowledgeVersionId);
    const run = await latestAuxiliaryRun(tx, ctx, sessionId, {
      subjectId: knowledgeVersionId,
      requestKind: REQUEST_KIND,
    });
    if (!run) return null;
    const snapshot = snapshotSchema.parse(run.inputSnapshot);
    if (
      snapshot.subjectId !== knowledgeVersionId ||
      snapshot.request.knowledgeVersionId !== knowledgeVersionId
    )
      throw errors.conflict();
    const settings = providerSettingsSchema.parse(run.settings);
    let response: LessonReviewResponse | null = null;
    if (run.state === "ready") {
      const checkpoint = await readAuxiliaryCheckpoint(tx, ctx, run.id, REVIEW_STEP);
      const input = buildLessonReviewInput({
        ...material,
        maxInputCharacters: settings.maxInputCharacters,
      });
      response = input.schema.parse(checkpoint);
    }
    return {
      runId: run.id,
      knowledgeVersionId,
      knowledgeVersion: material.knowledge.version,
      state: run.state,
      lastError: run.lastError,
      reviewerModel: settings.llmModel,
      rubricVersion: snapshot.request.rubricVersion,
      createdAt: run.createdAt,
      response,
      verdict: response ? lessonReviewVerdict(response) : null,
    };
  });
}

export function lessonReviewJob(dependencies: {
  provider: AiProvider | ((settings: unknown) => AiProvider);
}): JobDefinition<z.infer<typeof payloadSchema>> {
  return {
    kind: "eval.lesson_review",
    version: 1,
    payload: payloadSchema,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      // An invalid cross-account payload never enters error cleanup for another owner's run.
      const run = await readAuxiliaryRun(job.db, ctx, payload.runId);
      if (!["queued", "processing"].includes(run.state)) return;
      try {
        const snapshot = snapshotSchema.parse(run.inputSnapshot);
        if (
          snapshot.subjectId !== payload.subjectId ||
          snapshot.request.knowledgeVersionId !== payload.subjectId
        )
          throw errors.notFound();
        const settings = providerSettingsSchema.parse(run.settings);
        const provider = requireProvider(
          typeof dependencies.provider === "function"
            ? dependencies.provider(settings)
            : dependencies.provider,
        );
        if (canonicalJson(settings) !== canonicalJson(provider.settings))
          throw errors.validationFailed({ review: ["lesson_review_provider_settings_changed"] });
        const material = await job.db.transaction().execute(async (tx) => {
          await lockAccount(tx, ctx.userId);
          return reviewMaterial(tx, ctx, run.sessionId, payload.subjectId);
        });
        const input = buildLessonReviewInput({
          ...material,
          maxInputCharacters: settings.maxInputCharacters,
        });
        await executeAuxiliaryProviderStep(job, ctx, run.id, {
          step: REVIEW_STEP,
          model: settings.llmModel,
          provider,
          schema: input.schema,
          singleResponse: true,
          effect: (operationKey) =>
            provider.structured({
              operationKey,
              model: settings.llmModel,
              schema: input.schema,
              schemaName: "lesson_quality_review",
              system: LESSON_REVIEW_SYSTEM_PROMPT,
              input: input.input,
            }),
          onCommit: async (tx) => {
            await reviewMaterial(tx, ctx, run.sessionId, payload.subjectId);
          },
        });
        await job.db.transaction().execute(async (tx) => {
          await lockAccount(tx, ctx.userId);
          await reviewMaterial(tx, ctx, run.sessionId, payload.subjectId);
          await completeAuxiliaryRun(tx, ctx, run.id, amounts({}), job.now());
        });
      } catch (error) {
        if (error instanceof JobCancelled) return;
        if (
          error instanceof ProviderError &&
          error.retryable &&
          job.job.attempt < readPltSettings().jobs.maxAttempts
        )
          throw error;
        await job.db.transaction().execute((tx) =>
          failAuxiliaryRun(
            tx,
            ctx,
            run.id,
            {
              code: reviewErrorCode(error),
              uncertain: error instanceof ProviderError && error.uncertain,
              cancelled: error instanceof AppError && error.code === "not_found",
            },
            job.now(),
          ),
        );
      }
    },
  };
}

function reviewErrorCode(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof AppError) {
    const fields = error.details?.fields as { review?: unknown } | undefined;
    const reason = Array.isArray(fields?.review) ? fields.review[0] : undefined;
    return typeof reason === "string" && /^lesson_review_[a-z_]{1,100}$/.test(reason)
      ? reason
      : error.code;
  }
  return "lesson_review_failed";
}
