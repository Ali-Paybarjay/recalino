import { Kysely, PostgresDialect, type PostgresPoolClient, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB, Tx } from "../db";
import {
  assertJobAuthority,
  type ClaimedJob,
  claimJobs,
  completeJob,
  failJob,
  JobCancelled,
  JobLeaseLost,
  jobLease,
  keepRenewing,
  renewalTimeoutMs,
  renewJobLease,
  runJobStep,
  sweepJobs,
} from "./jobs";

afterEach(() => {
  vi.useRealTimers();
});

// Recalino ADR-0004 rule 2, P11-01 AC-4: a renewal that does not settle within its bound, or
// fails, counts as a lost claim. This replaces the earlier rule "a renewal that never settles does
// not stop the next one", under which a runner went on renewing after an unknown answer.
it("FR-PLT-005 rule 5, ADR-0004 rule 2: a renewal unsettled past its bound counts as lost, and a late answer does not bring the claim back", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  let answer: (renewed: boolean) => void = () => {};
  const renew = vi
    .fn<() => Promise<boolean>>()
    // A query on a connection that answers only after the bound.
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    )
    .mockImplementation(async () => true);
  const stop = keepRenewing(renew, 1000, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(800);
  expect(events).toEqual(["job_lease_renewal_timeout", "job_lease_lost"]);
  answer(true); // the late answer
  await vi.advanceTimersByTimeAsync(5000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["job_lease_renewal_timeout", "job_lease_lost"]);
  await stop();
});

// Recalino ADR-0004 rule 2, P11-01 AC-4: replaces "at most two unsettled renewals hold pool
// connections at once"; a failed renewal now ends renewing, so at most one is ever in flight.
it("FR-PLT-005 rule 5, ADR-0004 rule 2: a failed renewal counts as lost and no renewal follows", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const renew = vi.fn(async (): Promise<boolean> => {
    throw new Error("canceling statement due to statement timeout");
  });
  const stop = keepRenewing(renew, 1000, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["job_lease_renewal_failed", "job_lease_lost"]);
  await stop();
});

it("FR-PLT-005 rule 5: stopping waits for a renewal in flight only up to its bound", async () => {
  vi.useFakeTimers();
  const stop = keepRenewing(
    () => new Promise<boolean>(() => {}),
    1000,
    () => {},
  );
  await vi.advanceTimersByTimeAsync(1000);
  let stopped = false;
  const stopping = stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(799);
  expect(stopped).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await stopping;
  expect(stopped).toBe(true);
});

it("FR-PLT-005 rule 5: a lost claim stops further renewals", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const renew = vi.fn(async () => false);
  const stop = keepRenewing(renew, 1000, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(3000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["job_lease_lost"]);
  await stop();
});

it("ADR-0004 rule 2: a renewal's statement timeout is shorter than its period", () => {
  for (const every of [5, 100, 1000, 225_000]) {
    expect(renewalTimeoutMs(every)).toBeGreaterThanOrEqual(1);
    expect(renewalTimeoutMs(every)).toBeLessThan(every);
  }
});

type Call = { sql: string; parameters: readonly unknown[] };

/**
 * The real Kysely compiler against a synthetic client that records every statement and answers
 * from `answer`, so the SQL each function sends is visible without a database.
 */
function database(answer: (sql: string) => unknown[] = () => []) {
  const calls: Call[] = [];
  const normal = (statement: string) => statement.replace(/\s+/g, " ").trim();
  const query = async (statement: string, parameters: readonly unknown[] = []) => {
    calls.push({ sql: statement, parameters });
    const rows = answer(normal(statement));
    const verb = normal(statement).split(" ")[0]?.toUpperCase() ?? "";
    return {
      command: ["INSERT", "UPDATE", "DELETE"].includes(verb) ? verb : "SELECT",
      rowCount: rows.length,
      rows,
    };
  };
  const client = { query, release() {} } as unknown as PostgresPoolClient;
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: { options: {}, connect: async () => client, end: async () => {} },
    }),
  });
  return { db, calls, statements: () => calls.map((call) => normal(call.sql)) };
}

const JOB_ID = "6f1c2c62-6f43-4c27-9a3e-2f6c0b8f1b55";
const TOKEN = "0b6f6a0e-7f1d-4c38-8d39-2a5d3f0c9e14";
const PROCESS_TIME = new Date("2001-01-01T00:00:00Z"); // far from the database clock on purpose

const claimed = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: JOB_ID,
  kind: "test.kind",
  payload: {},
  payloadVersion: 1,
  attempt: 1,
  token: TOKEN,
  leaseSeconds: 60,
  generation: 1,
  ...overrides,
});

/** The four authority conditions of ADR-0004 rule 2, on the database clock. */
const AUTHORITY =
  /j\.id = \$\d+ and j\.state = 'running' and j\.lease_token = \$\d+ and j\.lease_until > statement_timestamp\(\) and j\.lease_generation = \$\d+ and j\.lease_generation = \(select g\.generation from plt\.job_lease_generation g\)/;

/** No lease_until is ever set from, or compared with, a value the caller sent (AC-3). */
function expectNoProcessClockLease(statements: string[]) {
  for (const statement of statements) {
    expect(statement).not.toMatch(/lease_until"? ?(=|<|>|<=|>=) ?\$\d/);
    expect(statement).not.toMatch(/\$\d+(::timestamptz)? ?(<|>|<=|>=) ?"?(j\.)?lease_until/);
  }
}

describe("ADR-0004 rule 2: a claim without a lease has no authority (fail-closed)", () => {
  const withoutLease = claimed({ generation: undefined });

  it("complete, fail and renew refuse it without sending any statement", async () => {
    const { db, calls } = database();
    expect(jobLease(withoutLease)).toBeUndefined();
    expect(await completeJob(db, withoutLease, PROCESS_TIME)).toBe(false);
    expect(await failJob(db, withoutLease, "test_reason", PROCESS_TIME)).toBeNull();
    expect(await renewJobLease(db, withoutLease, PROCESS_TIME)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("assertJobAuthority refuses a missing or malformed lease before any statement", async () => {
    const { db, calls } = database();
    await db.transaction().execute(async (tx) => {
      for (const lease of [
        undefined,
        { id: JOB_ID, token: TOKEN, generation: Number.NaN },
        { id: JOB_ID, token: "", generation: 1 },
        { id: "", token: TOKEN, generation: 1 },
      ])
        await expect(assertJobAuthority(tx, lease)).rejects.toBeInstanceOf(JobLeaseLost);
    });
    expect(calls.map((call) => call.sql)).toEqual(["begin", "commit"]);
  });

  it("runJobStep keeps the cancelled check first, then refuses and rolls back before the step", async () => {
    const { db, statements } = database((sql) =>
      sql.startsWith('select "state"') ? [{ state: "running" }] : [],
    );
    const effect = vi.fn(async (_tx: Tx) => {});
    await expect(runJobStep(db, withoutLease, "only", effect, PROCESS_TIME)).rejects.toBeInstanceOf(
      JobLeaseLost,
    );
    expect(effect).not.toHaveBeenCalled();
    expect(statements()).toEqual([
      "begin",
      'select "state" from "plt"."job" where "id" = $1 for update',
      "rollback",
    ]);
  });

  it("JobLeaseLost stops a handler the way a cancellation does", () => {
    const lost = new JobLeaseLost();
    expect(lost).toBeInstanceOf(JobCancelled);
    expect(lost.name).toBe("JobLeaseLost");
  });
});

describe("ADR-0004 rules 2 and 4: one authority condition, on the database clock", () => {
  it("assertJobAuthority locks the job row, then checks all four conditions; no row throws", async () => {
    let holds = true;
    const { db, statements } = database((sql) =>
      sql.includes("from plt.job j where") && holds ? [{ id: JOB_ID }] : [],
    );
    const lease = { id: JOB_ID, token: TOKEN, generation: 1 };
    await db.transaction().execute((tx) => assertJobAuthority(tx, lease));
    const [begin, lock, check, commit] = statements();
    expect([begin, commit]).toEqual(["begin", "commit"]);
    expect(lock).toBe("select id from plt.job where id = $1 for update");
    expect(check).toMatch(AUTHORITY);
    holds = false;
    await expect(
      db.transaction().execute((tx) => assertJobAuthority(tx, lease)),
    ).rejects.toBeInstanceOf(JobLeaseLost);
    expect(statements().at(-1)).toBe("rollback");
  });

  it("runJobStep: cancelled check, lock and authority check, then the step key and its effect, in one transaction", async () => {
    const { db, statements } = database((sql) => {
      if (sql.startsWith('select "state"')) return [{ state: "running" }];
      if (sql.includes("from plt.job j where")) return [{ id: JOB_ID }];
      if (sql.startsWith('insert into "plt"."job_step"')) return [{ step: "only" }];
      return [];
    });
    const effect = vi.fn(async (tx: Tx) => {
      await sql`select 'effect'`.execute(tx);
    });
    expect(await runJobStep(db, claimed(), "only", effect, PROCESS_TIME)).toBe("ran");
    const sent = statements();
    expect(sent[0]).toBe("begin");
    expect(sent[1]).toBe('select "state" from "plt"."job" where "id" = $1 for update');
    expect(sent[2]).toBe("select id from plt.job where id = $1 for update");
    expect(sent[3]).toMatch(AUTHORITY);
    expect(sent[4]).toMatch(/^insert into "plt"."job_step"/);
    expect(sent[5]).toBe("select 'effect'");
    expect(sent[6]).toBe("commit");
    expect(sent).toHaveLength(7);
  });

  it("runJobStep: a cancelled job throws JobCancelled before the authority check", async () => {
    const { db, statements } = database((sql) =>
      sql.startsWith('select "state"') ? [{ state: "cancelled" }] : [],
    );
    const error = await runJobStep(db, claimed(), "only", async () => {}, PROCESS_TIME).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(JobCancelled);
    expect(error).not.toBeInstanceOf(JobLeaseLost);
    expect(statements()).toEqual([
      "begin",
      'select "state" from "plt"."job" where "id" = $1 for update',
      "rollback",
    ]);
  });

  it("runJobStep: a refused check rolls back without the step key or its effect", async () => {
    const { db, statements } = database((sql) =>
      sql.startsWith('select "state"') ? [{ state: "running" }] : [],
    );
    const effect = vi.fn(async (_tx: Tx) => {});
    await expect(runJobStep(db, claimed(), "only", effect, PROCESS_TIME)).rejects.toBeInstanceOf(
      JobLeaseLost,
    );
    expect(effect).not.toHaveBeenCalled();
    expect(statements().some((sql) => sql.includes("job_step"))).toBe(false);
    expect(statements().at(-1)).toBe("rollback");
  });

  it("completeJob and failJob update only under the authority condition, and zero rows is no success", async () => {
    let holds = true;
    const { db, statements } = database((sql) =>
      sql.startsWith("update plt.job j") && holds ? [{ state: "retry_scheduled" }] : [],
    );
    expect(await completeJob(db, claimed(), PROCESS_TIME)).toBe(true);
    expect(await failJob(db, claimed(), "test_reason", PROCESS_TIME)).toBe("retry_scheduled");
    holds = false;
    expect(await completeJob(db, claimed(), PROCESS_TIME)).toBe(false);
    expect(await failJob(db, claimed(), "test_reason", PROCESS_TIME)).toBeNull();
    const sent = statements();
    const updates = sent.filter((sql) => sql.startsWith("update plt.job j"));
    expect(updates).toHaveLength(4);
    for (const update of updates) expect(update).toMatch(AUTHORITY);
    // Each update follows the row lock in its own transaction.
    for (let index = 0; index < sent.length; index++)
      if (sent[index]?.startsWith("update plt.job j"))
        expect(sent[index - 1]).toBe("select id from plt.job where id = $1 for update");
    expectNoProcessClockLease(sent);
  });

  it("renewJobLease sets a statement timeout, locks, and extends from the database clock only under the authority condition", async () => {
    let holds = true;
    const { db, calls, statements } = database((sql) =>
      sql.startsWith("update plt.job j") && holds ? [{}] : [],
    );
    expect(await renewJobLease(db, claimed(), PROCESS_TIME, { timeoutMs: 50 })).toBe(true);
    const sent = statements();
    expect(sent[0]).toBe("begin");
    expect(sent[1]).toBe("select set_config('statement_timeout', $1, true)");
    expect(calls[1]?.parameters).toEqual(["50"]);
    expect(sent[2]).toBe("select id from plt.job where id = $1 for update");
    expect(sent[3]).toMatch(
      /^update plt\.job j set lease_until = statement_timestamp\(\) \+ make_interval\(secs => j\.lease_seconds\) where /,
    );
    expect(sent[3]).toMatch(AUTHORITY);
    expect(sent[4]).toBe("commit");
    // The process clock is not sent at all.
    expect(calls.flatMap((call) => call.parameters)).not.toContainEqual(PROCESS_TIME);
    holds = false;
    expect(await renewJobLease(db, claimed(), PROCESS_TIME)).toBe(false);
    // The default timeout is half the default period, a quarter of the lease.
    expect(calls.at(-4)?.parameters).toEqual([String(renewalTimeoutMs(15_000))]);
    expectNoProcessClockLease(statements());
  });

  it("claimJobs sets the lease from the database clock and records the current generation", async () => {
    const { db, statements } = database((sql) =>
      sql.includes("update plt.job j")
        ? [
            {
              id: JOB_ID,
              kind: "test.kind",
              payload: {},
              payload_version: 1,
              attempt: 1,
              lease_token: TOKEN,
              lease_seconds: 60,
              lease_generation: 4,
            },
          ]
        : [],
    );
    const [job] = await claimJobs(db, ["test.kind"], 1, PROCESS_TIME);
    expect(job).toMatchObject({ id: JOB_ID, token: TOKEN, generation: 4 });
    const [claim] = statements();
    expect(claim).toMatch(
      /with generation as \( select g\.generation from plt\.job_lease_generation g \)/,
    );
    expect(claim).toMatch(
      /lease_until = statement_timestamp\(\) \+ make_interval\(secs => j\.lease_seconds\)/,
    );
    expect(claim).toMatch(/lease_generation = generation\.generation/);
    expect(claim).toMatch(/from picked, generation where j\.id = picked\.id/);
    // The caller's time decides only which jobs are due, and the record.
    expect(claim).toMatch(/run_at <= \$\d/);
    expectNoProcessClockLease(statements());
  });

  it("sweepJobs compares the lease with the database clock, without a generation condition", async () => {
    const { db, statements } = database();
    await sweepJobs(db, PROCESS_TIME);
    const [sweep] = statements();
    expect(sweep).toMatch(/where state = 'running' and lease_until < statement_timestamp\(\)$/);
    expect(sweep).not.toMatch(/generation/);
    expectNoProcessClockLease(statements());
  });
});
