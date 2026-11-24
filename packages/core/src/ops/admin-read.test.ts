import { randomUUID } from "node:crypto";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { isConservativelyClosedAttempt, isUnownedOpenAttempt } from "../proc";
import { type AdminReadConfiguration, readAdminSnapshot } from "./admin-read";

const configuration = {} as AdminReadConfiguration;
const directory = { getUser: async () => ({ name: null, email: null, language: "en" as const }) };

type Attempt = { state: string; started_at: Date };
/** One row of the reconciliation's attempt facts, as Postgres answers it (snake_case columns). */
type FactRow = {
  attempt_id: string;
  user_id: string;
  run_id: string;
  hold_id: string;
  operation_key: string;
  provider: string;
  model: string;
  estimate_price_version: string | null;
  attempt_state: string;
  run_state: string;
  /** The run's job; its state is answered by PLT's own read (jobStates), as Postgres would. */
  job_id: string | null;
  job_state: string | null;
  hold_currency: string;
  hold_maximum_micros: string;
  hold_created_at: Date;
  hold_closed: boolean;
  cost_recorded: boolean;
  /**
   * P12-01 (AC-20, AC-23): the states of the latest jobs that carry the run's id in their payload
   * (PLT's latestJobStateForPayload, one per kind), latest first; none after a purge.
   */
  run_jobs?: string[];
};

/**
 * Real Kysely compiler; a small stand-in answers each table of the costs view. The attempt
 * outcome query is answered by applying its own state filter and window to the fixture attempts;
 * the reconciliation's attempt facts query (P12-01) is answered with the fixture facts as they are,
 * so the classification itself decides what is counted.
 */
function costsDatabase(attempts: Attempt[], unknownCosts: number, facts: FactRow[] = []) {
  const seen: CompiledQuery[] = [];
  const answer = (query: CompiledQuery): unknown[] => {
    seen.push(query);
    // Kysely quotes builder table names ("quota"."provider_cost"); raw sql keeps them bare.
    const table = (name: string) => query.sql.replaceAll('"', "").includes(name);
    if (table("proc.provider_attempt as a")) return facts;
    if (table("plt.job") && query.sql.includes("payload")) {
      // PLT's latest job of a kind that carries a run's id: the fixture's run_jobs, latest first.
      const carried = query.parameters
        .filter((value): value is string => typeof value === "string" && value.includes("runId"))
        .map((value) => (JSON.parse(value) as { runId: string }).runId);
      const row = facts.find((item) => carried.includes(item.run_id));
      const latest = row?.run_jobs?.[0];
      return latest ? [{ state: latest }] : [];
    }
    if (table("plt.job"))
      return facts.flatMap((row) =>
        row.job_id && row.job_state ? [{ id: row.job_id, state: row.job_state }] : [],
      );
    if (table("quota.provider_cost"))
      return [
        {
          provider: "openai",
          model: "test-model",
          currency: "USD",
          price_version: "v1",
          count: "3",
          actual: "100",
          estimated: "50",
          unknown: String(unknownCosts),
        },
      ];
    if (table("quota.cost_hold")) return [{ currency: "USD", count: "1", maximum: "70" }];
    if (table("quota.cost_policy"))
      return [
        {
          version: "policy-1",
          currency: "USD",
          kill_switch: false,
          limits: { session: 1, userMonth: 2, systemDay: 3, systemMonth: 4 },
        },
      ];
    if (table("ops.admin_attempt_outcome")) {
      const arrays = query.parameters.filter((value) => Array.isArray(value)) as string[][];
      const states = arrays.length
        ? arrays.flat()
        : [...query.sql.matchAll(/state\s*=\s*'([a-z_]+)'/g)].map((match) => match[1]);
      const since = query.parameters.find((value) => value instanceof Date);
      if (!(since instanceof Date) || states.length === 0) throw new Error("unexpected_query");
      const count = attempts.filter(
        (attempt) => states.includes(attempt.state) && attempt.started_at >= since,
      ).length;
      return [{ count: String(count) }];
    }
    throw new Error("unexpected_query");
  };
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      return { rows: answer(query) as R[] };
    },
    async *streamQuery<R>() {
      yield { rows: [] as R[] };
    },
  };
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return connection;
    }
  }
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, seen };
}

// C9-6 (P9-04, F-6): an attempt left in `started` has no known provider outcome; once its hold is
// closed the operator still has to see it among the unknown outcomes, like an `uncertain` one.
describe("admin costs unknown outcomes", () => {
  it("counts a started provider attempt like an uncertain one, and nothing else", async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const { db } = costsDatabase(
      [
        { state: "started", started_at: thisMonth },
        { state: "uncertain", started_at: thisMonth },
        { state: "succeeded", started_at: thisMonth },
        { state: "failed", started_at: thisMonth },
        { state: "started", started_at: lastMonth },
        { state: "uncertain", started_at: lastMonth },
      ],
      2,
    );
    const snapshot = await readAdminSnapshot(
      db,
      { view: "costs", actorId: randomUUID() },
      directory,
      configuration,
    );
    expect(snapshot).toEqual({
      view: "costs",
      costs: {
        actualMicros: 100,
        estimatedMicros: 50,
        reservedMicros: 70,
        // Two costs without an amount, one started and one uncertain attempt of this month.
        unknownCount: 4,
        currency: "USD",
        version: "policy-1",
        killSwitch: false,
        limits: { session: 1, userMonth: 2, systemDay: 3, systemMonth: 4 },
        // P12-01 (AC-8): no attempt facts, nothing conservatively closed or left open.
        conservativelyClosedAttempts: 0,
        unownedOpenAttempts: 0,
      },
    });
  });
});

// P12-01 (AC-8; r1; E477 rules 2 and 3): the two counts beside the unknown outcomes.
describe("admin costs reconciliation counts (P12-01)", () => {
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1));
  const fact = (name: string, overrides: Partial<FactRow>): FactRow & { name: string } => ({
    name,
    attempt_id: randomUUID(),
    user_id: randomUUID(),
    run_id: randomUUID(),
    hold_id: randomUUID(),
    operation_key: `${randomUUID()}:knowledge:1`,
    provider: "synthetic",
    model: "synthetic/llm",
    estimate_price_version: null,
    attempt_state: "started",
    run_state: "cancelled",
    job_id: randomUUID(),
    job_state: "cancelled",
    hold_currency: "USD",
    // An ordinary estimated settle at the hold's maximum has this same amount and empty usage.
    hold_maximum_micros: "9000",
    hold_created_at: thisMonth,
    hold_closed: false,
    cost_recorded: false,
    ...overrides,
  });
  const facts = [
    // The three-part record: unresolved attempt, its own hold closed, a row with its id.
    fact("conservative", { hold_closed: true, cost_recorded: true }),
    // Ordinary estimated settle with the same amount and usage: its attempt is resolved.
    fact("estimated settle", {
      attempt_state: "succeeded",
      hold_closed: true,
      cost_recorded: true,
    }),
    // Definite failure, settled at its own cost.
    fact("definite failure", { attempt_state: "failed", hold_closed: true, cost_recorded: true }),
    // A hold closed without a row for this attempt is not a conservative close.
    fact("closed hold without row", { hold_closed: true, cost_recorded: false }),
    // Live work: a job with a valid lease, and jobs that will be dispatched again.
    fact("live claim", { run_state: "processing", job_state: "running" }),
    fact("queued again", { run_state: "processing", job_state: "queued" }),
    fact("retry scheduled", { run_state: "processing", job_state: "retry_scheduled" }),
    // Stuck: cancelled mid-dispatch, last try failed, and a finished job purged (AC-14).
    fact("cancelled mid-dispatch", { run_state: "cancelled", job_state: "cancelled" }),
    fact("last try failed", {
      attempt_state: "uncertain",
      run_state: "needs_input",
      job_state: "failed",
    }),
    fact("job purged", { run_state: "processing", job_id: null, job_state: null }),
    // AC-20: data older code left, a null pointer while a job of the run is still there: no
    // ownership proven either way, so kept from the automatic close and from this count.
    fact("legacy null pointer, job left", {
      run_state: "processing",
      job_id: null,
      job_state: null,
      run_jobs: ["succeeded"],
    }),
    // AC-23 (R2-P1201-02, review:security round five): a live job carries the run although the
    // pointer is null, or names a cancelled job: its attempt is that job's own.
    fact("legacy null pointer, live continuation", {
      run_state: "processing",
      job_id: null,
      job_state: null,
      run_jobs: ["running"],
    }),
    fact("cancelled, live continuation", {
      run_state: "cancelled",
      job_state: "cancelled",
      run_jobs: ["running"],
    }),
  ];
  const live = (state: string | null | undefined): state is string =>
    state != null && ["queued", "running", "retry_scheduled"].includes(state);
  /** The facts as providerAttemptFacts derives them from these rows. */
  const classify = (row: FactRow) => {
    const others = row.run_jobs ?? [];
    const pointer = row.job_id ? row.job_state : null;
    const jobState = live(pointer) ? pointer : (others.find(live) ?? pointer);
    const facts = {
      attemptState: row.attempt_state,
      runState: row.run_state,
      jobState,
      holdClosed: row.hold_closed,
      costRecorded: row.cost_recorded,
      pointerUnproven: row.job_id === null && jobState === null && others.length > 0,
    };
    return {
      conservative: isConservativelyClosedAttempt(facts),
      unowned: isUnownedOpenAttempt(facts),
    };
  };

  it("recognises a conservative close only from all three parts of the same attempt", () => {
    expect(facts.filter((row) => classify(row).conservative).map((row) => row.name)).toEqual([
      "conservative",
    ]);
  });

  it("counts a stuck attempt as still open without authority, and never a live job's attempt", () => {
    expect(facts.filter((row) => classify(row).unowned).map((row) => row.name)).toEqual([
      "cancelled mid-dispatch",
      "last try failed",
      "job purged",
    ]);
    for (const name of [
      "live claim",
      "queued again",
      "retry scheduled",
      "legacy null pointer, job left",
      "legacy null pointer, live continuation",
      "cancelled, live continuation",
    ])
      expect(classify(facts.find((row) => row.name === name) as FactRow).unowned).toBe(false);
  });

  it("shows both counts in the costs output and keeps every unresolved attempt among the unknown outcomes", async () => {
    // The same attempts as the outcome view sees them: every unresolved one started this month.
    const attempts = facts.map((row) => ({ state: row.attempt_state, started_at: thisMonth }));
    const unresolved = attempts.filter((row) => ["started", "uncertain"].includes(row.state));
    const { db, seen } = costsDatabase(
      attempts,
      2,
      facts.map(({ name: _name, ...row }) => row),
    );
    const snapshot = await readAdminSnapshot(
      db,
      { view: "costs", actorId: randomUUID() },
      directory,
      configuration,
    );
    expect(snapshot.costs).toMatchObject({
      conservativelyClosedAttempts: 1,
      unownedOpenAttempts: 3,
      // E477 rule 3: unchanged; the conservative record and every stuck attempt stay in it.
      unknownCount: 2 + unresolved.length,
    });
    expect(unresolved).toHaveLength(11);
    // The facts are read for this month's closed holds and every open one, unresolved only.
    const query = seen.find((entry) =>
      entry.sql.replaceAll('"', "").includes("proc.provider_attempt as a"),
    );
    expect(query?.parameters).toEqual(
      expect.arrayContaining([
        "started",
        "uncertain",
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      ]),
    );
    // Counts only: no attempt, run, user or hold identifier leaves in the output.
    const output = JSON.stringify(snapshot);
    for (const row of facts)
      for (const id of [row.attempt_id, row.user_id, row.run_id, row.hold_id])
        expect(output).not.toContain(id);
  });
});
