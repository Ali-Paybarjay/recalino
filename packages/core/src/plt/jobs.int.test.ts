import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LOCAL_POOLER_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Database, type Tx, withTransaction } from "../db";
import {
  assertJobAuthority,
  type ClaimedJob,
  cancelJob,
  claimJobs,
  completeJob,
  enqueueJob,
  ensurePeriodicJob,
  failJob,
  hasJobStep,
  JobCancelled,
  type JobDefinition,
  JobLeaseLost,
  jobLease,
  jobState,
  purgeFinishedJobs,
  renewJobLease,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "./jobs";
import { emptyPayload } from "./maintenance";
import { DEFAULT_PLT_SETTINGS } from "./settings";

// FR-PLT-005 on real Postgres. Scheduling times (run_at, backoff) are passed in; a lease runs on
// the database clock only (Recalino ADR-0004 rule 2), so a test ends a lease by moving its end on
// that clock (`leaseEndsIn`), and waits only where a real lock wait is the point. Every case runs
// on a direct connection and through Supavisor in transaction mode, as the cloud app connects.

const CONNECTIONS = {
  direct: testDatabaseUrl(),
  pooler:
    process.env.LOCAL_TEST_POOLER_DATABASE_URL !== undefined
      ? LOCAL_POOLER_DATABASE_URL
      : (process.env.POOLER_DATABASE_URL ?? LOCAL_POOLER_DATABASE_URL),
};
const T0 = new Date("2026-10-02T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const DEFAULTS = { ...DEFAULT_PLT_SETTINGS.jobs, retryBaseSeconds: 30, retryMaxSeconds: 3600 };
const payload = z.strictObject({ sessionId: z.uuid() });
const SESSION = "6f1c2c62-6f43-4c27-9a3e-2f6c0b8f1b55";

const kind = () => `test.k_${randomBytes(4).toString("hex")}`;

/** A job kind whose steps leave a visible effect: one audit row per step. */
function definition(
  run: JobDefinition<{ sessionId: string }>["run"],
  options: JobDefinition<unknown>["options"] = {},
): JobDefinition<{ sessionId: string }> {
  return { kind: kind(), version: 1, payload, options, run };
}

async function effect(tx: Tx, jobId: string, step: string) {
  await tx
    .insertInto("plt.audit_event")
    .values({
      actor_kind: "system",
      actor_id: "job-test",
      action: step,
      subject_type: "job",
      subject_id: jobId,
    })
    .execute();
}

async function effects(db: Database, jobId: string, step: string): Promise<number> {
  const row = await db
    .selectFrom("plt.audit_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("subject_id", "=", jobId)
    .where("action", "=", step)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Moves a job's lease end to `seconds` from now on the database clock, as if time had passed. */
async function leaseEndsIn(db: Database, jobId: string, seconds: number): Promise<void> {
  await sql`update plt.job set lease_until = statement_timestamp() + make_interval(secs => ${seconds})
    where id = ${jobId}`.execute(db);
}

/** Seconds left on a job's lease by the database clock; null without a lease. */
async function leaseLeft(db: Database, jobId: string): Promise<number | null> {
  const result = await sql<{ left: number | null }>`
    select extract(epoch from lease_until - statement_timestamp())::float8 as "left"
    from plt.job where id = ${jobId}`.execute(db);
  const left = result.rows[0]?.left;
  return left === null || left === undefined ? null : Number(left);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Settles a promise into its value or its error at once, so a later rejection is never unhandled. */
const outcome = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

for (const [connection, url] of Object.entries(CONNECTIONS)) {
  describe(`FR-PLT-005 job queue — ${connection}`, () => {
    const db = createDatabase(url, { maxConnections: 2 });
    const second = createDatabase(url, { maxConnections: 2 });
    afterAll(async () => {
      await Promise.all([db.destroy(), second.destroy()]);
    });

    const enqueue = (def: JobDefinition<{ sessionId: string }>, now = T0) =>
      withTransaction(db, (tx) =>
        enqueueJob(tx, def, { payload: { sessionId: SESSION }, now, defaults: DEFAULTS }),
      );

    it("a rolled-back transaction leaves no job", async () => {
      const def = definition(async () => {});
      await expect(
        withTransaction(db, async (tx) => {
          await enqueueJob(tx, def, {
            payload: { sessionId: SESSION },
            now: T0,
            defaults: DEFAULTS,
          });
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      expect(await claimJobs(db, [def.kind], 10, at(1))).toEqual([]);
    });

    it("after a crash mid-step, the job runs again and each step's effect exists once", async () => {
      const def = definition(async (_payload, ctx) => {
        await ctx.step("transcribe", (tx) => effect(tx, jobId, "transcribe"));
        await ctx.step("notes", (tx) => effect(tx, jobId, "notes"));
      });
      const jobId = (await enqueue(def)) ?? "";
      const [first] = await claimJobs(db, [def.kind], 1, T0);
      expect(first?.id).toBe(jobId);
      if (!first) return;
      await runJobStep(db, first, "transcribe", (tx) => effect(tx, jobId, "transcribe"), T0);
      // The runner dies here. Until its lease ends on the database clock, nobody else takes the
      // job, whatever time the caller passes (ADR-0004 rule 2; the sweep is global, so this job's
      // state is what is checked).
      await sweepJobs(db, at(DEFAULTS.leaseSeconds + 1));
      expect(await jobState(db, jobId)).toBe("running");
      expect(await claimJobs(db, [def.kind], 1, at(DEFAULTS.leaseSeconds + 1))).toEqual([]);

      await leaseEndsIn(db, jobId, -1);
      const later = at(DEFAULTS.leaseSeconds + 1);
      const summary = await runDueJobs(db, [def], { deadline: at(3600), now: () => later });
      expect(summary).toMatchObject({ succeeded: 1 });
      expect(summary.swept).toBeGreaterThanOrEqual(1);
      expect(await completeJob(db, first, later)).toBe(false); // the dead runner's claim is void
      expect(await jobState(db, jobId)).toBe("succeeded");
      expect(await effects(db, jobId, "transcribe")).toBe(1);
      expect(await effects(db, jobId, "notes")).toBe(1);
    });

    it("rule 5: only the live claim renews its lease; a stopped runner's claim is taken over", async () => {
      const def = definition(async () => {});
      const jobId = (await enqueue(def)) ?? "";
      const [claim] = await claimJobs(db, [def.kind], 1, T0);
      if (!claim) throw new Error("job not claimed");
      expect(claim.leaseSeconds).toBe(DEFAULTS.leaseSeconds);
      // ADR-0004 rule 2: renewing moves the lease end a full lease past the database clock,
      // whatever time the caller passes, so a live runner keeps the job.
      await leaseEndsIn(db, jobId, 5);
      expect(await renewJobLease(db, claim, at(-3600))).toBe(true);
      expect(await leaseLeft(db, jobId)).toBeGreaterThan(DEFAULTS.leaseSeconds - 5);
      await sweepJobs(db, at(2 * DEFAULTS.leaseSeconds));
      expect(await jobState(db, jobId)).toBe("running");
      // The runner stops renewing: once the lease ends the job is swept and claimed again.
      await leaseEndsIn(db, jobId, -1);
      const expired = at(2 * DEFAULTS.leaseSeconds);
      expect(await sweepJobs(db, expired)).toBeGreaterThanOrEqual(1);
      expect(await jobState(db, jobId)).toBe("retry_scheduled");
      const [again] = await claimJobs(db, [def.kind], 1, expired);
      expect(again?.id).toBe(jobId);
      if (!again) return;
      expect(await renewJobLease(db, claim, expired)).toBe(false); // the old claim is void
      expect(await renewJobLease(db, again, expired)).toBe(true);
      await cancelJob(db, jobId, expired);
      expect(await renewJobLease(db, again, expired)).toBe(false);
    });

    it("rule 5: a running handler's lease is renewed, and its context carries the runner's deadline", async () => {
      let clock = 0;
      const now = () => at(clock);
      const seen: { deadline?: Date; renewed?: boolean } = {};
      const def = definition(
        async (_payload, ctx) => {
          seen.deadline = ctx.deadline;
          const lease = async () =>
            (
              await db
                .selectFrom("plt.job")
                .select("lease_until")
                .where("id", "=", jobId)
                .executeTakeFirstOrThrow()
            ).lease_until?.getTime() ?? 0;
          const claimed = await lease();
          clock = 30; // the handler works on; renewals extend the lease on the database clock
          for (let tries = 0; tries < 200 && (await lease()) <= claimed; tries++)
            await new Promise((resolve) => setTimeout(resolve, 5));
          seen.renewed = (await lease()) > claimed;
        },
        { leaseSeconds: 60 },
      );
      const jobId = (await enqueue(def)) ?? "";
      // ADR-0004 rule 2 (P11-01 AC-4): a renewal unsettled within its period counts as lost, so
      // the period must leave room for a renewal's round trips (was 5 ms).
      const summary = await runDueJobs(db, [def], {
        deadline: at(10),
        finishBy: at(100),
        now,
        leaseRenewalMs: 100,
      });
      expect(summary).toMatchObject({ succeeded: 1 });
      expect(seen).toEqual({ deadline: at(100), renewed: true });
      const finished = await db
        .selectFrom("plt.job")
        .select(["state", "lease_until", "lease_token"])
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow();
      expect(finished).toEqual({ state: "succeeded", lease_until: null, lease_token: null });
    });

    it("two runners claiming at once: only one gets the job", async () => {
      const def = definition(async () => {});
      await enqueue(def);
      const [a, b] = await Promise.all([
        claimJobs(db, [def.kind], 1, at(1)),
        claimJobs(second, [def.kind], 1, at(1)),
      ]);
      expect(a.length + b.length).toBe(1);
    });

    it("a targeted wake runs its requested subject ahead of unrelated queued work without falling back", async () => {
      const target = { userId: randomUUID(), subjectId: randomUUID() };
      const seen: string[] = [];
      const def = {
        kind: kind(),
        version: 1,
        payload: z.strictObject({ userId: z.uuid(), subjectId: z.uuid() }),
        run: async (value: typeof target) => {
          seen.push(value.subjectId);
        },
      };
      const save = (value: typeof target, now = T0) =>
        withTransaction(db, (tx) =>
          enqueueJob(tx, def, { payload: value, now, defaults: DEFAULTS }),
        );
      const otherOwner = await save({ ...target, userId: randomUUID() });
      const otherSubject = await save({ ...target, subjectId: randomUUID() });
      const requested = await save(target, at(1));
      expect(
        await runDueJobs(db, [def], { target, now: () => at(2), deadline: at(10) }),
      ).toMatchObject({ succeeded: 1 });
      expect(seen).toEqual([target.subjectId]);
      expect(await jobState(db, requested ?? "")).toBe("succeeded");
      expect(await jobState(db, otherOwner ?? "")).toBe("queued");
      expect(await jobState(db, otherSubject ?? "")).toBe("queued");
      expect(
        await runDueJobs(db, [def], { target, now: () => at(2), deadline: at(10) }),
      ).toMatchObject({ succeeded: 0 });
      expect(
        await claimJobs(db, [def.kind], 1, at(2), { ...target, subjectId: randomUUID() }),
      ).toEqual([]);
      expect(await jobState(db, otherOwner ?? "")).toBe("queued");
      expect(await jobState(db, otherSubject ?? "")).toBe("queued");
    });

    it("concurrent targeted and general claims keep one lease per job and never substitute another target", async () => {
      const target = { userId: randomUUID(), subjectId: randomUUID() };
      const def = {
        kind: kind(),
        version: 1,
        payload: z.strictObject({ userId: z.uuid(), subjectId: z.uuid() }),
        run: async () => {},
      };
      const save = (value: typeof target, now: Date) =>
        withTransaction(db, (tx) =>
          enqueueJob(tx, def, { payload: value, now, defaults: DEFAULTS }),
        );
      const unrelated = await save({ ...target, subjectId: randomUUID() }, T0);
      const requested = await save(target, at(1));
      const [a, b, general] = await Promise.all([
        claimJobs(db, [def.kind], 1, at(2), target),
        claimJobs(second, [def.kind], 1, at(2), target),
        claimJobs(db, [def.kind], 1, at(2)),
      ]);
      expect([...a, ...b].map((job) => job.id)).toEqual([requested]);
      expect(general.map((job) => job.id)).toEqual([unrelated]);
      expect(await claimJobs(second, [def.kind], 1, at(2), target)).toEqual([]);
    });

    it("a targeted wake respects retry due times and cancellation while unrelated work stays queued", async () => {
      const target = { userId: randomUUID(), subjectId: randomUUID() };
      let attempts = 0;
      const def = {
        kind: kind(),
        version: 1,
        payload: z.strictObject({ userId: z.uuid(), subjectId: z.uuid() }),
        run: async () => {
          if (++attempts === 1) throw new Error("Synthetic retryable failure");
        },
      };
      const save = (value: typeof target) =>
        withTransaction(db, (tx) =>
          enqueueJob(tx, def, { payload: value, now: T0, defaults: DEFAULTS }),
        );
      const unrelated = await save({ ...target, subjectId: randomUUID() });
      const requested = await save(target);
      const run = (seconds: number) =>
        runDueJobs(db, [def], { target, now: () => at(seconds), deadline: at(seconds + 1) });
      expect(await run(0)).toMatchObject({ retried: 1 });
      expect(await run(29)).toMatchObject({ retried: 0, succeeded: 0 });
      expect(attempts).toBe(1);
      expect(await jobState(db, unrelated ?? "")).toBe("queued");
      await cancelJob(db, requested ?? "", at(29));
      expect(await run(30)).toMatchObject({ succeeded: 0 });
      expect(attempts).toBe(1);
      expect(await jobState(db, unrelated ?? "")).toBe("queued");
    });

    it("a job that always fails retries with a growing delay, then fails with its reason", async () => {
      const def = definition(
        async () => {
          throw new Error("provider down");
        },
        { maxAttempts: 3 },
      );
      const jobId = (await enqueue(def)) ?? "";
      const run = (seconds: number) =>
        runDueJobs(db, [def], { deadline: at(seconds + 1), now: () => at(seconds) });

      expect(await run(0)).toMatchObject({ retried: 1 });
      expect(await run(29)).toMatchObject({ retried: 0, failed: 0 }); // first retry waits 30 s
      expect(await run(30)).toMatchObject({ retried: 1 });
      expect(await run(89)).toMatchObject({ retried: 0, failed: 0 }); // second waits 60 s
      expect(await run(90)).toMatchObject({ failed: 1 });
      expect(await run(100_000)).toMatchObject({ failed: 0, succeeded: 0 });
      const row = await db
        .selectFrom("plt.job")
        .select(["state", "attempt", "last_error"])
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ state: "failed", attempt: 3, last_error: "handler_error" });
    });

    it("a cancelled job is never run, and a running one stops at its next step", async () => {
      const queued = definition(async (_payload, ctx) => {
        await ctx.step("never", async () => {});
      });
      const queuedId = (await enqueue(queued)) ?? "";
      await cancelJob(db, queuedId, at(1));
      expect(await runDueJobs(db, [queued], { deadline: at(10), now: () => at(2) })).toMatchObject({
        succeeded: 0,
        cancelled: 0,
      });
      expect(await jobState(db, queuedId)).toBe("cancelled");

      const running = definition(async (_payload, ctx) => {
        await ctx.step("first", (tx) => effect(tx, runningId, "first"));
        await cancelJob(db, runningId, at(3)); // e.g. the learner deletes the class meanwhile
        await ctx.step("second", (tx) => effect(tx, runningId, "second"));
      });
      const runningId = (await enqueue(running)) ?? "";
      expect(await runDueJobs(db, [running], { deadline: at(10), now: () => at(2) })).toMatchObject(
        { cancelled: 1, succeeded: 0 },
      );
      expect(await jobState(db, runningId)).toBe("cancelled");
      expect(await effects(db, runningId, "first")).toBe(1);
      expect(await effects(db, runningId, "second")).toBe(0);
    });

    it("a payload that doesn't match its definition fails at once and is recorded", async () => {
      const def = definition(async () => {});
      const row = await db
        .insertInto("plt.job")
        .values({
          kind: def.kind,
          payload: JSON.stringify({ sessionId: "not-a-uuid", transcript: "class text" }),
          payload_version: 1,
          max_attempts: 5,
          lease_seconds: 900,
          retry_base_seconds: 30,
          retry_max_seconds: 3600,
          run_at: T0,
          created_at: T0,
          updated_at: T0,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(await runDueJobs(db, [def], { deadline: at(10), now: () => at(1) })).toMatchObject({
        failed: 1,
      });
      const job = await db
        .selectFrom("plt.job")
        .select(["state", "last_error"])
        .where("id", "=", row.id)
        .executeTakeFirstOrThrow();
      expect(job).toEqual({ state: "failed", last_error: "payload_invalid" });
      const event = await db
        .selectFrom("plt.security_event")
        .select("kind")
        .where("route", "=", def.kind)
        .executeTakeFirst();
      expect(event?.kind).toBe("job_tampered");
    });

    it("a periodic job is added once per period", async () => {
      const periodic: JobDefinition<Record<string, never>> = {
        kind: kind(),
        version: 1,
        payload: emptyPayload,
        run: async () => {},
      };
      const first = await ensurePeriodicJob(db, periodic, 3600, T0, DEFAULTS);
      const again = await ensurePeriodicJob(db, periodic, 3600, at(1800), DEFAULTS);
      const next = await ensurePeriodicJob(db, periodic, 3600, at(3600), DEFAULTS);
      expect(first).not.toBeNull();
      expect(again).toBeNull();
      expect(next).not.toBeNull();
      expect(next).not.toBe(first);
    });

    it("finished jobs are purged after the retention period, with their steps", async () => {
      const def = definition(async (_payload, ctx) => {
        await ctx.step("only", async () => {});
      });
      const jobId = (await enqueue(def)) ?? "";
      await runDueJobs(db, [def], { deadline: at(10), now: () => at(1) });
      expect(await purgeFinishedJobs(db, at(0))).toBe(0);
      expect(await purgeFinishedJobs(db, at(2))).toBeGreaterThanOrEqual(1);
      expect(await jobState(db, jobId)).toBeNull();
      const steps = await db
        .selectFrom("plt.job_step")
        .select("step")
        .where("job_id", "=", jobId)
        .execute();
      expect(steps).toEqual([]);
    });
  });

  // Recalino ADR-0004 rules 2 to 5 (P11-01): a runner has authority over its job only while the
  // job is running, its token is the current one, its lease has not ended on the database clock,
  // and its generation is the current one. Every guarded path is checked atomically with its write.
  describe(`ADR-0004 job authority — ${connection}`, () => {
    const db = createDatabase(url, { maxConnections: 3 });
    const second = createDatabase(url, { maxConnections: 3 });
    afterAll(async () => {
      await Promise.all([db.destroy(), second.destroy()]);
    });

    const enqueue = async (def: JobDefinition<{ sessionId: string }>) => {
      const id = await withTransaction(db, (tx) =>
        enqueueJob(tx, def, { payload: { sessionId: SESSION }, now: T0, defaults: DEFAULTS }),
      );
      if (!id) throw new Error("job not enqueued");
      return id;
    };
    const claimOne = async (kind: string, database: Database = db): Promise<ClaimedJob> => {
      const [job] = await claimJobs(database, [kind], 1, T0);
      if (!job) throw new Error("job not claimed");
      return job;
    };
    /** A new job, claimed by runner A. */
    const claimed = async () => {
      const def = definition(async () => {});
      const jobId = await enqueue(def);
      const a = await claimOne(def.kind);
      expect(a.id).toBe(jobId);
      return { def, jobId, a };
    };
    const currentGeneration = async () =>
      (
        await db
          .selectFrom("plt.job_lease_generation")
          .select("generation")
          .executeTakeFirstOrThrow()
      ).generation;
    /** A write on the job's behalf, as P11-02's domain writes make it, then the authority check. */
    const domainWrite = (lease: ClaimedJob, action: string) =>
      withTransaction(db, async (tx) => {
        await effect(tx, lease.id, action);
        await assertJobAuthority(tx, jobLease(lease));
      });
    /** Every guarded path refuses runner `job`; none of them leaves an effect or a step. */
    const expectRefused = async (job: ClaimedJob, label: string) => {
      const step = await outcome(
        runJobStep(db, job, `${label}_step`, (tx) => effect(tx, job.id, `${label}-step`), T0),
      );
      expect("error" in step && step.error).toBeInstanceOf(JobCancelled);
      await expect(domainWrite(job, `${label}-domain`)).rejects.toBeInstanceOf(JobLeaseLost);
      expect(await completeJob(db, job, T0)).toBe(false);
      expect(await failJob(db, job, "test_refused", T0)).toBeNull();
      expect(await failJob(db, job, "test_refused", T0, true)).toBeNull();
      expect(await renewJobLease(db, job, T0)).toBe(false);
      expect(await effects(db, job.id, `${label}-step`)).toBe(0);
      expect(await effects(db, job.id, `${label}-domain`)).toBe(0);
      expect(await hasJobStep(db, job.id, `${label}_step`)).toBe(false);
      return step;
    };
    /** Ends a job left running by a test, so no later sweep in this file finds it. */
    const settle = async (jobId: string) => {
      await cancelJob(db, jobId, T0);
    };

    it("a claim records the current generation, and its lease runs on the database clock", async () => {
      const { jobId, a } = await claimed();
      expect(a.generation).toBe(await currentGeneration());
      const row = await db
        .selectFrom("plt.job")
        .select("lease_generation")
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow();
      expect(row.lease_generation).toBe(a.generation);
      // T0 is weeks away from the database clock: the lease still ends one lease from now.
      const left = await leaseLeft(db, jobId);
      expect(left).toBeGreaterThan(DEFAULTS.leaseSeconds - 60);
      expect(left).toBeLessThanOrEqual(DEFAULTS.leaseSeconds);
      // With authority, the guarded paths work.
      await domainWrite(a, "domain-ok");
      expect(await effects(db, jobId, "domain-ok")).toBe(1);
      expect(await runJobStep(db, a, "ok", (tx) => effect(tx, jobId, "ok"), T0)).toBe("ran");
      expect(await completeJob(db, a, T0)).toBe(true);
      expect(await jobState(db, jobId)).toBe("succeeded");
    });

    it("V3-01: renewal stops, A lives on and B claims after the expiry: A's step, domain write, complete and fail are refused; B goes on", async () => {
      const { jobId, a, def } = await claimed();
      expect(await runJobStep(db, a, "first", (tx) => effect(tx, jobId, "first"), T0)).toBe("ran");
      // A's renewals are cut off; its lease ends on the database clock, and B claims the job.
      await leaseEndsIn(db, jobId, -1);
      expect(await sweepJobs(second, T0)).toBeGreaterThanOrEqual(1);
      const b = await claimOne(def.kind, second);
      expect(b.id).toBe(jobId);
      expect(b.token).not.toBe(a.token);
      // A is still alive and tries every guarded path.
      const step = await expectRefused(a, "a");
      expect("error" in step && step.error).toBeInstanceOf(JobLeaseLost);
      // B goes on under its own claim: A's committed step counts, the rest runs once.
      expect(await runJobStep(second, b, "first", (tx) => effect(tx, jobId, "first"), T0)).toBe(
        "skipped",
      );
      expect(await runJobStep(second, b, "second", (tx) => effect(tx, jobId, "second"), T0)).toBe(
        "ran",
      );
      expect(await completeJob(second, b, T0)).toBe(true);
      expect(await jobState(db, jobId)).toBe("succeeded");
      expect(await effects(db, jobId, "first")).toBe(1);
      expect(await effects(db, jobId, "second")).toBe(1);
    });

    it("V3-02 and E268: once the lease ends, before any reclaim, A can neither record an effect nor complete or fail, and a late renewal does not bring the lease back", async () => {
      const { jobId, a } = await claimed();
      await leaseEndsIn(db, jobId, -1);
      const step = await expectRefused(a, "expired");
      expect("error" in step && step.error).toBeInstanceOf(JobLeaseLost);
      // Nothing reclaimed it and nothing moved its lease: it is still running, lease ended.
      expect(await jobState(db, jobId)).toBe("running");
      expect(await leaseLeft(db, jobId)).toBeLessThan(0);
      // The sweep, with no generation condition, returns it to the queue.
      expect(await sweepJobs(db, T0)).toBeGreaterThanOrEqual(1);
      expect(await jobState(db, jobId)).toBe("retry_scheduled");
      await settle(jobId);
    });

    it("V3-02: a reclaim racing A's step waits for A's lock on the job row, so A's checked effect and B's claim are ordered", async () => {
      const { jobId, a, def } = await claimed();
      await leaseEndsIn(db, jobId, 1); // A's lease ends in one second
      let enter = () => {};
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const step = outcome(
        runJobStep(
          db,
          a,
          "only",
          async (tx) => {
            enter(); // A's check passed; A holds the job row
            await gate;
            await effect(tx, jobId, "only");
          },
          T0,
        ),
      );
      await entered;
      await pause(1500); // A's lease has ended on the database clock while A holds the row
      let swept = false;
      const reclaim = outcome(
        sweepJobs(second, T0).then((count) => {
          swept = true;
          return count;
        }),
      );
      await pause(300);
      expect(swept).toBe(false); // B's sweep waits for A's lock
      release();
      expect(await step).toEqual({ value: "ran" });
      const reclaimed = await reclaim;
      expect("value" in reclaimed && reclaimed.value).toBeGreaterThanOrEqual(1);
      const b = await claimOne(def.kind, second);
      expect(b.token).not.toBe(a.token);
      // From here A has no authority; B sees A's step as done.
      const next = await expectRefused(a, "after");
      expect("error" in next && next.error).toBeInstanceOf(JobLeaseLost);
      expect(await runJobStep(second, b, "only", (tx) => effect(tx, jobId, "only"), T0)).toBe(
        "skipped",
      );
      expect(await effects(db, jobId, "only")).toBe(1);
      expect(await completeJob(second, b, T0)).toBe(true);
    });

    it("V3-02 and AC-12: after a reclaim, assertJobAuthority in the caller's transaction refuses and the write rolls back", async () => {
      const { jobId, a, def } = await claimed();
      await leaseEndsIn(db, jobId, -1);
      await sweepJobs(second, T0);
      const b = await claimOne(def.kind, second);
      await expect(domainWrite(a, "stale-write")).rejects.toBeInstanceOf(JobLeaseLost);
      expect(await effects(db, jobId, "stale-write")).toBe(0);
      await domainWrite(b, "live-write");
      expect(await effects(db, jobId, "live-write")).toBe(1);
      expect(await completeJob(second, b, T0)).toBe(true);
    });

    it("E268: a step that waited for the job row past the lease end is refused after the wait", async () => {
      const { jobId, a } = await claimed();
      await leaseEndsIn(db, jobId, 1);
      let lock = () => {};
      const locked = new Promise<void>((resolve) => {
        lock = resolve;
      });
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Another session holds the job row, without changing it.
      const holder = withTransaction(second, async (tx) => {
        await sql`select id from plt.job where id = ${jobId} for update`.execute(tx);
        lock();
        await held;
      });
      await locked;
      const step = outcome(runJobStep(db, a, "late", (tx) => effect(tx, jobId, "late"), T0));
      await pause(1500); // A's lease ends while A waits for the row
      release();
      await holder;
      const result = await step;
      expect("error" in result && result.error).toBeInstanceOf(JobLeaseLost);
      expect(await effects(db, jobId, "late")).toBe(0);
      expect(await hasJobStep(db, jobId, "late")).toBe(false);
      await sweepJobs(db, T0);
      await settle(jobId);
    });

    it("E268: completeJob that waited for the job row past the lease end is refused after the wait", async () => {
      const { jobId, a } = await claimed();
      await leaseEndsIn(db, jobId, 1);
      let lock = () => {};
      const locked = new Promise<void>((resolve) => {
        lock = resolve;
      });
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = withTransaction(second, async (tx) => {
        await sql`select id from plt.job where id = ${jobId} for update`.execute(tx);
        lock();
        await held;
      });
      await locked;
      const completed = outcome(completeJob(db, a, T0));
      await pause(1500);
      release();
      await holder;
      expect(await completed).toEqual({ value: false });
      expect(await jobState(db, jobId)).toBe("running");
      await settle(jobId);
    });

    it("V3-03 and E268: a job that finished before its lease ended gives the same token no effect, complete or fail", async () => {
      const { jobId, a } = await claimed();
      expect(await completeJob(db, a, T0)).toBe(true);
      expect(await leaseLeft(db, jobId)).toBeNull();
      const step = await expectRefused(a, "finished");
      expect("error" in step && step.error).toBeInstanceOf(JobLeaseLost);
      expect(await jobState(db, jobId)).toBe("succeeded");

      const failed = await claimed();
      expect(await failJob(db, failed.a, "test_terminal", T0, true)).toBe("failed");
      await expectRefused(failed.a, "failed");
      expect(await jobState(db, failed.jobId)).toBe("failed");
    });

    it("V3-03 and E268: a cancelled job refuses every guarded path; the step boundary reports the cancellation", async () => {
      const { jobId, a } = await claimed();
      await cancelJob(db, jobId, T0);
      const step = await expectRefused(a, "cancelled");
      expect("error" in step && step.error).toBeInstanceOf(JobCancelled);
      expect("error" in step && step.error).not.toBeInstanceOf(JobLeaseLost);
      expect(await jobState(db, jobId)).toBe("cancelled");
    });

    it("V3-03: a repeated step is skipped, a crash before the step's commit leaves nothing, and a crash after it leaves the step done for the next claim", async () => {
      const { jobId, a, def } = await claimed();
      // Repeated normal step.
      expect(await runJobStep(db, a, "one", (tx) => effect(tx, jobId, "one"), T0)).toBe("ran");
      expect(await runJobStep(db, a, "one", (tx) => effect(tx, jobId, "one"), T0)).toBe("skipped");
      expect(await effects(db, jobId, "one")).toBe(1);
      // Crash before the commit: the effect throws mid-transaction; neither the key nor the
      // effect remains, and the step runs again later.
      await expect(
        runJobStep(
          db,
          a,
          "two",
          async (tx) => {
            await effect(tx, jobId, "two");
            throw new Error("crash before commit");
          },
          T0,
        ),
      ).rejects.toThrow("crash before commit");
      expect(await hasJobStep(db, jobId, "two")).toBe(false);
      expect(await effects(db, jobId, "two")).toBe(0);
      expect(await runJobStep(db, a, "two", (tx) => effect(tx, jobId, "two"), T0)).toBe("ran");
      // Crash after the commit: A dies; its lease ends; B claims and finds the step done.
      await leaseEndsIn(db, jobId, -1);
      await sweepJobs(second, T0);
      const b = await claimOne(def.kind, second);
      expect(await runJobStep(second, b, "two", (tx) => effect(tx, jobId, "two"), T0)).toBe(
        "skipped",
      );
      expect(await runJobStep(second, b, "three", (tx) => effect(tx, jobId, "three"), T0)).toBe(
        "ran",
      );
      expect(await completeJob(second, b, T0)).toBe(true);
      expect(await effects(db, jobId, "one")).toBe(1);
      expect(await effects(db, jobId, "two")).toBe(1);
      expect(await effects(db, jobId, "three")).toBe(1);
    });

    it("V3-07: a late renewal does not bring an ended lease back", async () => {
      const { jobId, a } = await claimed();
      await leaseEndsIn(db, jobId, -1);
      expect(await renewJobLease(db, a, at(-1))).toBe(false);
      expect(await leaseLeft(db, jobId)).toBeLessThan(0);
      expect(await completeJob(db, a, T0)).toBe(false);
      await sweepJobs(db, T0);
      await settle(jobId);
    });

    it("V3-07: a renewal stuck behind the job row ends at its statement timeout and extends nothing", async () => {
      const { jobId, a } = await claimed();
      await leaseEndsIn(db, jobId, 30);
      const before = await leaseLeft(db, jobId);
      let lock = () => {};
      const locked = new Promise<void>((resolve) => {
        lock = resolve;
      });
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = withTransaction(second, async (tx) => {
        await sql`select id from plt.job where id = ${jobId} for update`.execute(tx);
        lock();
        await held;
      });
      await locked;
      const started = Date.now();
      const renewal = await outcome(renewJobLease(db, a, T0, { timeoutMs: 200 }));
      const took = Date.now() - started;
      release();
      await holder;
      expect("error" in renewal && renewal.error).toMatchObject({ code: "57014" });
      expect(took).toBeLessThan(1500);
      const after = await leaseLeft(db, jobId);
      expect(after).not.toBeNull();
      expect(after ?? 0).toBeLessThanOrEqual(before ?? 0);
      // Once the row is free, the live claim renews again.
      expect(await renewJobLease(db, a, T0, { timeoutMs: 200 })).toBe(true);
      expect(await leaseLeft(db, jobId)).toBeGreaterThan(DEFAULTS.leaseSeconds - 60);
      await settle(jobId);
    });

    it("V3-07: the process clock decides nothing about the lease", async () => {
      const { jobId, a } = await claimed();
      const farFuture = at(10 * 365 * 24 * 3600);
      const farPast = at(-10 * 365 * 24 * 3600);
      // A caller far in the future sweeps nothing whose lease is valid on the database clock.
      await sweepJobs(db, farFuture);
      expect(await jobState(db, jobId)).toBe("running");
      // A caller far in the past renews from the database clock, not from its own time.
      expect(await renewJobLease(db, a, farPast)).toBe(true);
      expect(await leaseLeft(db, jobId)).toBeGreaterThan(DEFAULTS.leaseSeconds - 60);
      expect(await runJobStep(db, a, "clock", (tx) => effect(tx, jobId, "clock"), farFuture)).toBe(
        "ran",
      );
      // Ended on the database clock: refused whatever time the caller passes.
      await leaseEndsIn(db, jobId, -1);
      expect(await completeJob(db, a, farPast)).toBe(false);
      expect(await failJob(db, a, "test_clock", farPast)).toBeNull();
      expect(await renewJobLease(db, a, farPast)).toBe(false);
      await sweepJobs(db, farPast);
      expect(await jobState(db, jobId)).toBe("retry_scheduled");
      await settle(jobId);
    });

    it("AC-1 and AC-6: a claim without a lease, a row with a NULL generation and a row with an older generation have no authority", async () => {
      // A hand-made claim without a generation (fail-closed).
      const bare = await claimed();
      const { generation: _dropped, ...withoutGeneration } = bare.a;
      await expectRefused(withoutGeneration, "bare");
      expect(await jobState(db, bare.jobId)).toBe("running");
      expect(await leaseLeft(db, bare.jobId)).toBeGreaterThan(0);
      await settle(bare.jobId);

      // A row claimed by code that leaves the generation NULL, or claimed in an older generation.
      for (const [label, stored] of [
        ["null", null],
        ["older", (await currentGeneration()) - 1],
      ] as const) {
        const { jobId, a } = await claimed();
        await db
          .updateTable("plt.job")
          .set({ lease_generation: stored })
          .where("id", "=", jobId)
          .execute();
        await expectRefused(a, `gen_${label}`);
        // A claim presenting the row's own non-current value (0 for NULL) is refused as well.
        await expectRefused({ ...a, generation: stored ?? 0 }, `gen_${label}_same`);
        // No authority until its lease ends; then the sweep, without a generation condition,
        // returns it to the queue.
        await sweepJobs(db, T0);
        expect(await jobState(db, jobId)).toBe("running");
        await leaseEndsIn(db, jobId, -1);
        await sweepJobs(db, T0);
        expect(await jobState(db, jobId)).toBe("retry_scheduled");
        await settle(jobId);
      }
    });

    it("the runner sets the context lease, and a handler that lost its lease settles nothing", async () => {
      const seen: { lease?: unknown } = {};
      const def = definition(async (_payload, ctx) => {
        seen.lease = ctx.lease;
        await ctx.step("before", (tx) => effect(tx, jobId, "before"));
        await leaseEndsIn(db, jobId, -1); // the lease ends while the handler works
        await ctx.step("after", (tx) => effect(tx, jobId, "after"));
      });
      const jobId = await enqueue(def);
      const summary = await runDueJobs(db, [def], {
        kinds: [def.kind],
        deadline: at(10),
        now: () => at(1),
      });
      expect(summary).toMatchObject({ succeeded: 0, failed: 0, retried: 0, cancelled: 0 });
      expect(seen.lease).toEqual({
        id: jobId,
        token: expect.any(String),
        generation: await currentGeneration(),
      });
      expect(await effects(db, jobId, "before")).toBe(1);
      expect(await effects(db, jobId, "after")).toBe(0);
      // Not settled by the runner without authority: the sweep decides it.
      expect(await jobState(db, jobId)).toBe("running");
      await sweepJobs(db, T0);
      expect(await jobState(db, jobId)).toBe("retry_scheduled");
      await settle(jobId);
    });
  });
}
