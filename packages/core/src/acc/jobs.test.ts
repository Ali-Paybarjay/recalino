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
import type { LogValue } from "../plt";
import { accPeriodicJobs } from "./jobs";

// P5-01 (P4-01 AC-5): ACC schedules PLT's count of rows without an account. The real Kysely
// compiler runs over an in-memory stand-in for the two PLT tables and ACC's account table, so the
// case sees every statement of a scheduled run. Nothing reaches a database.

type Row = { id: string; user_id: string };
type Account = { id: string; deleted_at: Date | null };
type Tables = {
  "plt.push_subscription": Row[];
  "plt.notification": Row[];
  "acc.user_account": Account[];
};

function fakeDatabase(tables: Tables) {
  const log: string[] = [];
  const param = (query: CompiledQuery, placeholder: string) =>
    query.parameters[Number(placeholder.slice(1)) - 1] as string;
  const list = (query: CompiledQuery, column: string) => {
    const match = query.sql.match(new RegExp(`"${column}" in \\(([^)]*)\\)`));
    return match ? (match[1] as string).split(", ").map((p) => param(query, p)) : null;
  };
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      log.push(query.sql);
      const from = query.sql.match(/from "(\w+)"\."(\w+)"/);
      const name = from ? (`${from[1]}.${from[2]}` as keyof Tables) : undefined;
      if (!name || !(name in tables)) throw new Error(`unexpected statement: ${query.sql}`);
      if (name === "acc.user_account") {
        if (!query.sql.startsWith('select "id" from "acc"."user_account" where "id" in ('))
          throw new Error(`unexpected statement: ${query.sql}`);
        const ids = list(query, "id") ?? [];
        const rows = tables[name].filter((row) => ids.includes(row.id));
        return { rows: rows.map(({ id }) => ({ id })) as R[] };
      }
      const users = list(query, "user_id");
      const limit = query.sql.match(/limit (\$\d+)/)?.[1];
      const after = query.sql.match(/"user_id" > (\$\d+)/)?.[1];
      const max = limit ? Number(param(query, limit)) : Number.POSITIVE_INFINITY;
      const matching = tables[name].filter(
        (row) =>
          (!users || users.includes(row.user_id)) && (!after || row.user_id > param(query, after)),
      );
      if (query.sql.startsWith('select distinct "user_id"')) {
        const distinct = [...new Set(matching.map((row) => row.user_id))].sort();
        return { rows: distinct.slice(0, max).map((user_id) => ({ user_id })) as R[] };
      }
      if (query.sql.startsWith("select count(*)"))
        return { rows: [{ count: String(matching.length) }] as R[] };
      throw new Error(`unexpected statement: ${query.sql}`);
    },
    async *streamQuery<R>() {
      yield { rows: [] as R[] };
    },
  };
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return connection;
    }
    override async beginTransaction() {
      log.push("begin");
    }
    override async commitTransaction() {
      log.push("commit");
    }
    override async rollbackTransaction() {
      log.push("rollback");
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
  return { db, log, tables };
}

const ORPHAN_KIND = "plt.count_account_orphans";

function scheduled(kind: string) {
  const job = accPeriodicJobs().find((entry) => entry.definition.kind === kind);
  if (!job) throw new Error(`${kind} is not an ACC periodic job`);
  return job;
}

describe("ACC periodic jobs (P5-01)", () => {
  it("schedule the account orphan count with the interval of ACC's other periodic job", () => {
    const kinds = accPeriodicJobs().map((entry) => entry.definition.kind);
    expect(kinds).toEqual(["acc.purge_signup_intents", ORPHAN_KIND]);
    const job = scheduled(ORPHAN_KIND);
    expect(job.everySeconds).toBe(scheduled("acc.purge_signup_intents").everySeconds);
    // An empty strict payload: a scheduled run can never carry apply or any other option.
    expect(job.definition.payload.safeParse({}).success).toBe(true);
    expect(job.definition.payload.safeParse({ apply: true }).success).toBe(false);
    expect(job.definition.payload.safeParse({ limit: 10 }).success).toBe(false);
  });

  it("run the scheduled count with ACC's existingAccountIds, log counts only and remove nothing", async () => {
    const active = randomUUID();
    const tombstoned = randomUUID();
    const gone = randomUUID();
    const goneToo = randomUUID();
    const rows = (...users: string[]) => users.map((user_id) => ({ id: randomUUID(), user_id }));
    const { db, log, tables } = fakeDatabase({
      "plt.push_subscription": rows(active, tombstoned, gone, gone, goneToo),
      "plt.notification": rows(active, active, tombstoned, gone),
      "acc.user_account": [
        { id: active, deleted_at: null },
        { id: tombstoned, deleted_at: new Date("2026-10-01T00:00:00Z") },
      ],
    });
    const before = structuredClone(tables);
    const lines: Array<{ event: string; fields?: Record<string, LogValue> }> = [];
    const job = scheduled(ORPHAN_KIND);
    await job.definition.run(
      {},
      {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran",
        log: (_level, event, fields) => lines.push({ event, ...(fields ? { fields } : {}) }),
      },
    );
    expect(lines).toEqual([
      {
        event: "account_orphans_swept",
        fields: {
          module: "plt",
          kind: "push_subscription",
          state: "dry_run",
          measured: 3,
          dropped: 0,
        },
      },
      {
        event: "account_orphans_swept",
        fields: { module: "plt", kind: "notification", state: "dry_run", measured: 1, dropped: 0 },
      },
    ]);
    // ACC was asked through existingAccountIds: any account row, with no deleted_at predicate.
    const asked = log.filter((sql) => sql.includes('"acc"."user_account"'));
    expect(asked).toHaveLength(2);
    for (const sql of asked) expect(sql).not.toContain("deleted_at");
    // Counts only, no transaction and no removal.
    expect(log.some((sql) => /^\s*(delete|update|insert)\b/i.test(sql))).toBe(false);
    expect(log).not.toContain("begin");
    expect(tables).toEqual(before);
    const written = JSON.stringify(lines);
    const ids = [
      active,
      tombstoned,
      gone,
      goneToo,
      ...tables["plt.push_subscription"].map((row) => row.id),
      ...tables["plt.notification"].map((row) => row.id),
    ];
    for (const id of ids) expect(written).not.toContain(id);
  });
});
