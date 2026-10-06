import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LOCAL_POOLER_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Database, type Tx, withTransaction } from "../db";
import {
  cancelJob,
  claimJobs,
  completeJob,
  enqueueJob,
  ensurePeriodicJob,
  type JobDefinition,
  jobState,
  purgeFinishedJobs,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "./jobs";
import { emptyPayload } from "./maintenance";
import { DEFAULT_PLT_SETTINGS } from "./settings";

// FR-PLT-005 on real Postgres, deterministic: times are passed in, nothing waits. Every case runs
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
      // The runner dies here. Until its lease ends, nobody else takes the job.
      expect(await sweepJobs(db, at(DEFAULTS.leaseSeconds - 1))).toBe(0);
      expect(await claimJobs(db, [def.kind], 1, at(DEFAULTS.leaseSeconds - 1))).toEqual([]);

      const later = at(DEFAULTS.leaseSeconds + 1);
      const summary = await runDueJobs(db, [def], { deadline: at(3600), now: () => later });
      expect(summary).toMatchObject({ swept: 1, succeeded: 1 });
      expect(await completeJob(db, first, later)).toBe(false); // the dead runner's claim is void
      expect(await jobState(db, jobId)).toBe("succeeded");
      expect(await effects(db, jobId, "transcribe")).toBe(1);
      expect(await effects(db, jobId, "notes")).toBe(1);
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
}
