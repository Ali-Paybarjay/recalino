import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs } from "../../test/processing-jobs";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import {
  type AiProvider,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  type StructuredInput,
  type Transcript,
  type TranscriptionInput,
} from "../aip";
import { createDatabase } from "../db";
import type { KnowledgeModel } from "../lkm";
import { createSession, deleteSession } from "../org";
import {
  AppError,
  cancelJob,
  claimJobs,
  completeJob,
  failJob,
  JobCancelled,
  type JobContext,
  MemoryObjectStore,
  purgeFinishedJobs,
  runJobStep,
  sweepJobs,
} from "../plt";
import {
  amounts,
  beginProviderStep,
  configureCostPolicy,
  finishProviderStep,
  grantEntitlement,
  spendTotals,
} from "../quota";
import { appendContentVersion } from "../src";
import {
  closeUnownedProviderHolds,
  isConservativelyClosedAttempt,
  isUnownedOpenAttempt,
  providerAttemptFacts,
  providerHoldReconcileCounts,
  type ReconcileJob,
  reconcileEndedJobRuns,
} from "./maintenance";
import {
  cancelAccountRuns,
  cancelRun,
  cancelSessionRuns,
  createProcessingRun,
  retryRun,
} from "./runs";
import { processingJob } from "./worker";

// P12-01 (C11-36 step one; ADR-0004 rules 5, 6 and 7): the ended-job reconciliation, as a really
// claimed job with its real lease and no test-only mark, closes the open hold of a paid attempt
// that no job will settle, once, at the hold's maximum, dated at the hold's own time, and leaves
// the attempt as it was. Every processing job here is really claimed too.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 6 });
const runIds: string[] = [];
const reconcileJobIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, runIds);
    for (const id of reconcileJobIds) await cancelJob(db, id, new Date());
  } finally {
    await db.destroy();
  }
});

const settings: ProviderSettings = {
  version: "fixture",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
class FixtureProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  calls = 0;
  beforeResult?: () => Promise<void>;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls++;
    await this.beforeResult?.();
    const data = z
      .object({
        sources: z.array(
          z.object({
            sourceId: z.string(),
            contentVersionId: z.string(),
            blocks: z.array(z.object({ id: z.string(), text: z.string() })),
          }),
        ),
      })
      .parse(JSON.parse(input.input));
    const source = data.sources[0];
    const block = source?.blocks[0];
    if (!source || !block) throw new Error("Fixture expected nonempty selected source evidence");
    const model: KnowledgeModel = {
      schemaVersion: "1",
      title: "Synthetic class",
      language: { learning: "en", explanation: "en" },
      summary: [
        {
          id: "claim-1",
          text: "A synthetic class example.",
          origin: "from_class",
          creation: "ai_generation",
          evidence: "material",
          sourceRefs: [
            {
              sourceId: source.sourceId,
              contentVersionId: source.contentVersionId,
              locator: {
                kind: "text",
                blockId: block.id,
                start: 0,
                end: Array.from(block.text).length,
              },
            },
          ],
          speakerRole: "unknown",
          uncertain: false,
        },
      ],
      topics: [],
      learningItems: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    return {
      output: input.schema.parse({ ...model, sourceClassifications: [] }),
      requestId: "synthetic-generation",
      model: input.model,
      provider: this.name,
      actualMicros: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(_input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    throw new Error("Fixture has no audio");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("Fixture has no speech");
  }
}
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  return ctx;
}
async function fixture() {
  const ctx = await learner();
  const now = new Date();
  const session = await createSession(db, ctx, {}, { key: randomUUID() });
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 14,
      sha256: "a".repeat(64),
      display_name: "Synthetic.txt",
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: ctx.userId,
      session_id: session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, ctx, asset.id, {
      originKey: "fixture",
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Present perfect" }],
    }),
  );
  await grantEntitlement(db, {
    userId: ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic cost reconciliation fixture",
  });
  await configureCostPolicy(
    db,
    {
      version: "fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic cost reconciliation fixture" },
  );
  const provider = new FixtureProvider();
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const start = async () => {
    const run = await createProcessingRun(
      db,
      ctx,
      { sessionId: session.id, operationKey: randomUUID() },
      { provider, job },
    );
    runIds.push(run.id);
    return run;
  };
  return { ctx, session, provider, job, start };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Logged = { level: string; event: string; fields: Record<string, unknown> };

/**
 * P11-02 AC-24: each job of the run is really claimed, on a queue kind of its own so no other
 * fixture's job is taken, and runs with its real lease, without the test-only mark.
 */
async function drive(f: Fixture, runId: string, logs?: Logged[]) {
  for (let step = 0; step < 20; step++) {
    const current = await db
      .selectFrom("proc.processing_run")
      .select(["job_id", "state"])
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    if (!current.job_id || !["queued", "processing"].includes(current.state)) return;
    const kind = `proc.synthetic_${randomUUID().replaceAll("-", "")}`;
    await db.updateTable("plt.job").set({ kind }).where("id", "=", current.job_id).execute();
    const [claim] = await claimJobs(db, [kind], 1, new Date());
    if (!claim) return;
    if (claim.generation === undefined) throw new Error("Expected a claim with its generation");
    const context: JobContext = {
      db,
      now: () => new Date(),
      job: { id: claim.id, attempt: claim.attempt },
      lease: { id: claim.id, token: claim.token, generation: claim.generation },
      step: (name, effect) => runJobStep(db, claim, name, effect, new Date()),
      ...(logs
        ? {
            log: (level, event, fields) => {
              logs.push({ level, event, fields: { ...(fields ?? {}) } });
            },
          }
        : {}),
    };
    try {
      await f.job.run(f.job.payload.parse(claim.payload), context);
      await completeJob(db, claim, new Date());
    } catch (error) {
      if (!(error instanceof JobCancelled))
        await failJob(
          db,
          claim,
          error instanceof AppError ? error.code : "handler_error",
          new Date(),
        );
    }
  }
}

/** The reconciliation job, really claimed on a queue kind of its own, with its real lease. */
async function reconcileJob() {
  const kind = `proc.reconcile_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await db
    .insertInto("plt.job")
    .values({
      kind,
      payload: JSON.stringify({}),
      payload_version: 1,
      max_attempts: 3,
      lease_seconds: 300,
      retry_base_seconds: 30,
      retry_max_seconds: 3600,
      run_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const [claim] = await claimJobs(db, [kind], 1, new Date());
  if (!claim || claim.generation === undefined) throw new Error("Expected a reconcile claim");
  reconcileJobIds.push(claim.id);
  const logs: Logged[] = [];
  const job: ReconcileJob = {
    db,
    now: () => new Date(),
    job: { id: claim.id, attempt: claim.attempt },
    lease: { id: claim.id, token: claim.token, generation: claim.generation },
    log: (level, event, fields) => {
      logs.push({ level, event, fields: { ...(fields ?? {}) } });
    },
  };
  return { claim, job, logs };
}
const reconcile = (job: ReconcileJob, userId: string) =>
  reconcileEndedJobRuns(db, new Date(), { userId, job });

/** The run's attempts with their holds, and the run's cost rows. */
async function ledger(runId: string) {
  const attempts = (
    await db
      .selectFrom("proc.provider_attempt as a")
      .innerJoin("quota.cost_hold as h", "h.id", "a.hold_id")
      .select([
        "a.id as id",
        "a.state as state",
        "a.hold_id as holdId",
        "a.operation_key as operationKey",
        "h.created_at as holdCreatedAt",
        "h.closed_at as closedAt",
        "h.maximum_micros as maximum",
      ])
      .where("a.run_id", "=", runId)
      .orderBy("a.started_at")
      .execute()
  ).map((row) => ({
    ...row,
    holdCreatedAt: new Date(row.holdCreatedAt),
    closedAt: row.closedAt === null ? null : new Date(row.closedAt),
    maximum: Number(row.maximum),
  }));
  const costs = (
    await db
      .selectFrom("quota.provider_cost")
      .select(["attempt_id", "amount_micros", "estimated_micros", "usage", "created_at"])
      .where("run_id", "=", runId)
      .execute()
  ).map((row) => ({
    attemptId: row.attempt_id,
    amount: row.amount_micros === null ? null : Number(row.amount_micros),
    estimated: row.estimated_micros === null ? null : Number(row.estimated_micros),
    createdAt: new Date(row.created_at),
  }));
  return { attempts, costs };
}
const runRow = (runId: string) =>
  db
    .selectFrom("proc.processing_run")
    .select(["state", "job_id", "last_error"])
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();

/** Today's state before the reconciliation: commit refused, no cost row, hold open. */
async function expectLeftOpen(runId: string, state: "started" | "uncertain" = "started") {
  const { attempts, costs } = await ledger(runId);
  expect(attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
    { state, closedAt: null },
  ]);
  expect(costs).toEqual([]);
  return attempts[0] as (typeof attempts)[number];
}
/** One conservative row for the attempt, at the hold's maximum and time; the attempt unchanged. */
async function expectClosedConservatively(
  runId: string,
  closedFrom: Date,
  state: "started" | "uncertain" = "started",
) {
  const { attempts, costs } = await ledger(runId);
  const attempt = attempts[0];
  if (!attempt || attempts.length !== 1) throw new Error("Expected one attempt");
  expect(attempt.state).toBe(state);
  expect(attempt.closedAt).not.toBeNull();
  // closed_at is the real time of the close, never the hold's time.
  expect((attempt.closedAt as Date).getTime()).toBeGreaterThanOrEqual(closedFrom.getTime() - 1000);
  expect(costs).toEqual([
    {
      attemptId: attempt.id,
      amount: null,
      estimated: attempt.maximum,
      createdAt: attempt.holdCreatedAt,
    },
  ]);
  const [facts] = await providerAttemptFacts(db, { attemptId: attempt.id });
  expect(facts && isConservativelyClosedAttempt(facts)).toBe(true);
  expect(facts && isUnownedOpenAttempt(facts)).toBe(false);
  return attempt;
}
/** AC-4: a late settle of the same attempt writes no second row and is told apart. */
async function lateSettle(
  f: Fixture,
  runId: string,
  attempt: { id: string; holdId: string; operationKey: string },
) {
  return db.transaction().execute((tx) =>
    finishProviderStep(
      tx,
      f.ctx,
      attempt.holdId,
      {
        operationKey: attempt.operationKey,
        provider: "synthetic",
        model: "synthetic/llm",
        currency: "USD",
        actualMicros: 1,
        estimatedMicros: null,
        priceVersion: "fixture",
        usage: { inputTokens: 10, outputTokens: 10 },
        runId,
        attemptId: attempt.id,
      },
      new Date(),
    ),
  );
}
/** The close, then a second pass and a late settle that change nothing. */
async function closeAndRepeat(
  f: Fixture,
  runId: string,
  state: "started" | "uncertain" = "started",
) {
  const { job, claim, logs } = await reconcileJob();
  const closedFrom = new Date();
  await reconcile(job, f.ctx.userId);
  const attempt = await expectClosedConservatively(runId, closedFrom, state);
  const closes = logs.filter((line) => line.event === "provider_hold_closed_conservatively");
  expect(closes).toHaveLength(1);
  expect(closes[0]?.fields).toMatchObject({
    code: "hold_closed_at_maximum",
    reason: attempt.operationKey,
  });
  // Identifiers only: no user, session or output in the line.
  expect(JSON.stringify(closes[0])).not.toContain(f.ctx.userId);
  // AC-5: a second pass changes nothing.
  const before = await ledger(runId);
  await reconcile(job, f.ctx.userId);
  expect(await ledger(runId)).toEqual(before);
  expect(logs.filter((line) => line.event === "provider_hold_closed_conservatively")).toHaveLength(
    1,
  );
  // AC-4: the late settle keeps the conservative row and is told apart from a fresh settle.
  expect(await lateSettle(f, runId, attempt)).toBe("conservative_kept");
  expect(await ledger(runId)).toEqual(before);
  await completeJob(db, claim, new Date());
  return attempt;
}
/** Ends the in-flight job on its last try the way a stopped function does: lease out, swept. */
async function loseLastTry(runId: string) {
  const { job_id: jobId } = await runRow(runId);
  if (!jobId) throw new Error("Expected the run's job");
  await db
    .updateTable("plt.job")
    .set((eb) => ({ attempt: eb.ref("max_attempts"), lease_until: new Date(Date.now() - 60_000) }))
    .where("id", "=", jobId)
    .execute();
  await sweepJobs(db, new Date());
  const job = await db
    .selectFrom("plt.job")
    .select(["state", "last_error"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();
  expect(job).toEqual({ state: "failed", last_error: "lease_expired" });
  return jobId;
}

describe("conservative close of an unowned provider hold (P12-01)", () => {
  it("(1) closes the hold of a run cancelled during dispatch, once, at the hold's maximum", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () => cancelRun(db, f.ctx, run.id).then(() => undefined);
    await drive(f, run.id);
    expect(f.provider.calls).toBe(1);
    expect((await runRow(run.id)).state).toBe("cancelled");
    await expectLeftOpen(run.id);
    await closeAndRepeat(f, run.id);
    expect(f.provider.calls).toBe(1);
  });

  it("(2) closes the hold of a run whose session was deleted during dispatch", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () =>
      deleteSession(db, f.ctx, f.session.id, {
        onDelete: (tx, id) => cancelSessionRuns(tx, f.ctx, id),
      }).then(() => undefined);
    await drive(f, run.id);
    expect((await runRow(run.id)).state).toBe("cancelled");
    await expectLeftOpen(run.id);
    await closeAndRepeat(f, run.id);
  });

  it("(3) closes the hold of a run whose account was deleted during dispatch", async () => {
    const f = await fixture();
    const run = await f.start();
    // The processing module's own part of an account deletion (PRIV's `proc` tombstone hook).
    f.provider.beforeResult = () =>
      db.transaction().execute((tx) => cancelAccountRuns(tx, f.ctx, new Date()));
    await drive(f, run.id);
    expect((await runRow(run.id)).state).toBe("cancelled");
    await expectLeftOpen(run.id);
    await closeAndRepeat(f, run.id);
  });

  it("(4) closes the hold of a job failed on its last try once its run waits for review", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () => loseLastTry(run.id).then(() => undefined);
    await drive(f, run.id);
    expect((await runRow(run.id)).state).toBe("processing");
    await expectLeftOpen(run.id);
    await closeAndRepeat(f, run.id);
    expect(await runRow(run.id)).toMatchObject({
      state: "needs_input",
      last_error: "provider_outcome_unresolved",
    });
    // AC-6: the attempt stays unresolved, so the retry rules still refuse a new paid call.
    await expect(
      retryRun(db, f.ctx, run.id, randomUUID(), { provider: f.provider, job: f.job }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(f.provider.calls).toBe(1);
  });

  it("(5) AC-14: closes the hold of a run whose ended job was purged and pointer set null", async () => {
    const f = await fixture();
    const run = await f.start();
    let jobId = "";
    f.provider.beforeResult = async () => {
      jobId = await loseLastTry(run.id);
    };
    await drive(f, run.id);
    // The real chain: the job ended (swept, failed), the purge deletes it after retention, and
    // the foreign key sets the run's pointer null; the run is left processing with its hold open.
    // Only this job is old enough for the purge's bound.
    await db
      .updateTable("plt.job")
      .set({ finished_at: new Date("2000-01-01T00:00:00Z") })
      .where("id", "=", jobId)
      .execute();
    expect(await purgeFinishedJobs(db, new Date("2000-01-02T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect(
      await db.selectFrom("plt.job").select("id").where("id", "=", jobId).executeTakeFirst(),
    ).toBeUndefined();
    expect(await runRow(run.id)).toMatchObject({ state: "processing", job_id: null });
    await expectLeftOpen(run.id);
    // A run without a job is not closed by the run reconciliation (unchanged), but its hold is.
    await closeAndRepeat(f, run.id);
  });

  it("(6) closes nothing without the reconciliation job's authority, nor a live job's attempt", async () => {
    const f = await fixture();
    const run = await f.start();
    const live = await reconcileJob();
    let duringDispatch: { closed: number; unowned: number } | undefined;
    f.provider.beforeResult = async () => {
      // A live job with a valid lease owns its attempt: never closed, never counted.
      duringDispatch = {
        closed: await closeUnownedProviderHolds(live.job, { userId: f.ctx.userId }),
        unowned: (await providerHoldReconcileCounts(db, new Date(0), { userId: f.ctx.userId }))
          .unownedOpen,
      };
      await cancelRun(db, f.ctx, run.id);
    };
    await drive(f, run.id);
    expect(duringDispatch).toEqual({ closed: 0, unowned: 0 });
    await completeJob(db, live.claim, new Date());
    const attempt = await expectLeftOpen(run.id);
    // A hold from a month ago changes nothing about any job's authority.
    const monthAgo = new Date(Date.now() - 32 * 86_400_000);
    await db
      .updateTable("quota.cost_hold")
      .set({ created_at: monthAgo })
      .where("id", "=", attempt.holdId)
      .execute();
    expect(
      (await providerHoldReconcileCounts(db, new Date(0), { userId: f.ctx.userId })).unownedOpen,
    ).toBe(1);

    // Without a job (the earlier callers): no default authority, nothing closed.
    await reconcileEndedJobRuns(db, new Date(), { userId: f.ctx.userId });
    await expectLeftOpen(run.id);
    // A claim whose lease ran out, and a claim that was completed: refused before any write.
    const expired = await reconcileJob();
    await db
      .updateTable("plt.job")
      .set({ lease_until: new Date(Date.now() - 1000) })
      .where("id", "=", expired.claim.id)
      .execute();
    await expect(reconcile(expired.job, f.ctx.userId)).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    const finished = await reconcileJob();
    expect(await completeJob(db, finished.claim, new Date())).toBe(true);
    await expect(reconcile(finished.job, f.ctx.userId)).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    // A context without a lease is refused too.
    const { lease: _lease, ...unleased } = (await reconcileJob()).job;
    await expect(
      closeUnownedProviderHolds(unleased, { userId: f.ctx.userId }),
    ).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    await expectLeftOpen(run.id);
    expect([...expired.logs, ...finished.logs]).toEqual([]);
  });

  it("(7) two concurrent reconciliations write one row and one close", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () => cancelRun(db, f.ctx, run.id).then(() => undefined);
    await drive(f, run.id);
    await expectLeftOpen(run.id);
    const [a, b] = [await reconcileJob(), await reconcileJob()];
    const closedFrom = new Date();
    const counts = await Promise.all([
      closeUnownedProviderHolds(a.job, { userId: f.ctx.userId }),
      closeUnownedProviderHolds(b.job, { userId: f.ctx.userId }),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    await expectClosedConservatively(run.id, closedFrom);
    // Again, one after the other: nothing more, and zero closes are never reported as one.
    expect(await closeUnownedProviderHolds(a.job, { userId: f.ctx.userId })).toBe(0);
    expect(await closeUnownedProviderHolds(b.job, { userId: f.ctx.userId })).toBe(0);
    expect((await ledger(run.id)).costs).toHaveLength(1);
    await completeJob(db, a.claim, new Date());
    await completeJob(db, b.claim, new Date());
  });

  it("(8) recognises a conservative close only from all three parts of the same attempt", async () => {
    const f = await fixture();
    const run = await f.start();
    const extra = async (name: string) => {
      const operationKey = `${run.id}:${name}:1`;
      const { reservation_id: reservationId } = await db
        .selectFrom("proc.processing_run")
        .select("reservation_id")
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow();
      const hold = await db.transaction().execute((tx) =>
        beginProviderStep(tx, f.ctx, {
          sessionId: f.session.id,
          reservationId,
          operationKey,
          maximumMicros: 10,
          currency: "USD",
        }),
      );
      const attempt = await db
        .insertInto("proc.provider_attempt")
        .values({
          run_id: run.id,
          user_id: f.ctx.userId,
          step: name,
          attempt: 1,
          operation_key: operationKey,
          hold_id: hold.id,
          provider: "synthetic",
          model: "synthetic/llm",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const settle = (actualMicros: number | null, estimated: number | null, attemptId?: string) =>
        db.transaction().execute((tx) =>
          finishProviderStep(tx, f.ctx, hold.id, {
            operationKey,
            provider: "synthetic",
            model: "synthetic/llm",
            currency: "USD",
            actualMicros,
            estimatedMicros: estimated,
            priceVersion: null,
            usage: {},
            runId: run.id,
            ...(attemptId ? { attemptId } : {}),
          }),
        );
      return { id: attempt.id, settle };
    };
    const ids: Record<string, string> = {};
    f.provider.beforeResult = async () => {
      // An ordinary estimated settle with the conservative row's very amount and usage.
      const estimated = await extra("synthetic_estimated");
      await estimated.settle(null, 10, estimated.id);
      await db
        .updateTable("proc.provider_attempt")
        .set({ state: "succeeded" })
        .where("id", "=", estimated.id)
        .execute();
      // A definite failure, at its own cost.
      const failure = await extra("synthetic_failure");
      await failure.settle(1, null, failure.id);
      await db
        .updateTable("proc.provider_attempt")
        .set({ state: "failed" })
        .where("id", "=", failure.id)
        .execute();
      // A hold closed without a row of its own attempt.
      const orphan = await extra("synthetic_orphan");
      await orphan.settle(null, 10);
      // A hold still open.
      const open = await extra("synthetic_open");
      Object.assign(ids, {
        estimated: estimated.id,
        failure: failure.id,
        orphan: orphan.id,
        open: open.id,
      });
      await cancelRun(db, f.ctx, run.id);
    };
    await drive(f, run.id);
    const named = async () => {
      const facts = await providerAttemptFacts(db, {
        userId: f.ctx.userId,
        startedSince: new Date(0),
      });
      return {
        conservative: facts
          .filter(isConservativelyClosedAttempt)
          .map((row) => row.attemptId)
          .sort(),
        unowned: facts
          .filter(isUnownedOpenAttempt)
          .map((row) => row.attemptId)
          .sort(),
      };
    };
    const main = (await ledger(run.id)).attempts.find((row) =>
      row.operationKey.includes(":knowledge"),
    );
    if (!main) throw new Error("Expected the knowledge attempt");
    expect(await named()).toEqual({ conservative: [], unowned: [main.id, ids.open].sort() });

    const { job, claim } = await reconcileJob();
    await reconcile(job, f.ctx.userId);
    const after = await named();
    // Only the three-part records: neither the estimated settle, the failure nor the orphan.
    expect(after).toEqual({ conservative: [main.id, ids.open].sort(), unowned: [] });
    const counts = await providerHoldReconcileCounts(db, new Date(0), { userId: f.ctx.userId });
    expect(counts).toEqual({ conservativelyClosed: 2, unownedOpen: 0 });
    // A second pass and a late settle keep the same records and labels.
    await reconcile(job, f.ctx.userId);
    expect(await lateSettle(f, run.id, main)).toBe("conservative_kept");
    expect(await named()).toEqual(after);
    const rows = (await ledger(run.id)).costs;
    expect(rows.filter((row) => row.attemptId === main.id)).toHaveLength(1);
    expect(rows.filter((row) => row.attemptId === ids.open)).toHaveLength(1);
    await completeJob(db, claim, new Date());
  });

  it("(9) dates the row at a hold from an earlier month: each limit counts it once, the close time kept", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () => cancelRun(db, f.ctx, run.id).then(() => undefined);
    await drive(f, run.id);
    const open = await expectLeftOpen(run.id);
    const now = new Date();
    const holdTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
    await db
      .updateTable("quota.cost_hold")
      .set({ created_at: holdTime })
      .where("id", "=", open.holdId)
      .execute();
    const totals = (at: Date) =>
      db.transaction().execute((tx) => spendTotals(tx, f.ctx, f.session.id, "USD", at));
    const before = { atHold: await totals(holdTime), now: await totals(new Date()) };

    const { job, claim, logs } = await reconcileJob();
    const closedFrom = new Date();
    await reconcile(job, f.ctx.userId);
    const attempt = await expectClosedConservatively(run.id, closedFrom);
    expect(attempt.holdCreatedAt).toEqual(holdTime);
    // The real time of the close is the hold's closed_at, in this month, and the log line's age.
    expect((attempt.closedAt as Date).getTime()).toBeGreaterThan(holdTime.getTime());
    const line = logs.find((entry) => entry.event === "provider_hold_closed_conservatively");
    expect(Number(line?.fields.age_ms)).toBeGreaterThanOrEqual(
      closedFrom.getTime() - holdTime.getTime() - 1000,
    );
    // Each limit counts the attempt once, in the hold's own month: not the hold and the row
    // together, and not again in the month of the close.
    const after = { atHold: await totals(holdTime), now: await totals(new Date()) };
    expect(after.atHold.session).toBe(before.atHold.session);
    expect(after.atHold.userMonth).toBe(before.atHold.userMonth);
    expect(after.now.session).toBe(before.now.session);
    expect(after.now.userMonth).toBe(before.now.userMonth);
    expect(before.atHold.userMonth).toBeGreaterThanOrEqual(attempt.maximum);
    await completeJob(db, claim, new Date());
  });
});

const REFUSED_AFTER_CLOSE = "provider_result_refused_after_conservative_close";
/** The run's checkpoints of its attempts' own steps: a refused worker saves none. */
async function attemptCheckpoints(runId: string) {
  return db
    .selectFrom("proc.run_step as s")
    .innerJoin("proc.provider_attempt as a", (join) =>
      join.onRef("a.run_id", "=", "s.run_id").onRef("a.step", "=", "s.step"),
    )
    .select("s.step")
    .where("s.run_id", "=", runId)
    .execute();
}
/**
 * R2-P1201-01 (AC-4 point 2): the real worker path. The worker's job is really claimed and its
 * provider call is held in dispatch; meanwhile its authority ends and an independent, really
 * claimed reconciliation job closes the attempt's hold at its maximum; only then does the
 * provider answer. The worker commits nothing and says so, apart from a plain lost lease.
 */
async function refusedAfterClose(endAuthority: (f: Fixture, runId: string) => Promise<unknown>) {
  const f = await fixture();
  const run = await f.start();
  const worker: Logged[] = [];
  let reconciler: Awaited<ReturnType<typeof reconcileJob>> | undefined;
  const close = async () => {
    await endAuthority(f, run.id);
    reconciler = await reconcileJob();
    await reconcile(reconciler.job, f.ctx.userId);
    await completeJob(db, reconciler.claim, new Date());
  };
  return { f, run, worker, close, reconciler: () => reconciler };
}
/** What every refused late result leaves: one conservative row, the attempt as it was, no output. */
async function expectRefusedAfterClose(
  ctx: { f: Fixture; run: { id: string }; worker: Logged[] },
  result: "response" | "failure" | "unknown",
  requestId: string | undefined,
) {
  const { f, run, worker } = ctx;
  expect(f.provider.calls).toBe(1);
  const attempt = await expectClosedConservatively(run.id, new Date(0));
  expect(await attemptCheckpoints(run.id)).toEqual([]);
  // The plain trace of the refused result stays as it was, and the distinct one follows it.
  const events = worker.map((line) => line.event);
  expect(events).toContain("provider_result_not_committed");
  const refused = worker.filter((line) => line.event === REFUSED_AFTER_CLOSE);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ level: "warn" });
  expect(refused[0]?.fields).toEqual({
    module: "proc",
    job_id: expect.any(String),
    attempt: expect.any(Number),
    code: "hold_closed_at_maximum",
    cause: "job_lease_lost",
    result,
    reason: attempt.operationKey,
    request_id: requestId,
  });
  expect(events.indexOf("provider_result_not_committed")).toBeLessThan(
    events.indexOf(REFUSED_AFTER_CLOSE),
  );
  // It reports no commit: neither the generic late-settle line nor any other settle of the worker.
  expect(events).not.toContain("provider_late_settle_kept_conservative");
  // Identifiers only: no user, session or output in the worker's lines.
  const written = JSON.stringify(worker);
  expect(written).not.toContain(f.ctx.userId);
  expect(written).not.toContain(f.session.id);
  expect(written).not.toContain("A synthetic class example.");
  expect(written).not.toContain("Present perfect");
  return attempt;
}

describe("a provider result refused after the conservative close is told apart (P12-01, R2-P1201-01)", () => {
  it("a valid response that returns after the run was cancelled and its hold closed", async () => {
    const t = await refusedAfterClose((f, runId) => cancelRun(db, f.ctx, runId));
    t.f.provider.beforeResult = t.close;
    await drive(t.f, t.run.id, t.worker);
    expect(t.reconciler()).toBeDefined();
    expect((await runRow(t.run.id)).state).toBe("cancelled");
    await expectRefusedAfterClose(t, "response", "synthetic-generation");
  });

  it("a valid response that returns after the job failed on its last try and its hold closed", async () => {
    const t = await refusedAfterClose((_f, runId) => loseLastTry(runId));
    t.f.provider.beforeResult = t.close;
    await drive(t.f, t.run.id, t.worker);
    expect(await runRow(t.run.id)).toMatchObject({
      state: "needs_input",
      last_error: "provider_outcome_unresolved",
    });
    await expectRefusedAfterClose(t, "response", "synthetic-generation");
  });

  it("a definite provider failure that returns after the close", async () => {
    const t = await refusedAfterClose((f, runId) => cancelRun(db, f.ctx, runId));
    t.f.provider.beforeResult = async () => {
      await t.close();
      throw new ProviderError("provider_http_400", false, false);
    };
    await drive(t.f, t.run.id, t.worker);
    await expectRefusedAfterClose(t, "failure", undefined);
  });

  it("an unknown provider outcome that returns after the close", async () => {
    const t = await refusedAfterClose((f, runId) => cancelRun(db, f.ctx, runId));
    t.f.provider.beforeResult = async () => {
      await t.close();
      throw new Error("Synthetic transport failure");
    };
    await drive(t.f, t.run.id, t.worker);
    await expectRefusedAfterClose(t, "unknown", undefined);
  });

  it("a plain lost lease, without a conservative close, never takes that label", async () => {
    // The response and the failure path, each refused with no close at all.
    for (const fail of [false, true]) {
      const f = await fixture();
      const run = await f.start();
      const worker: Logged[] = [];
      f.provider.beforeResult = async () => {
        await cancelRun(db, f.ctx, run.id);
        if (fail) throw new ProviderError("provider_http_400", false, false);
      };
      await drive(f, run.id, worker);
      await expectLeftOpen(run.id);
      expect(worker.map((line) => line.event)).toContain("provider_result_not_committed");
      expect(worker.map((line) => line.event)).not.toContain(REFUSED_AFTER_CLOSE);
      // Closed afterwards: the worker's lines stay as they were.
      const before = [...worker];
      await closeAndRepeat(f, run.id);
      expect(worker).toEqual(before);
    }
    // A lost lease while a reconciliation without authority tried, and failed, to close the hold:
    // the hold stays open, so the worker's refusal stays a plain lost lease.
    const f = await fixture();
    const run = await f.start();
    const worker: Logged[] = [];
    let refusal: unknown;
    f.provider.beforeResult = async () => {
      await cancelRun(db, f.ctx, run.id);
      const expired = await reconcileJob();
      await db
        .updateTable("plt.job")
        .set({ lease_until: new Date(Date.now() - 1000) })
        .where("id", "=", expired.claim.id)
        .execute();
      refusal = await reconcile(expired.job, f.ctx.userId).then(
        () => "closed",
        (error: unknown) => (error instanceof Error ? error.name : error),
      );
    };
    await drive(f, run.id, worker);
    expect(refusal).toBe("JobLeaseLost");
    await expectLeftOpen(run.id);
    expect(worker.map((line) => line.event)).toContain("provider_result_not_committed");
    expect(worker.map((line) => line.event)).not.toContain(REFUSED_AFTER_CLOSE);
  });
});

/**
 * R2-P1201-02: one processing job, really claimed on a queue kind of its own (made due now), with
 * its real lease and no test-only mark. With `asProcessing`, the claimed job takes its real kind
 * back at once, as in production: a running job is never claimed again, and its record is what
 * the singleton key and PLT's own read see.
 */
async function claimProcessingJob(
  f: Fixture,
  jobId: string,
  options: { deadline?: Date; asProcessing?: boolean } = {},
) {
  const kind = `proc.synthetic_${randomUUID().replaceAll("-", "")}`;
  await db
    .updateTable("plt.job")
    .set({ kind, run_at: new Date(Date.now() - 1000) })
    .where("id", "=", jobId)
    .execute();
  const [claim] = await claimJobs(db, [kind], 1, new Date());
  if (!claim || claim.id !== jobId || claim.generation === undefined)
    throw new Error("Expected a claim of the job");
  if (options.asProcessing)
    await db.updateTable("plt.job").set({ kind: f.job.kind }).where("id", "=", jobId).execute();
  const context: JobContext = {
    db,
    now: () => new Date(),
    job: { id: claim.id, attempt: claim.attempt },
    lease: { id: claim.id, token: claim.token, generation: claim.generation },
    step: (name, effect) => runJobStep(db, claim, name, effect, new Date()),
    ...(options.deadline ? { deadline: options.deadline } : {}),
  };
  const run = () => f.job.run(f.job.payload.parse(claim.payload), context);
  return { claim, context, run };
}
const jobRow = (jobId: string) =>
  db
    .selectFrom("plt.job")
    .select(["state", "kind"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();

describe("a live continuation keeps its hold although older code left the pointer null (P12-01, R2-P1201-02)", () => {
  it("closes nothing while the continuation's lease is valid, and its own settle stays the normal one", async () => {
    const f = await fixture();
    const run = await f.start();
    const { job_id: first } = await runRow(run.id);
    if (!first) throw new Error("Expected the run's first job");

    // J, really claimed, has no time left for a lesson call: it creates its continuation J2 and
    // puts the pointer on it, then stops before it completes (its lease ends, the sweep retries it).
    const j = await claimProcessingJob(f, first, { deadline: new Date(Date.now() + 1000) });
    await j.run();
    const { job_id: second } = await runRow(run.id);
    if (!second || second === first) throw new Error("Expected the continuation on the pointer");
    expect(await jobRow(second)).toEqual({ state: "queued", kind: f.job.kind });
    expect(f.provider.calls).toBe(0);
    await db
      .updateTable("plt.job")
      .set({ lease_until: new Date(Date.now() - 60_000) })
      .where("id", "=", first)
      .execute();
    await sweepJobs(db, new Date());
    expect((await jobRow(first)).state).toBe("retry_scheduled");

    // J2, really claimed with its real kind back, holds its paid call in dispatch.
    const j2 = await claimProcessingJob(f, second, { asProcessing: true });
    const reconciler: Logged[] = [];
    let during:
      | {
          closed: number;
          ranOnce: number;
          counts: { conservativelyClosed: number; unownedOpen: number };
        }
      | undefined;
    f.provider.beforeResult = async () => {
      f.provider.beforeResult = undefined;
      const open = await expectLeftOpen(run.id);
      // J's retry, really claimed: the pointer names J2, so J does not own the run and stands
      // aside (AC-15, AC-17): no next job, the pointer kept, never null. J then completes.
      const retry = await claimProcessingJob(f, first, { deadline: new Date(Date.now() + 1000) });
      expect(retry.claim.attempt).toBe(2);
      await retry.run();
      expect(await completeJob(db, retry.claim, new Date())).toBe(true);
      expect(await runRow(run.id)).toMatchObject({ state: "processing", job_id: second });
      // Data older code left (C11-77): that retry wrote a null pointer while J2 still ran its paid
      // call. No code writes one now; the row is set here as that legacy data.
      await db
        .updateTable("proc.processing_run")
        .set({ job_id: null })
        .where("id", "=", run.id)
        .execute();
      expect(await jobRow(second)).toEqual({ state: "running", kind: f.job.kind });
      expect(await jobRow(first)).toMatchObject({ state: "succeeded" });

      // An independent reconciliation, really claimed, in this very order: with J2's lease
      // valid, no financial close, the hold open and no conservative row.
      const { job, claim, logs } = await reconcileJob();
      const ranOnce = await reconcile(job, f.ctx.userId);
      const closed = await closeUnownedProviderHolds(job, { userId: f.ctx.userId });
      reconciler.push(...logs);
      const [facts] = await providerAttemptFacts(db, { attemptId: open.id });
      expect(facts).toMatchObject({ attemptState: "started", holdClosed: false });
      expect(facts?.jobState).toBe("running");
      expect(facts && isUnownedOpenAttempt(facts)).toBe(false);
      during = {
        ranOnce,
        closed,
        counts: await providerHoldReconcileCounts(db, new Date(0), { userId: f.ctx.userId }),
      };
      await expectLeftOpen(run.id);
      expect(await completeJob(db, claim, new Date())).toBe(true);
    };
    await j2.run();
    expect(f.provider.calls).toBeGreaterThanOrEqual(1);
    expect(during).toEqual({
      ranOnce: 0,
      closed: 0,
      counts: { conservativelyClosed: 0, unownedOpen: 0 },
    });
    expect(reconciler.map((line) => line.event)).not.toContain(
      "provider_hold_closed_conservatively",
    );

    // J2's authorised answer settles through the normal path: the real amount, the attempt
    // resolved, never the conservative record.
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
    const { attempts, costs } = await ledger(run.id);
    const attempt = attempts[0];
    if (!attempt) throw new Error("Expected J2's attempt");
    expect(attempt.state).toBe("succeeded");
    expect(attempt.closedAt).not.toBeNull();
    expect(costs.filter((row) => row.attemptId === attempt.id)).toEqual([
      expect.objectContaining({ attemptId: attempt.id, amount: 1 }),
    ]);
    const [after] = await providerAttemptFacts(db, { attemptId: attempt.id });
    expect(after).toBeUndefined();
    expect(await providerHoldReconcileCounts(db, new Date(0), { userId: f.ctx.userId })).toEqual({
      conservativelyClosed: 0,
      unownedOpen: 0,
    });
  });
});
