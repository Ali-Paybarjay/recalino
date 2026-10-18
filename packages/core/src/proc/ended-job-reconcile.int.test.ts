import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { DEFAULT_PLT_SETTINGS, learnerNotifications, sweepJobs } from "../plt";
import { amounts, grantEntitlement, reservationIsOpen, reserveAllowance } from "../quota";
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
      .orderBy("id")
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
