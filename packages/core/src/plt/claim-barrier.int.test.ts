import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Tx, withTransaction } from "../db";
import {
  assertJobAuthority,
  type ClaimedJob,
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  type JobDefinition,
  JobLeaseLost,
  renewJobLease,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "./jobs";
import { DEFAULT_PLT_SETTINGS } from "./settings";

// Recalino ADR-0004 rule 3, step 3 (P11-08): the database-side barrier on claim, its activation and
// deactivation, the held old runner and the payload version requeue. The "old code" here is the
// SQL of the build deployed before the barrier (commit 2b158f4): its claim writes neither the
// generation nor the build, and its renew, complete and fail check only id, token and state.
// Every test leaves the barrier off and the barrier row as it found it.

const app = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });

const T0 = new Date("2026-11-12T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const DEFAULTS = { ...DEFAULT_PLT_SETTINGS.jobs, retryBaseSeconds: 30, retryMaxSeconds: 3600 };
const SESSION = "0b6f6a0e-7f1d-4c38-8d39-2a5d3f0c9e14";
/** Two builds after the barrier (commit SHAs, as the runner records them). */
const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REFUSED = /claim refused by the claim barrier/;
/** The barrier's exact refusal (AC-6): no other error stands in for it. */
const REFUSAL = "job claim refused by the claim barrier";

type Payload = { sessionId: string };
/** A claim's job and lease token, whichever code made it. */
type Claimed = { id: string; token: string };
/** The generation and build a job holds, or a claim writes. */
type Scenario = { lease_generation: number | null; lease_build: string | null };
const NO_CLAIM_DATA: Scenario = { lease_generation: null, lease_build: null };

/**
 * AC-26: the CI log line of each test, printed after its assertions. A line alone is no pass; the
 * evidence is these lines with the green summary of this file in the same run.
 */
function evidence(title: string, subCase: string | undefined, outcome: string): void {
  console.log(`[AC-6] ${title}${subCase === undefined ? "" : ` (${subCase})`}: ${outcome}`);
}

function passed(title: string): void {
  evidence(title, undefined, "passed");
}

function definition(run: JobDefinition<Payload>["run"] = async () => {}): JobDefinition<Payload> {
  return {
    kind: `test.b_${randomBytes(4).toString("hex")}`,
    version: 1,
    payload: z.strictObject({ sessionId: z.uuid() }),
    run,
  };
}

async function enqueue(def: Pick<JobDefinition<Payload>, "kind" | "version" | "payload">) {
  const id = await withTransaction(app, (tx) =>
    enqueueJob(tx, def, { payload: { sessionId: SESSION }, now: T0, defaults: DEFAULTS }),
  );
  if (id === null) throw new Error("job not enqueued");
  return id;
}

interface BarrierRow {
  generation: number;
  allowed_builds: string[] | null;
  changed_at: Date;
}

async function barrierRow(): Promise<BarrierRow> {
  return admin
    .selectFrom("plt.job_lease_generation")
    .select(["generation", "allowed_builds", "changed_at"])
    .executeTakeFirstOrThrow();
}

/** 'D' while the barrier is off. */
async function triggerState(): Promise<string | undefined> {
  const result = await sql<{ enabled: string }>`
    select tgenabled as enabled from pg_trigger
    where tgrelid = 'plt.job'::regclass and tgname = 'job_claim_barrier'`.execute(admin);
  return result.rows[0]?.enabled;
}

/** The owner's activation, as the runbook runs it. */
async function activate(allowed: string[], current: string): Promise<number> {
  const result = await sql<{ generation: number }>`
    select plt.activate_job_claim_barrier(${allowed}::text[], ${current}) as generation`.execute(
    admin,
  );
  const generation = result.rows[0]?.generation;
  if (generation === undefined) throw new Error("no generation");
  return generation;
}

async function deactivate(): Promise<void> {
  await sql`select plt.deactivate_job_claim_barrier()`.execute(admin);
}

async function job(id: string) {
  return admin
    .selectFrom("plt.job")
    .select([
      "state",
      "attempt",
      "lease_token",
      "lease_generation",
      "lease_build",
      "last_error",
      "run_at",
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function runningTokens(ids: string[]): Promise<Record<string, string | null>> {
  const rows = await admin
    .selectFrom("plt.job")
    .select(["id", "lease_token"])
    .where("id", "in", ids)
    .execute();
  return Object.fromEntries(rows.map((row) => [row.id, row.lease_token]));
}

/** A claim by the current code with the given build. */
async function claimNew(def: { kind: string }, build: string | undefined, now = new Date()) {
  const claimed = await claimJobs(app, [def.kind], 1, now, undefined, build);
  expect(claimed).toHaveLength(1);
  const [first] = claimed;
  if (!first) throw new Error("job not claimed");
  return first;
}

// The SQL of the build before the barrier (2b158f4), unchanged; `now` is its process clock.
async function oldClaim(kind: string, now = new Date()) {
  const result = await sql<{ id: string; lease_token: string }>`
    with picked as (
      select id from plt.job
      where state in ('queued', 'retry_scheduled') and run_at <= ${now}
        and kind = any(${[kind]})
      order by run_at
      for update skip locked
      limit 1
    )
    update plt.job j
    set state = 'running', attempt = j.attempt + 1, lease_token = gen_random_uuid(),
        lease_until = ${now}::timestamptz + make_interval(secs => j.lease_seconds),
        updated_at = ${now}
    from picked where j.id = picked.id
    returning j.id, j.lease_token`.execute(app);
  return result.rows;
}

async function oldRenew(id: string, token: string, now = new Date()) {
  const result = await sql`
    update plt.job
    set lease_until = ${now}::timestamptz + make_interval(secs => lease_seconds)
    where id = ${id} and lease_token = ${token} and state = 'running'`.execute(app);
  return Number(result.numAffectedRows ?? 0);
}

async function oldComplete(id: string, token: string, now = new Date()) {
  const result = await app
    .updateTable("plt.job")
    .set({ state: "succeeded", lease_token: null, lease_until: null, updated_at: now })
    .set({ finished_at: now })
    .where("id", "=", id)
    .where("lease_token", "=", token)
    .where("state", "=", "running")
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

async function oldFail(id: string, token: string, now = new Date()) {
  const result = await sql<{ state: string }>`
    update plt.job
    set state = case when attempt >= max_attempts then 'failed' else 'retry_scheduled' end,
        run_at = ${now}::timestamptz + make_interval(secs =>
          least(retry_max_seconds, retry_base_seconds * power(2, attempt - 1))),
        last_error = 'handler_error', lease_token = null, lease_until = null, updated_at = ${now}
    where id = ${id} and lease_token = ${token} and state = 'running'
    returning state`.execute(app);
  return result.rows.length;
}

async function oldClaimed(kind: string): Promise<Claimed[]> {
  return (await oldClaim(kind)).map((row) => ({ id: row.id, token: row.lease_token }));
}

/** A claim by the current code (claimJobs: the current generation and this build, or NULL). */
async function claimCurrent(kind: string, build: string | undefined): Promise<Claimed[]> {
  const claimed = await claimJobs(app, [kind], 1, new Date(), undefined, build);
  return claimed.map((row) => ({ id: row.id, token: row.token }));
}

/** A claim that writes exactly the given generation and build. */
async function claimWriting(
  kind: string,
  generation: number | null,
  build: string | null,
): Promise<Claimed[]> {
  const result = await sql<{ id: string; lease_token: string }>`
    with picked as (
      select id from plt.job
      where state in ('queued', 'retry_scheduled') and kind = any(${[kind]})
      for update skip locked limit 1
    )
    update plt.job j
    set state = 'running', attempt = j.attempt + 1, lease_token = gen_random_uuid(),
        lease_until = statement_timestamp() + make_interval(secs => j.lease_seconds),
        lease_generation = ${generation}, lease_build = ${build}
    from picked where j.id = picked.id
    returning j.id, j.lease_token`.execute(app);
  return result.rows.map((row) => ({ id: row.id, token: row.lease_token }));
}

/**
 * The fixture of either half of a paired control (AC-6): a job of a claimable kind, waiting
 * (queued or retry_scheduled), due by the database clock, with no lease and exactly `data`.
 */
async function expectEligible(id: string, kind: string, data: Scenario): Promise<void> {
  const result = await sql<{
    state: string;
    kind: string;
    due: boolean;
    lease_token: string | null;
    lease_generation: number | null;
    lease_build: string | null;
  }>`
    select state, kind, run_at <= now() as due, lease_token, lease_generation, lease_build
    from plt.job where id = ${id}`.execute(admin);
  expect(result.rows).toHaveLength(1);
  const [row] = result.rows;
  expect(["queued", "retry_scheduled"]).toContain(row?.state);
  expect(row).toMatchObject({ kind, due: true, lease_token: null, ...data });
}

/** Accepted: exactly this job, now running under the token the claim returned. */
async function expectAccepted(
  claim: Promise<Claimed[]>,
  id: string,
  wrote: Scenario,
): Promise<void> {
  const rows = await claim;
  expect(rows).toHaveLength(1);
  const [claimed] = rows;
  expect(claimed?.id).toBe(id);
  const row = await job(id);
  expect(row.state).toBe("running");
  expect(row.lease_token).not.toBeNull();
  expect(row.lease_token).toBe(claimed?.token);
  expect(row).toMatchObject(wrote);
}

/** Refused by the barrier itself: zero rows or any other error does not count. */
async function expectRefused(claim: Promise<unknown>): Promise<void> {
  const error = await claim.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(REFUSAL);
  expect((error as { code?: unknown }).code).toBe("P0001");
}

/** Turns the barrier off and returns the generation in force. */
async function barrierOff(): Promise<number> {
  await deactivate();
  expect(await triggerState()).toBe("D");
  return (await barrierRow()).generation;
}

/** Activates the barrier from off and asserts that it succeeded; returns the new generation. */
async function barrierOn(allowed: string[], current: string): Promise<number> {
  const before = await barrierRow();
  expect(await triggerState()).toBe("D");
  const generation = await activate(allowed, current);
  expect(generation).toBe(before.generation + 1);
  const after = await barrierRow();
  expect(after.generation).toBe(generation);
  expect(after.allowed_builds).toEqual([...new Set(allowed)].sort());
  expect(await triggerState()).toBe("O");
  return generation;
}

interface FreshJobCase {
  name: string;
  /** The claim under test; `generation` is the generation in force for its half. */
  claim: (kind: string, generation: number) => Promise<Claimed[]>;
  /** What that claim writes, given the generation in force. */
  writes: (generation: number) => Scenario;
}

/**
 * AC-6 paired control on a fresh queued job: the claim is accepted with the barrier off, then,
 * after a successful activation with allowed builds [A], the same claim on an equivalent job is
 * refused with the barrier's exact error and the job stays eligible and unchanged. `cause` asserts
 * the scenario's data against the generation in force, so the refusal has the cause under test.
 */
async function pairedOnFreshJob(
  title: string,
  subCase: FreshJobCase,
  cause: (written: Scenario, barrier: BarrierRow) => void,
): Promise<void> {
  const offGeneration = await barrierOff();
  const off = definition();
  const offId = await enqueue(off);
  await expectEligible(offId, off.kind, NO_CLAIM_DATA);
  await expectAccepted(
    subCase.claim(off.kind, offGeneration),
    offId,
    subCase.writes(offGeneration),
  );
  evidence(title, subCase.name, "barrier off: accepted");

  const on = definition();
  const onId = await enqueue(on);
  const generation = await barrierOn([A], A);
  cause(subCase.writes(generation), await barrierRow());
  await expectEligible(onId, on.kind, NO_CLAIM_DATA);
  await expectRefused(subCase.claim(on.kind, generation));
  await expectEligible(onId, on.kind, NO_CLAIM_DATA);
  expect(await job(onId)).toMatchObject({ state: "queued", attempt: 0 });
  evidence(title, subCase.name, "barrier on: rejected");
}

async function effect(tx: Tx, jobId: string) {
  await tx
    .insertInto("plt.audit_event")
    .values({
      actor_kind: "system",
      actor_id: "claim-barrier-test",
      action: "effect",
      subject_type: "job",
      subject_id: jobId,
    })
    .execute();
}

async function effects(jobId: string): Promise<number> {
  const row = await admin
    .selectFrom("plt.audit_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("subject_id", "=", jobId)
    .where("action", "=", "effect")
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

async function tamperedEvents(kind: string): Promise<number> {
  const row = await admin
    .selectFrom("plt.security_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("route", "=", kind)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

let original: BarrierRow;

beforeAll(async () => {
  original = await barrierRow();
});

afterEach(async () => {
  await deactivate();
  await admin
    .updateTable("plt.job_lease_generation")
    .set({
      generation: original.generation,
      allowed_builds: original.allowed_builds,
      changed_at: original.changed_at,
    })
    .execute();
});

afterAll(async () => {
  await Promise.all([app.destroy(), admin.destroy()]);
});

describe("claim barrier (ADR-0004 rule 3, step 3; P11-08)", () => {
  it("B01 barrier inactive: an old-code claim that writes no generation or build passes unchanged", async ({
    task,
  }) => {
    expect(await triggerState()).toBe("D");
    const def = definition();
    const id = await enqueue(def);
    const [claimed] = await oldClaim(def.kind);
    expect(claimed?.id).toBe(id);
    expect(await job(id)).toMatchObject({
      state: "running",
      attempt: 1,
      lease_token: claimed?.lease_token,
      lease_generation: null,
      lease_build: null,
    });
    expect(await oldRenew(id, claimed?.lease_token ?? "")).toBe(1);
    expect(await oldComplete(id, claimed?.lease_token ?? "")).toBe(1);
    expect(await job(id)).toMatchObject({ state: "succeeded" });
    passed(task.name);
  });

  it("B02 barrier active: a claim with a NULL generation or build is rejected", async ({
    task,
  }) => {
    // Everything but the NULL is valid against the generation in force, so the NULL is the cause.
    const onlyTheNull = (written: Scenario, barrier: BarrierRow) => {
      expect(written.lease_generation === null || written.lease_build === null).toBe(true);
      if (written.lease_generation !== null)
        expect(written.lease_generation).toBe(barrier.generation);
      if (written.lease_build !== null)
        expect(barrier.allowed_builds).toContain(written.lease_build);
    };
    const subCases: FreshJobCase[] = [
      {
        name: "NULL generation",
        claim: (kind) => claimWriting(kind, null, A),
        writes: () => ({ lease_generation: null, lease_build: A }),
      },
      {
        // The current code without a build: the current generation, build NULL.
        name: "NULL build",
        claim: (kind) => claimCurrent(kind, undefined),
        writes: (generation) => ({ lease_generation: generation, lease_build: null }),
      },
      {
        // The code before the barrier (2b158f4) writes neither.
        name: "old code: NULL generation and build",
        claim: (kind) => oldClaimed(kind),
        writes: () => NO_CLAIM_DATA,
      },
    ];
    for (const subCase of subCases) await pairedOnFreshJob(task.name, subCase, onlyTheNull);
  });

  it("B03 barrier active: a generation or build left by an earlier claim does not authorize a claim that does not write it", async ({
    task,
  }) => {
    // The claim under test is the old code's: it writes neither, so only data left on the row
    // could stand for it. Each half has its own job of its own kind, prepared the same way.

    // (1) Left before activation by a claim of an allowed build, at the generation then in force.
    {
      const subCase = "left before activation";
      const current = await barrierOff();
      const leave = async () => {
        const def = definition();
        const id = await enqueue(def);
        const earlier = await claimNew(def, A);
        expect(earlier.generation).toBe(current);
        expect(await failJob(app, earlier, "test_retry", at(1))).toBe("retry_scheduled");
        return { def, id };
      };
      const off = await leave();
      const on = await leave();
      const left: Scenario = { lease_generation: current, lease_build: A };
      await expectEligible(off.id, off.def.kind, left);
      await expectAccepted(oldClaimed(off.def.kind), off.id, left);
      evidence(task.name, subCase, "barrier off: accepted");

      const generation = await barrierOn([A], A);
      // The left data: the generation before activation and an allowed build.
      expect(left.lease_generation).toBe(generation - 1);
      expect((await barrierRow()).allowed_builds).toContain(left.lease_build);
      await expectEligible(on.id, on.def.kind, left);
      await expectRefused(oldClaimed(on.def.kind));
      await expectEligible(on.id, on.def.kind, left);
      expect(await job(on.id)).toMatchObject({ state: "retry_scheduled", attempt: 1 });
      evidence(task.name, subCase, "barrier on: rejected");
    }

    // (2) The cycle after activation: a claim of an allowed build at the current generation,
    // then a write that leaves the job not running, which clears both columns.
    {
      const subCase = "left after activation and cleared";
      const current = await barrierOff();
      const off = definition();
      const offId = await enqueue(off);
      const offEarlier = await claimNew(off, A);
      expect(offEarlier.generation).toBe(current);
      expect(await failJob(app, offEarlier, "test_retry", at(1))).toBe("retry_scheduled");
      // Barrier off: nothing clears the columns.
      const offLeft: Scenario = { lease_generation: current, lease_build: A };
      await expectEligible(offId, off.kind, offLeft);
      await expectAccepted(oldClaimed(off.kind), offId, offLeft);
      evidence(task.name, subCase, "barrier off: accepted");

      const generation = await barrierOn([A], A);
      const on = definition();
      const onId = await enqueue(on);
      const later = await claimNew(on, A);
      expect(later.generation).toBe(generation);
      expect(await job(onId)).toMatchObject({ lease_generation: generation, lease_build: A });
      expect(await failJob(app, later, "test_retry", at(1))).toBe("retry_scheduled");
      await expectEligible(onId, on.kind, NO_CLAIM_DATA);
      await expectRefused(oldClaimed(on.kind));
      await expectEligible(onId, on.kind, NO_CLAIM_DATA);
      expect(await job(onId)).toMatchObject({ state: "retry_scheduled", attempt: 1 });
      evidence(task.name, subCase, "barrier on: rejected");
    }

    // (3) The current generation and an allowed build written straight onto the waiting job.
    {
      const subCase = "written onto the waiting job";
      const writeOnto = (id: string, generation: number) =>
        admin
          .updateTable("plt.job")
          .set({ lease_generation: generation, lease_build: A })
          .where("id", "=", id)
          .execute();
      const current = await barrierOff();
      const off = definition();
      const offId = await enqueue(off);
      await writeOnto(offId, current);
      const offWritten: Scenario = { lease_generation: current, lease_build: A };
      await expectEligible(offId, off.kind, offWritten);
      await expectAccepted(oldClaimed(off.kind), offId, offWritten);
      evidence(task.name, subCase, "barrier off: accepted");

      const generation = await barrierOn([A], A);
      const on = definition();
      const onId = await enqueue(on);
      await writeOnto(onId, generation);
      // The barrier clears it on the waiting job, so nothing is left for the claim.
      await expectEligible(onId, on.kind, NO_CLAIM_DATA);
      await expectRefused(oldClaimed(on.kind));
      await expectEligible(onId, on.kind, NO_CLAIM_DATA);
      expect(await job(onId)).toMatchObject({ state: "queued", attempt: 0 });
      evidence(task.name, subCase, "barrier on: rejected");
    }
  });

  it("B04 barrier active: a claim with a build outside the allowed build set is rejected", async ({
    task,
  }) => {
    // The generation is the one in force; only the build is outside the set.
    const onlyTheBuild = (written: Scenario, barrier: BarrierRow) => {
      expect(written.lease_generation).toBe(barrier.generation);
      expect(written.lease_build).toBe(B);
      expect(barrier.allowed_builds).toEqual([A]);
      expect(barrier.allowed_builds).not.toContain(B);
    };
    const subCases: FreshJobCase[] = [
      {
        name: "current code, build outside the set",
        claim: (kind) => claimCurrent(kind, B),
        writes: (generation) => ({ lease_generation: generation, lease_build: B }),
      },
      {
        name: "current generation written, build outside the set",
        claim: (kind, generation) => claimWriting(kind, generation, B),
        writes: (generation) => ({ lease_generation: generation, lease_build: B }),
      },
    ];
    for (const subCase of subCases) await pairedOnFreshJob(task.name, subCase, onlyTheBuild);
  });

  it("B05 barrier active: a new job is claimed with the current generation and an allowed build", async ({
    task,
  }) => {
    const generation = await activate([A, B], A);
    for (const build of [A, B]) {
      const def = definition();
      const id = await enqueue(def);
      const claimed = await claimNew(def, build);
      expect(claimed).toMatchObject({ id, attempt: 1, generation });
      expect(await job(id)).toMatchObject({
        state: "running",
        lease_generation: generation,
        lease_build: build,
      });
      expect(await renewJobLease(app, claimed, new Date())).toBe(true);
      expect(await completeJob(app, claimed, new Date())).toBe(true);
      expect(await job(id)).toMatchObject({ state: "succeeded" });
    }
    passed(task.name);
  });

  it("B06 barrier active: a job the new build claimed before activation loses authority at the token rotation and continues only by a new claim", async ({
    task,
  }) => {
    const def = definition();
    const id = await enqueue(def);
    const before = await claimNew(def, A);
    const generation = await activate([A], A);
    expect(generation).toBe((before.generation ?? 0) + 1);
    const rotated = await job(id);
    expect(rotated.state).toBe("running");
    expect(rotated.lease_token).not.toBeNull();
    expect(rotated.lease_token).not.toBe(before.token);

    const step = vi.fn((tx: Tx) => effect(tx, id));
    expect(await renewJobLease(app, before, new Date())).toBe(false);
    await expect(
      runJobStep(app, before, "after_rotation", step, new Date()),
    ).rejects.toBeInstanceOf(JobLeaseLost);
    expect(step).not.toHaveBeenCalled();
    expect(await completeJob(app, before, new Date())).toBe(false);
    expect(await failJob(app, before, "test_retry", new Date())).toBeNull();
    expect(await job(id)).toMatchObject({ state: "running", lease_token: rotated.lease_token });
    expect(await claimJobs(app, [def.kind], 1, new Date(), undefined, A)).toEqual([]);

    // Its lease ends, the sweep returns it, and a new claim continues it.
    await sql`update plt.job set lease_until = statement_timestamp() - interval '1 second'
      where id = ${id}`.execute(admin);
    await sweepJobs(app, new Date());
    expect(await job(id)).toMatchObject({ state: "retry_scheduled", lease_generation: null });
    const again = await claimNew(def, A);
    expect(again).toMatchObject({ id, attempt: 2, generation });
    expect(await runJobStep(app, again, "after_rotation", step, new Date())).toBe("ran");
    expect(await completeJob(app, again, new Date())).toBe(true);
    expect(await effects(id)).toBe(1);
    passed(task.name);
  });

  it("B07 activation fails and changes nothing when the allowed build set is empty", async ({
    task,
  }) => {
    const def = definition();
    const id = await enqueue(def);
    await claimNew(def, A);
    const row = await barrierRow();
    const tokens = await runningTokens([id]);
    await expect(activate([], A)).rejects.toThrow(/allowed build set is empty/);
    await expect(
      sql`select plt.activate_job_claim_barrier(null, ${A})`.execute(admin),
    ).rejects.toThrow(/allowed build set is empty/);
    expect(await barrierRow()).toEqual(row);
    expect(await runningTokens([id])).toEqual(tokens);
    expect(await triggerState()).toBe("D");
    passed(task.name);
  });

  it("B08 activation fails and changes nothing when the current build is not in the allowed build set", async ({
    task,
  }) => {
    const def = definition();
    const id = await enqueue(def);
    await claimNew(def, A);
    const row = await barrierRow();
    const tokens = await runningTokens([id]);
    await expect(activate([A], B)).rejects.toThrow(/current build is not in the allowed build set/);
    await expect(activate([A], "")).rejects.toThrow(/current build is missing/);
    expect(await barrierRow()).toEqual(row);
    expect(await runningTokens([id])).toEqual(tokens);
    expect(await triggerState()).toBe("D");
    passed(task.name);
  });

  it("B09 activation is idempotent: a second call with the same input raises no generation and rotates no token", async ({
    task,
  }) => {
    const def = definition();
    const id = await enqueue(def);
    await claimNew(def, A);
    const first = await activate([A, B], A);
    const row = await barrierRow();
    const tokens = await runningTokens([id]);
    expect(row).toMatchObject({ generation: first, allowed_builds: [A, B] });
    expect(await activate([A, B], A)).toBe(first);
    // The same set in another order is the same input.
    expect(await activate([B, A, A], A)).toBe(first);
    expect(await barrierRow()).toEqual(row);
    expect(await runningTokens([id])).toEqual(tokens);
    expect(await triggerState()).toBe("O");
    passed(task.name);
  });

  it("B10 deactivation turns the barrier off without deleting data, and an old-code claim passes again", async ({
    task,
  }) => {
    const def = definition();
    const running = await enqueue(def);
    await claimNew(def, A);
    await activate([A], A);
    const row = await barrierRow();
    const kept = await job(running);
    const count = async () =>
      Number(
        (
          await admin
            .selectFrom("plt.job")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      );
    const jobs = await count();
    const waiting = await enqueue(def);
    await expect(oldClaim(def.kind)).rejects.toThrow(REFUSED);

    await deactivate();
    await deactivate(); // repeating it changes nothing
    expect(await triggerState()).toBe("D");
    expect(await barrierRow()).toEqual(row);
    expect(await job(running)).toEqual(kept);
    expect(await count()).toBe(jobs + 1);

    const [claimed] = await oldClaim(def.kind);
    expect(claimed?.id).toBe(waiting);
    expect(await job(waiting)).toMatchObject({
      state: "running",
      lease_generation: null,
      lease_build: null,
    });
    passed(task.name);
  });

  it("B11 the activation and deactivation functions are not executable by public, anon or authenticated", async ({
    task,
  }) => {
    for (const signature of [
      "plt.activate_job_claim_barrier(text[], text)",
      "plt.deactivate_job_claim_barrier()",
    ]) {
      const acl = await sql<{ defaulted: boolean; public_execute: boolean }>`
        select p.proacl is null as defaulted,
          exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'
          ) as public_execute
        from pg_proc p where p.oid = ${signature}::regprocedure`.execute(admin);
      expect(acl.rows).toEqual([{ defaulted: false, public_execute: false }]);
      for (const role of ["anon", "authenticated", "recalino_app"]) {
        const granted = await sql<{ granted: boolean }>`
          select has_function_privilege(${role}::name, ${signature}::text, 'EXECUTE') as granted`.execute(
          admin,
        );
        expect(granted.rows).toEqual([{ granted: false }]);
      }
    }
    for (const role of ["anon", "authenticated"]) {
      for (const call of [
        sql`select plt.activate_job_claim_barrier(array[${A}]::text[], ${A})`,
        sql`select plt.deactivate_job_claim_barrier()`,
      ])
        await expect(
          withTransaction(admin, async (tx) => {
            await sql.raw(`set local role ${role}`).execute(tx);
            await call.execute(tx);
          }),
        ).rejects.toThrow(/permission denied/);
    }
    await expect(
      sql`select plt.activate_job_claim_barrier(array[${A}]::text[], ${A})`.execute(app),
    ).rejects.toThrow(/permission denied/);
    await expect(sql`select plt.deactivate_job_claim_barrier()`.execute(app)).rejects.toThrow(
      /permission denied/,
    );
    expect(await triggerState()).toBe("D");
    passed(task.name);
  });

  it("B12 instant rollback: a pre-barrier build is rejected and a post-barrier build claims only after the allowed build row is updated", async ({
    task,
  }) => {
    const generation = await activate([A], A);
    const def = definition();
    const id = await enqueue(def);
    // Back to the build before the barrier: fail-closed.
    await expect(oldClaim(def.kind)).rejects.toThrow(REFUSED);
    // Back to another build after the barrier, before its row is updated: refused.
    await expect(claimJobs(app, [def.kind], 1, new Date(), undefined, B)).rejects.toThrow(REFUSED);
    expect(await job(id)).toMatchObject({ state: "queued", attempt: 0 });
    // The runbook's rollback step: the allowed builds now hold the build rolled back to.
    expect(await activate([A, B], B)).toBe(generation + 1);
    const claimed = await claimNew(def, B);
    expect(claimed).toMatchObject({ id, generation: generation + 1 });
    expect(await completeJob(app, claimed, new Date())).toBe(true);
    await enqueue(def);
    await expect(oldClaim(def.kind)).rejects.toThrow(REFUSED);
    passed(task.name);
  });

  it("B13 a held old runner can neither claim, complete, fail nor record an effect on a guarded path after activation", async ({
    task,
  }) => {
    const def = definition();
    const held = await enqueue(def);
    const generationBefore = (await barrierRow()).generation;
    const [claim] = await oldClaim(def.kind);
    expect(claim?.id).toBe(held);
    const token = claim?.lease_token ?? "";
    const generationAfter = await activate([A], A);
    const other = await enqueue(def);

    // The held runner, still alive with its old token.
    await expect(oldClaim(def.kind)).rejects.toThrow(REFUSED);
    expect(await job(other)).toMatchObject({ state: "queued", attempt: 0 });
    expect(await oldRenew(held, token)).toBe(0);
    expect(await oldComplete(held, token)).toBe(0);
    expect(await oldFail(held, token)).toBe(0);

    // The guarded paths, with any generation the held runner could present.
    const step = vi.fn((tx: Tx) => effect(tx, held));
    for (const generation of [undefined, generationBefore, generationAfter]) {
      const stale: ClaimedJob = {
        id: held,
        kind: def.kind,
        payload: { sessionId: SESSION },
        payloadVersion: 1,
        attempt: 1,
        token,
        leaseSeconds: DEFAULTS.leaseSeconds,
        ...(generation === undefined ? {} : { generation }),
      };
      await expect(runJobStep(app, stale, "held", step, new Date())).rejects.toBeInstanceOf(
        JobLeaseLost,
      );
      if (generation !== undefined)
        await expect(
          app.transaction().execute(async (tx) => {
            await assertJobAuthority(tx, { id: held, token, generation });
            await effect(tx, held);
          }),
        ).rejects.toBeInstanceOf(JobLeaseLost);
      expect(await completeJob(app, stale, new Date())).toBe(false);
      expect(await failJob(app, stale, "test_retry", new Date())).toBeNull();
    }
    expect(step).not.toHaveBeenCalled();
    expect(await effects(held)).toBe(0);
    const steps = await admin
      .selectFrom("plt.job_step")
      .select("step")
      .where("job_id", "=", held)
      .execute();
    expect(steps).toEqual([]);
    const after = await job(held);
    expect(after.state).toBe("running");
    expect(after.lease_token).not.toBe(token);
    passed(task.name);
  });

  it("B14 payload version requeue: a job of a higher payload version returns to the queue with no net attempt and a later run_at", async ({
    task,
  }) => {
    await activate([A], A);
    const run = vi.fn(async () => {});
    const def = definition(run);
    const id = await enqueue({ ...def, version: 2 });
    const events: string[] = [];
    const summary = await runDueJobs(app, [def], {
      deadline: at(10),
      now: () => T0,
      build: A,
      log: (_level, event) => {
        events.push(event);
      },
    });
    expect(summary).toMatchObject({ succeeded: 0, failed: 0, retried: 0, cancelled: 0 });
    expect(events).toContain("job_requeued");
    expect(run).not.toHaveBeenCalled();
    expect(await job(id)).toMatchObject({
      state: "queued",
      attempt: 0,
      lease_token: null,
      last_error: "payload_version_newer",
    });
    const later = await sql<{ later: boolean }>`
      select run_at > now() as later from plt.job where id = ${id}`.execute(admin);
    expect(later.rows).toEqual([{ later: true }]);
    expect(await tamperedEvents(def.kind)).toBe(0);
    // Not due again in the same round.
    expect(await claimJobs(app, [def.kind], 1, new Date(), undefined, A)).toEqual([]);
    passed(task.name);
  });

  it("B15 a job of an unknown kind is not claimed", async ({ task }) => {
    const known = definition();
    const unknown = definition();
    const id = await enqueue(unknown);
    const options = { deadline: at(10), now: () => at(1), build: A };
    await runDueJobs(app, [known], options);
    await runDueJobs(app, [known], { ...options, kinds: [unknown.kind, known.kind] });
    expect(await job(id)).toMatchObject({
      state: "queued",
      attempt: 0,
      lease_token: null,
      last_error: null,
    });
    expect(await tamperedEvents(unknown.kind)).toBe(0);
    passed(task.name);
  });

  it("B16 barrier active: an empty or NULL allowed build set rejects every claim", async ({
    task,
  }) => {
    await activate([A], A);
    const def = definition();
    const id = await enqueue(def);
    for (const allowed of [[], null]) {
      await admin
        .updateTable("plt.job_lease_generation")
        .set({ allowed_builds: allowed })
        .execute();
      expect(await triggerState()).toBe("O");
      for (const build of [A, B, undefined])
        await expect(claimJobs(app, [def.kind], 1, new Date(), undefined, build)).rejects.toThrow(
          REFUSED,
        );
      await expect(oldClaim(def.kind)).rejects.toThrow(REFUSED);
    }
    expect(await job(id)).toMatchObject({ state: "queued", attempt: 0 });
    passed(task.name);
  });
});
