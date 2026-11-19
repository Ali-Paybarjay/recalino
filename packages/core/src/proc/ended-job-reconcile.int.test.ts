import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import {
  claimJobs,
  completeJob,
  DEFAULT_PLT_SETTINGS,
  learnerNotifications,
  sweepJobs,
} from "../plt";
import {
  amounts,
  beginProviderStep,
  configureCostPolicy,
  grantEntitlement,
  reservationIsOpen,
  reserveAllowance,
} from "../quota";
import { ENDED_JOB_RUN_ERROR, reconcileEndedJobRuns } from "./maintenance";
import { recordProcessingNotification } from "./notifications";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

/** A synthetic class run holding a real reservation, with its job in the given state. */
async function stuckRun(jobState: "running" | "queued") {
  const x = await studyFixture(db);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3_600_000),
    amounts: amounts({ audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic ended-job reconciliation tests",
  });
  const hold = await db
    .transaction()
    .execute((tx) => reserveAllowance(tx, x.ctx, randomUUID(), amounts({ audio: 4 })));
  const past = new Date(Date.now() - 600_000);
  const job = await db
    .insertInto("plt.job")
    .values({
      kind: "proc.synthetic_ended_job",
      payload: JSON.stringify({ runId: randomUUID(), userId: x.ctx.userId }),
      payload_version: 1,
      state: jobState,
      attempt: DEFAULT_PLT_SETTINGS.jobs.maxAttempts,
      max_attempts: DEFAULT_PLT_SETTINGS.jobs.maxAttempts,
      lease_seconds: DEFAULT_PLT_SETTINGS.jobs.leaseSeconds,
      lease_token: jobState === "running" ? randomUUID() : null,
      // The function was stopped at its limit: its lease ran out on the last attempt.
      lease_until: jobState === "running" ? past : null,
      retry_base_seconds: 30,
      retry_max_seconds: 3600,
      run_at: past,
      created_at: past,
      updated_at: past,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const run = await db
    .insertInto("proc.processing_run")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      operation_key: randomUUID(),
      request_hash: "synthetic-ended-job",
      sources_version: 0,
      source_fingerprint: "a".repeat(64),
      input_snapshot: "{}",
      settings: "{}",
      requested_amounts: JSON.stringify(amounts({ audio: 4 })),
      reservation_id: hold.id,
      state: "processing",
      job_id: job.id,
      created_at: past,
      updated_at: past,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { ...x, holdId: hold.id, jobId: job.id, runId: run.id };
}
const ledger = async (reservationId: string) =>
  (
    await db
      .selectFrom("quota.ledger")
      .select(["kind", "amount"])
      .where("reservation_id", "=", reservationId)
      // ids are random; order by time, and put a reserve before a release written in the same instant.
      .orderBy("created_at")
      .orderBy("kind", "desc")
      .execute()
  ).map((row) => ({ kind: row.kind, amount: Number(row.amount) }));

// PRD-02, PRD-COST-02: a job failed by the sweep after its last lease never strands its run.
it("closes a run whose job lease expired on its last attempt, releases its hold and notifies once", async () => {
  const x = await stuckRun("running");
  await sweepJobs(db, new Date());
  const job = await db
    .selectFrom("plt.job")
    .select(["state", "last_error"])
    .where("id", "=", x.jobId)
    .executeTakeFirstOrThrow();
  expect(job).toEqual({ state: "failed", last_error: "lease_expired" });

  const now = new Date();
  const options = { userId: x.ctx.userId, afterClose: recordProcessingNotification };
  expect(await reconcileEndedJobRuns(db, now, options)).toBe(1);
  const run = await db
    .selectFrom("proc.processing_run")
    .select(["state", "last_error", "finished_at"])
    .where("id", "=", x.runId)
    .executeTakeFirstOrThrow();
  expect(run.state).toBe("failed");
  expect(run.last_error).toBe(ENDED_JOB_RUN_ERROR);
  expect(run.finished_at).toBeTruthy();
  expect(await reservationIsOpen(db, x.ctx, x.holdId)).toBe(false);
  // Only a release: nothing is charged for unpublished work.
  expect(await ledger(x.holdId)).toEqual([
    { kind: "reserve", amount: 4 },
    { kind: "release", amount: 4 },
  ]);
  const notifications = (await learnerNotifications(db, x.ctx)).items;
  expect(notifications.map((item) => item.kind)).toEqual(["processing_failed"]);

  // Idempotent: another period changes nothing and releases nothing twice.
  expect(await reconcileEndedJobRuns(db, new Date(), options)).toBe(0);
  expect(await ledger(x.holdId)).toHaveLength(2);
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(1);

  // The session no longer has an active run, so createProcessingRun's conflict is gone.
  const active = await db
    .selectFrom("proc.processing_run")
    .select("id")
    .where("session_id", "=", x.session.id)
    .where("state", "in", ["awaiting_upload", "queued", "processing"])
    .execute();
  expect(active).toEqual([]);
});

it("waits for the operator when a provider request was still in flight", async () => {
  const x = await stuckRun("running");
  await db
    .insertInto("proc.provider_attempt")
    .values({
      run_id: x.runId,
      user_id: x.ctx.userId,
      step: "synthetic",
      attempt: 1,
      operation_key: randomUUID(),
      hold_id: randomUUID(),
      provider: "synthetic",
      model: "synthetic/llm",
    })
    .execute();
  await sweepJobs(db, new Date());
  expect(await reconcileEndedJobRuns(db, new Date(), { userId: x.ctx.userId })).toBe(1);
  const run = await db
    .selectFrom("proc.processing_run")
    .select(["state", "last_error"])
    .where("id", "=", x.runId)
    .executeTakeFirstOrThrow();
  expect(run).toEqual({ state: "needs_input", last_error: "provider_outcome_unresolved" });
  expect(await reservationIsOpen(db, x.ctx, x.holdId)).toBe(false);
});

// P12-01 (AC-1, AC-2, AC-13): the reconciliation, run as a really claimed job, also closes the
// cost hold of the attempt left in flight, once, at the hold's maximum, dated at the hold's time;
// the attempt stays started. Without a job, the run is closed as before and the hold stays open.
it("closes the in-flight attempt's cost hold at its maximum under its own job's authority", async () => {
  const x = await stuckRun("running");
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
    { actorId: "synthetic-operator", reason: "Synthetic ended-job reconciliation tests" },
  );
  const operationKey = `${x.runId}:synthetic:1`;
  const hold = await db.transaction().execute((tx) =>
    beginProviderStep(tx, x.ctx, {
      sessionId: x.session.id,
      reservationId: x.holdId,
      operationKey,
      maximumMicros: 25,
      currency: "USD",
    }),
  );
  const attempt = await db
    .insertInto("proc.provider_attempt")
    .values({
      run_id: x.runId,
      user_id: x.ctx.userId,
      step: "synthetic",
      attempt: 1,
      operation_key: operationKey,
      hold_id: hold.id,
      provider: "synthetic",
      model: "synthetic/llm",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await sweepJobs(db, new Date());
  const costHold = () =>
    db
      .selectFrom("quota.cost_hold")
      .select(["created_at", "closed_at"])
      .where("id", "=", hold.id)
      .executeTakeFirstOrThrow();
  const costs = () =>
    db
      .selectFrom("quota.provider_cost")
      .select(["attempt_id", "amount_micros", "estimated_micros", "created_at"])
      .where("operation_key", "=", operationKey)
      .execute();

  // A caller without a job: the run closes as before; no cost hold is closed.
  expect(await reconcileEndedJobRuns(db, new Date(), { userId: x.ctx.userId })).toBe(1);
  expect((await costHold()).closed_at).toBeNull();
  expect(await costs()).toEqual([]);

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
  const job = {
    db,
    now: () => new Date(),
    job: { id: claim.id, attempt: claim.attempt },
    lease: { id: claim.id, token: claim.token, generation: claim.generation },
  };
  const before = new Date();
  expect(await reconcileEndedJobRuns(db, new Date(), { userId: x.ctx.userId, job })).toBe(0);
  const closed = await costHold();
  expect(closed.closed_at).not.toBeNull();
  expect(new Date(closed.closed_at as Date).getTime()).toBeGreaterThanOrEqual(
    before.getTime() - 1000,
  );
  expect(
    (await costs()).map((row) => ({
      attemptId: row.attempt_id,
      amount: row.amount_micros,
      estimated: Number(row.estimated_micros),
      createdAt: new Date(row.created_at),
    })),
  ).toEqual([
    { attemptId: attempt.id, amount: null, estimated: 25, createdAt: new Date(closed.created_at) },
  ]);
  const state = await db
    .selectFrom("proc.provider_attempt")
    .select("state")
    .where("id", "=", attempt.id)
    .executeTakeFirstOrThrow();
  expect(state.state).toBe("started");
  // Idempotent: another period writes nothing more.
  await reconcileEndedJobRuns(db, new Date(), { userId: x.ctx.userId, job });
  expect(await costs()).toHaveLength(1);
  expect(await completeJob(db, claim, new Date())).toBe(true);
});

it("leaves a run whose job is still queued to that job", async () => {
  const x = await stuckRun("queued");
  expect(await reconcileEndedJobRuns(db, new Date(), { userId: x.ctx.userId })).toBe(0);
  const run = await db
    .selectFrom("proc.processing_run")
    .select("state")
    .where("id", "=", x.runId)
    .executeTakeFirstOrThrow();
  expect(run.state).toBe("processing");
  expect(await reservationIsOpen(db, x.ctx, x.holdId)).toBe(true);
});
