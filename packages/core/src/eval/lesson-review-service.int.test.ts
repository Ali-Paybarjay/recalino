import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { lessonReviewFixture, lessonReviewFixtureSettings } from "../../test/lesson-review-fixture";
import { LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import { runFixtureProcessingStep } from "../../test/processing-jobs";
import { updateProfile } from "../acc";
import { type AiProvider, ProviderError, type ProviderResult, type StructuredInput } from "../aip";
import { createDatabase, type Database, type Tx } from "../db";
import { getVersion, tombstoneKnowledge } from "../lkm";
import { cancelJob, type JobContext } from "../plt";
import {
  cleanupSessionProcessing,
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  getRun,
} from "../proc";
import { amounts } from "../quota";
import {
  LESSON_REVIEW_RUBRIC_VERSION,
  lessonReviewCriteria,
  lessonReviewResponseSchema,
} from "./lesson-review";
import { lessonReviewJob, readLessonReview, scheduleLessonReview } from "./lesson-review-service";

// Test overrides are loopback-validated. This suite never inherits a cloud DATABASE_URL.
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
const reviewRunIds: string[] = [];
afterAll(async () => {
  try {
    if (reviewRunIds.length) {
      const runs = await db
        .selectFrom("proc.processing_run")
        .select("job_id")
        .where("id", "in", reviewRunIds)
        .execute();
      for (const run of runs) if (run.job_id) await cancelJob(db, run.job_id, new Date());
    }
  } finally {
    await db.destroy();
  }
});

class ReviewProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = { ...lessonReviewFixtureSettings };
  readonly calls: StructuredInput<unknown>[] = [];
  reply?: (input: StructuredInput<unknown>) => unknown;
  beforeReply?: () => Promise<void>;
  failure?: ProviderError;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    const data = JSON.parse(input.input);
    const raw = this.reply?.(input) ?? {
      rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
      checks: lessonReviewCriteria.map((criterion) => ({
        criterion,
        status:
          criterion === "learner_fit" && data.learner.declaredLevel === null
            ? "not_assessable"
            : "satisfactory",
        reason: "Synthetic bounded assessment.",
        findings: [],
      })),
    };
    await this.beforeReply?.();
    // Intentionally do not parse here: PROC must also validate an untrusted provider result.
    return {
      output: raw as T,
      provider: this.name,
      model: input.model,
      requestId: randomUUID(),
      actualMicros: 10,
      usage: { inputTokens: 30, outputTokens: 30 },
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("Reviewer cannot transcribe");
  }
  async speech(): Promise<never> {
    throw new Error("Reviewer cannot create speech");
  }
}

async function scheduled(
  x: Awaited<ReturnType<typeof lessonReviewFixture>>,
  provider: ReviewProvider,
  key = randomUUID(),
) {
  const result = await scheduleLessonReview(
    db,
    x.ctx,
    x.session.id,
    {
      knowledgeVersionId: x.knowledge.id,
    },
    { key, provider },
  );
  reviewRunIds.push(result.runId);
  return result;
}
async function run(
  x: Awaited<ReturnType<typeof lessonReviewFixture>>,
  provider: ReviewProvider,
  runId: string,
) {
  await runFixtureProcessingStep(db, lessonReviewJob({ provider }), {
    runId,
    userId: x.ctx.userId,
  });
}
async function attempts(runId: string) {
  return db.selectFrom("proc.provider_attempt").selectAll().where("run_id", "=", runId).execute();
}

it("reviews the selected version with its frozen level, persists an advisory checkpoint, and charges no material or regeneration", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  expect(await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).toBeNull();
  await updateProfile(
    db,
    x.ctx,
    { field: "level_goal", level: "C2", goal: "ielts" },
    { now: new Date() },
  );
  const before = await getVersion(db, x.ctx, x.knowledge.id);
  const key = randomUUID();
  const [a, b] = await Promise.all([scheduled(x, provider, key), scheduled(x, provider, key)]);
  expect(a).toEqual(b);
  const queued = await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id);
  expect(queued).toMatchObject({ state: "queued", response: null, verdict: null });
  await run(x, provider, a.runId);
  const report = await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id);
  expect(report).toMatchObject({
    state: "ready",
    runId: a.runId,
    knowledgeVersionId: x.knowledge.id,
    knowledgeVersion: x.knowledge.version,
    reviewerModel: provider.settings.llmModel,
    verdict: "no_major_issues_found",
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
  });
  expect(provider.calls).toHaveLength(1);
  const input = JSON.parse(provider.calls[0]?.input ?? "{}");
  expect(input.learner).toEqual({ declaredLevel: "A2", goal: "general" });
  expect(provider.calls[0]?.input).not.toContain("UNSELECTED_PRIVATE_PAGE_DO_NOT_SEND");
  expect(await getVersion(db, x.ctx, x.knowledge.id)).toEqual(before);
  expect(await attempts(a.runId)).toMatchObject([{ state: "succeeded" }]);
  const costs = await db
    .selectFrom("quota.provider_cost")
    .selectAll()
    .where("run_id", "=", a.runId)
    .execute();
  expect(costs).toHaveLength(1);
  const reservation = await db
    .selectFrom("quota.reservation")
    .selectAll()
    .where("id", "=", (await getRun(db, x.ctx, a.runId)).reservationId)
    .executeTakeFirstOrThrow();
  expect(reservation.amounts).toEqual(amounts({}));
  expect(reservation.settled_amounts).toEqual(amounts({}));
  // Simulate the crash window after the provider checkpoint, before auxiliary completion.
  const record = await db
    .selectFrom("proc.processing_run")
    .select("job_id")
    .where("id", "=", a.runId)
    .executeTakeFirstOrThrow();
  await db
    .updateTable("proc.processing_run")
    .set({ state: "processing" })
    .where("id", "=", a.runId)
    .execute();
  await lessonReviewJob({ provider }).run(
    { runId: a.runId, userId: x.ctx.userId, subjectId: x.knowledge.id },
    {
      db,
      now: () => new Date(),
      job: { id: record.job_id ?? randomUUID(), attempt: 2 },
      step: async (_name, effect) => {
        await db.transaction().execute(effect);
        return "ran";
      },
    },
  );
  expect(provider.calls).toHaveLength(1);
  expect((await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id))?.state).toBe("ready");
});

it("rejects another owner's version and a version from another session before reserving or calling", async () => {
  const x = await lessonReviewFixture(db);
  const other = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  await expect(
    scheduleLessonReview(
      db,
      other.ctx,
      x.session.id,
      { knowledgeVersionId: x.knowledge.id },
      {
        key: randomUUID(),
        provider,
      },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(readLessonReview(db, other.ctx, x.session.id, x.knowledge.id)).rejects.toMatchObject(
    { code: "not_found" },
  );
  await expect(
    scheduleLessonReview(
      db,
      x.ctx,
      other.session.id,
      { knowledgeVersionId: x.knowledge.id },
      {
        key: randomUUID(),
        provider,
      },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(provider.calls).toHaveLength(0);
});

it("keeps uncertain paid outcomes unresolved and blocks fresh-key duplicate reviews", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  provider.failure = new ProviderError("provider_timeout", false, true);
  const key = randomUUID();
  const queued = await scheduled(x, provider, key);
  await run(x, provider, queued.runId);
  expect(await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_timeout",
    response: null,
    verdict: null,
  });
  expect(await scheduled(x, provider, key)).toEqual(queued);
  await expect(scheduled(x, provider)).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { review: ["provider_outcome_unresolved"] } },
  });
  expect(await attempts(queued.runId)).toMatchObject([{ state: "uncertain" }]);
  expect(provider.calls).toHaveLength(1);
});

it("retries a definite retryable failure, while recording each attempt and only one report", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  provider.failure = new ProviderError("provider_http_503", true, false);
  const queued = await scheduled(x, provider);
  await run(x, provider, queued.runId);
  expect((await getRun(db, x.ctx, queued.runId)).state).toBe("processing");
  const record = await db
    .selectFrom("proc.processing_run")
    .select("job_id")
    .where("id", "=", queued.runId)
    .executeTakeFirstOrThrow();
  if (!record.job_id) throw new Error("Missing fixture review job");
  await db
    .updateTable("plt.job")
    .set({ run_at: new Date(0) })
    .where("id", "=", record.job_id)
    .execute();
  provider.failure = undefined;
  await run(x, provider, queued.runId);
  expect((await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id))?.state).toBe("ready");
  expect((await attempts(queued.runId)).map((attempt) => attempt.state).sort()).toEqual([
    "failed",
    "succeeded",
  ]);
  expect(provider.calls).toHaveLength(2);
});

it("rejects unsupported target quotations with known cost and never publishes a false report", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  provider.reply = () => ({
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
    checks: lessonReviewCriteria.map((criterion) => ({
      criterion,
      status: criterion === "educational_correctness" ? "concern" : "satisfactory",
      reason: "Synthetic check.",
      findings:
        criterion === "educational_correctness"
          ? [
              {
                targetId: "item:does-not-exist",
                quote: "Invented learner response",
                evidenceKeys: [],
                explanation: "This invented target is invalid.",
                suggestion: "Do not publish this finding.",
              },
            ]
          : [],
    })),
  });
  const queued = await scheduled(x, provider);
  await run(x, provider, queued.runId);
  expect(await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).toMatchObject({
    state: "failed",
    lastError: "provider_schema_invalid",
    response: null,
    verdict: null,
  });
  expect(await attempts(queued.runId)).toMatchObject([{ state: "failed" }]);
  const checkpoints = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", queued.runId)
    .execute();
  expect(checkpoints).toEqual([]);
  // Crash after paid-invalid accounting but before the auxiliary run was marked failed.
  await db
    .updateTable("proc.processing_run")
    .set({ state: "processing" })
    .where("id", "=", queued.runId)
    .execute();
  await lessonReviewJob({ provider }).run(
    {
      runId: queued.runId,
      userId: x.ctx.userId,
      subjectId: x.knowledge.id,
    },
    {
      db,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 2 },
      step: async (_name, effect) => {
        await db.transaction().execute(effect);
        return "ran";
      },
    },
  );
  expect(provider.calls).toHaveLength(1);
  expect(await attempts(queued.runId)).toHaveLength(1);
  expect((await getRun(db, x.ctx, queued.runId)).state).toBe("failed");
});

it.each(["invalid", "valid"] as const)(
  "atomically reuses a %s paid outcome recorded after a delayed worker's preflight",
  async (responseKind) => {
    const x = await lessonReviewFixture(db);
    const provider = new ReviewProvider();
    const queued = await scheduled(x, provider);
    const latch = () => {
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const firstDispatched = latch();
    const releaseFirstResponse = latch();
    const secondPreflightFinished = latch();
    const releaseSecondAttempt = latch();
    if (responseKind === "invalid")
      provider.reply = () => ({ rubricVersion: LESSON_REVIEW_RUBRIC_VERSION, checks: [] });
    provider.beforeReply = async () => {
      firstDispatched.release();
      await releaseFirstResponse.promise;
    };
    let transactionCount = 0;
    // Delay only worker two's attempt transaction. Worker one's real cost/response transactions
    // continue normally, reproducing a reclaimed worker that waited after its auxiliary preflight.
    const delayedDb = new Proxy(db, {
      get(target, key) {
        if (key === "transaction")
          return () => {
            const transaction = target.transaction();
            const number = ++transactionCount;
            return new Proxy(transaction, {
              get(builder, property) {
                if (property === "execute")
                  return async (effect: (tx: Tx) => Promise<unknown>) => {
                    if (number === 2) {
                      secondPreflightFinished.release();
                      await releaseSecondAttempt.promise;
                    }
                    return builder.execute(effect);
                  };
                const value = Reflect.get(builder, property, builder);
                return typeof value === "function" ? value.bind(builder) : value;
              },
            });
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const context = (database: Database): JobContext => ({
      db: database,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 1 },
      step: async () => "skipped",
    });
    const options = {
      step: "lesson-review:report",
      model: provider.settings.llmModel,
      provider,
      schema: lessonReviewResponseSchema,
      singleResponse: true,
      effect: (operationKey: string) =>
        provider.structured({
          operationKey,
          model: provider.settings.llmModel,
          schema: lessonReviewResponseSchema,
          schemaName: "lesson_quality_review",
          system: "Synthetic review",
          input: JSON.stringify({ learner: { declaredLevel: "A2" } }),
        }),
    };
    const first = executeAuxiliaryProviderStep(context(db), x.ctx, queued.runId, options).then(
      (output) => output,
      (error: unknown) => error,
    );
    await firstDispatched.promise;
    const second = executeAuxiliaryProviderStep(
      context(delayedDb),
      x.ctx,
      queued.runId,
      options,
    ).then(
      (output) => output,
      (error: unknown) => error,
    );
    await secondPreflightFinished.promise;
    releaseFirstResponse.release();
    const firstOutcome = await first;
    releaseSecondAttempt.release();
    const secondOutcome = await second;
    expect(provider.calls).toHaveLength(1);
    expect(await attempts(queued.runId)).toHaveLength(1);
    if (responseKind === "invalid") {
      expect(firstOutcome).toMatchObject({ code: "provider_schema_invalid", uncertain: false });
      expect(secondOutcome).toMatchObject({ code: "provider_schema_invalid", uncertain: false });
      await db
        .transaction()
        .execute((tx) =>
          failAuxiliaryRun(tx, x.ctx, queued.runId, { code: "provider_schema_invalid" }),
        );
    } else {
      expect(firstOutcome).toMatchObject({ rubricVersion: LESSON_REVIEW_RUBRIC_VERSION });
      expect(secondOutcome).toEqual(firstOutcome);
      await db
        .transaction()
        .execute((tx) => completeAuxiliaryRun(tx, x.ctx, queued.runId, amounts({})));
      expect(await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).toMatchObject({
        state: "ready",
        verdict: "no_major_issues_found",
        response: firstOutcome,
      });
    }
  },
);

it("cancels a source-deleted queued lesson before dispatch and refuses the stale report", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  const queued = await scheduled(x, provider);
  await db
    .updateTable("src.asset")
    .set({ tombstoned_at: new Date() })
    .where("id", "=", x.sourceId)
    .execute();
  await run(x, provider, queued.runId);
  expect((await getRun(db, x.ctx, queued.runId)).state).toBe("cancelled");
  expect(provider.calls).toHaveLength(0);
  await expect(readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("rechecks deletion at the provider commit without forgetting the known paid response", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  provider.beforeReply = async () => {
    await db
      .updateTable("src.asset")
      .set({ tombstoned_at: new Date() })
      .where("id", "=", x.sourceId)
      .execute();
  };
  const queued = await scheduled(x, provider);
  await run(x, provider, queued.runId);
  expect((await getRun(db, x.ctx, queued.runId)).state).toBe("failed");
  expect(provider.calls).toHaveLength(1);
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("step")
      .where("run_id", "=", queued.runId)
      .execute(),
  ).toEqual([]);
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", queued.runId)
      .execute(),
  ).toHaveLength(1);
});

it("refuses provider setting drift without dispatching or guessing a missing declared level", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  const queued = await scheduled(x, provider);
  provider.settings.version = "changed-after-queue";
  await run(x, provider, queued.runId);
  expect(await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).toMatchObject({
    state: "failed",
    lastError: "lesson_review_provider_settings_changed",
  });
  expect(provider.calls).toHaveLength(0);
  const original = await db
    .selectFrom("proc.processing_run")
    .select("settings")
    .where("id", "=", x.classRun.id)
    .executeTakeFirstOrThrow();
  await db
    .updateTable("proc.processing_run")
    .set({
      settings: JSON.stringify({
        ...(original.settings as Record<string, unknown>),
        learnerContext: { version: 1, declaredLevel: "not_sure", goal: "general" },
      }),
    })
    .where("id", "=", x.classRun.id)
    .execute();
  const fresh = new ReviewProvider();
  const next = await scheduled(x, fresh);
  await run(x, fresh, next.runId);
  expect(JSON.parse(fresh.calls[0]?.input ?? "{}").learner.declaredLevel).toBeNull();
  expect((await readLessonReview(db, x.ctx, x.session.id, x.knowledge.id))?.verdict).toBe(
    "insufficient_evidence",
  );
});

it("rejects oversized review input before reserving a new run", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  provider.settings.maxInputCharacters = 1;
  await expect(scheduled(x, provider)).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { review: ["lesson_review_input_too_large"] } },
  });
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select("id")
      .where("session_id", "=", x.session.id)
      .where("kind", "=", "auxiliary")
      .execute(),
  ).toEqual([]);
  expect(provider.calls).toHaveLength(0);
});

it("hides tombstoned lesson reports and lets existing cleanup remove derived evaluator text", async () => {
  const x = await lessonReviewFixture(db);
  const provider = new ReviewProvider();
  const queued = await scheduled(x, provider);
  await run(x, provider, queued.runId);
  await db.transaction().execute((tx) => tombstoneKnowledge(tx, x.ctx, x.session.id));
  await expect(readLessonReview(db, x.ctx, x.session.id, x.knowledge.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await cleanupSessionProcessing(db, x.ctx, x.session.id);
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("step")
      .where("run_id", "=", queued.runId)
      .execute(),
  ).toEqual([]);
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select(["settings", "input_snapshot"])
      .where("id", "=", queued.runId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ settings: {}, input_snapshot: {} });
});
