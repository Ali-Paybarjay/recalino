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
import {
  ACCOUNT_ORPHAN_MAX_LIMIT,
  accountOrphansJob,
  type ExistingAccountIds,
  sweepAccountOrphans,
} from "./account-orphans";
import type { LogValue } from "./log";

// P4-01 (E123 b): the real Kysely compiler over an in-memory stand-in for the two PLT tables, so
// each case sees exactly which statements ran and which rows remain. Nothing reaches a database.

type Row = { id: string; user_id: string };
type Tables = Record<"push_subscription" | "notification", Row[]>;

/**
 * P5-02 (CWE-367): the DELETE's own check that the row's user has no account row, active or
 * tombstoned, as ACC's `accountRowOf` compiles it.
 */
const noAccountRow = (name: string) =>
  ` and not exists (select "acc"."user_account"."id" from "acc"."user_account" where "acc"."user_account"."id" = "plt"."${name}"."user_id")`;

/** `accountRows` holds the account rows the database sees when a statement runs. */
function fakeDatabase(tables: Tables, accountRows: ReadonlySet<string> = new Set()) {
  const log: string[] = [];
  const params = (query: CompiledQuery) => (placeholder: string) =>
    query.parameters[Number(placeholder.slice(1)) - 1] as string;
  const lists = (query: CompiledQuery, column: string) => {
    const match = query.sql.match(new RegExp(`"${column}" in \\(([^)]*)\\)`));
    return match ? (match[1] as string).split(", ").map(params(query)) : null;
  };
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      log.push(query.sql);
      const name = query.sql.match(/from "plt"\."(\w+)"/)?.[1] as keyof Tables;
      const table = tables[name];
      if (!table) throw new Error(`unexpected statement: ${query.sql}`);
      const users = lists(query, "user_id");
      const ids = lists(query, "id");
      const limit = query.sql.match(/limit (\$\d+)/)?.[1];
      const after = query.sql.match(/"user_id" > (\$\d+)/)?.[1];
      const max = limit ? Number(params(query)(limit)) : Number.POSITIVE_INFINITY;
      const matching = table.filter(
        (row) =>
          (!users || users.includes(row.user_id)) &&
          (!ids || ids.includes(row.id)) &&
          (!after || row.user_id > params(query)(after)),
      );
      if (query.sql.startsWith("delete from")) {
        // Only a DELETE that ends with its own account check skips rows of an existing account.
        const checked = query.sql.endsWith(noAccountRow(name));
        const removed = matching.filter((row) => !checked || !accountRows.has(row.user_id));
        tables[name] = table.filter((row) => !removed.includes(row));
        return { rows: [] as R[], numAffectedRows: BigInt(removed.length) };
      }
      if (query.sql.startsWith('select distinct "user_id"')) {
        const distinct = [...new Set(matching.map((row) => row.user_id))].sort();
        return { rows: distinct.slice(0, max).map((user_id) => ({ user_id })) as R[] };
      }
      if (query.sql.startsWith("select count(*)"))
        return { rows: [{ count: String(matching.length) }] as R[] };
      if (query.sql.startsWith('select "id"')) {
        const sorted = [...matching].sort((a, b) => a.id.localeCompare(b.id));
        return { rows: sorted.slice(0, max).map(({ id }) => ({ id })) as R[] };
      }
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

/**
 * PLT may not import ACC (capability map), so this stands in ACC's `accountRowOf` with the same
 * query: the account row of a user id, active or tombstoned.
 */
const accountRow: ExistingAccountIds["accountRow"] = (db, userId) =>
  db
    .selectFrom("acc.user_account")
    .select("acc.user_account.id")
    .where("acc.user_account.id", "=", userId);
function withAccountRow(
  ids: (db: Parameters<ExistingAccountIds>[0], userIds: readonly string[]) => Promise<Set<string>>,
): ExistingAccountIds {
  return Object.assign(ids, { accountRow });
}

/** ACC's contract: an id with any account row exists, active or tombstoned (soft-deleted). */
function accounts(rows: Record<string, { deletedAt: Date | null }>): ExistingAccountIds {
  return withAccountRow(async (_db, userIds) => new Set(userIds.filter((id) => id in rows)));
}

const ACTIVE = randomUUID();
const TOMBSTONED = randomUUID();
const GONE = randomUUID();
const GONE_TOO = randomUUID();
const existing = accounts({
  [ACTIVE]: { deletedAt: null },
  [TOMBSTONED]: { deletedAt: new Date() },
});

function rows(...users: string[]): Row[] {
  return users.map((user_id) => ({ id: randomUUID(), user_id }));
}
function fixture(accountRows: Set<string> = new Set([ACTIVE, TOMBSTONED])) {
  return fakeDatabase(
    {
      push_subscription: rows(ACTIVE, TOMBSTONED, GONE, GONE, GONE_TOO),
      notification: rows(ACTIVE, ACTIVE, TOMBSTONED, GONE, GONE_TOO),
    },
    accountRows,
  );
}
const users = (table: Row[]) => table.map((row) => row.user_id).sort();
const isDelete = (statement: string) => /^delete\b/i.test(statement);

describe("rows of plt without an account (P4-01, E123 b)", () => {
  it("counts rows without an account by default and removes nothing", async () => {
    const { db, log, tables } = fixture();
    const before = structuredClone(tables);
    const lines: Array<{ event: string; fields?: Record<string, LogValue> }> = [];
    const summary = await sweepAccountOrphans(db, existing, {
      log: (_level, event, fields) => lines.push({ event, ...(fields ? { fields } : {}) }),
    });
    expect(summary).toEqual({
      mode: "dry_run",
      found: { pushSubscriptions: 3, notifications: 2 },
      removed: { pushSubscriptions: 0, notifications: 0 },
    });
    expect(log.some(isDelete)).toBe(false);
    expect(log).not.toContain("begin");
    expect(tables).toEqual(before);
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
        fields: { module: "plt", kind: "notification", state: "dry_run", measured: 2, dropped: 0 },
      },
    ]);
    // Counts only: no user id or row id of any table reaches the log.
    const written = JSON.stringify(lines);
    for (const id of [ACTIVE, TOMBSTONED, GONE, GONE_TOO, ...tables.notification.map((r) => r.id)])
      expect(written).not.toContain(id);
  });

  it("treats anything but an explicit apply: true as a dry run", async () => {
    const { db, log } = fixture();
    const summary = await sweepAccountOrphans(db, existing, {
      apply: "yes" as unknown as boolean,
      limit: 100,
    });
    expect(summary.mode).toBe("dry_run");
    expect(log.some(isDelete)).toBe(false);
  });

  it("with apply removes only rows without an account, never an active or tombstoned one", async () => {
    const { db, log, tables } = fixture();
    const summary = await sweepAccountOrphans(db, existing, { apply: true });
    expect(summary).toEqual({
      mode: "apply",
      found: { pushSubscriptions: 3, notifications: 2 },
      removed: { pushSubscriptions: 3, notifications: 2 },
    });
    expect(users(tables.push_subscription)).toEqual([ACTIVE, TOMBSTONED].sort());
    expect(users(tables.notification)).toEqual([ACTIVE, ACTIVE, TOMBSTONED].sort());
    expect(log.filter(isDelete)).toHaveLength(2);
    // Running it again finds nothing and changes nothing.
    log.length = 0;
    expect(await sweepAccountOrphans(db, existing, { apply: true })).toEqual({
      mode: "apply",
      found: { pushSubscriptions: 0, notifications: 0 },
      removed: { pushSubscriptions: 0, notifications: 0 },
    });
    expect(log.some(isDelete)).toBe(false);
  });

  it("removes at most the limit per run, over both tables", async () => {
    const { db, tables } = fixture();
    const first = await sweepAccountOrphans(db, existing, { apply: true, limit: 2 });
    expect(first.removed).toEqual({ pushSubscriptions: 2, notifications: 0 });
    expect(tables.push_subscription).toHaveLength(3);
    expect(tables.notification).toHaveLength(5);
    const second = await sweepAccountOrphans(db, existing, { apply: true, limit: 2 });
    expect(second.found).toEqual({ pushSubscriptions: 1, notifications: 2 });
    expect(second.removed).toEqual({ pushSubscriptions: 1, notifications: 1 });
    const third = await sweepAccountOrphans(db, existing, { apply: true, limit: 2 });
    expect(third.removed).toEqual({ pushSubscriptions: 0, notifications: 1 });
    const fourth = await sweepAccountOrphans(db, existing, { apply: true, limit: 2 });
    expect(fourth.removed).toEqual({ pushSubscriptions: 0, notifications: 0 });
    expect(users(tables.push_subscription)).toEqual([ACTIVE, TOMBSTONED].sort());
    expect(users(tables.notification)).toEqual([ACTIVE, ACTIVE, TOMBSTONED].sort());
  });

  it("checks again inside the removal transaction and keeps rows of an account that appeared", async () => {
    const { db, log, tables } = fixture();
    let calls = 0;
    // GONE gets an account between the count and the removal (the second check of each table).
    const appearing = withAccountRow(async (handle, ids) => {
      calls += 1;
      const known = new Set(await existing(handle, ids));
      if (calls % 2 === 0) known.add(GONE);
      return known;
    });
    const summary = await sweepAccountOrphans(db, appearing, { apply: true });
    expect(summary.found).toEqual({ pushSubscriptions: 3, notifications: 2 });
    expect(summary.removed).toEqual({ pushSubscriptions: 1, notifications: 1 });
    expect(users(tables.push_subscription)).toEqual([ACTIVE, TOMBSTONED, GONE, GONE].sort());
    expect(users(tables.notification)).toEqual([ACTIVE, ACTIVE, TOMBSTONED, GONE].sort());
    expect(log.filter((line) => line === "begin")).toHaveLength(2);
    expect(log.filter((line) => line === "commit")).toHaveLength(2);
  });

  it("checks for a missing account in the DELETE itself, so an account committed after every check keeps its rows (P5-02, CWE-367)", async () => {
    // GONE's account row is created and committed after both earlier checks (which still miss
    // it) but before the DELETE runs: only the DELETE's own check can see it.
    const { db, log, tables } = fixture(new Set([ACTIVE, TOMBSTONED, GONE]));
    const summary = await sweepAccountOrphans(db, existing, { apply: true });
    expect(summary.found).toEqual({ pushSubscriptions: 3, notifications: 2 });
    expect(summary.removed).toEqual({ pushSubscriptions: 1, notifications: 1 });
    expect(users(tables.push_subscription)).toEqual([ACTIVE, TOMBSTONED, GONE, GONE].sort());
    expect(users(tables.notification)).toEqual([ACTIVE, ACTIVE, TOMBSTONED, GONE].sort());
    const deletes = log.filter(isDelete);
    expect(deletes).toHaveLength(2);
    for (const [index, name] of ["push_subscription", "notification"].entries()) {
      const statement = deletes[index] as string;
      expect(statement.startsWith(`delete from "plt"."${name}" where "id" in (`)).toBe(true);
      expect(statement.endsWith(noAccountRow(name))).toBe(true);
    }
    // Each DELETE still runs inside its own transaction, after the check there, and commits.
    expect(log.filter((line) => line === "begin")).toHaveLength(2);
    expect(log.filter((line) => line === "commit")).toHaveLength(2);
    expect(log).not.toContain("rollback");
  });

  it("reads user ids page by page, and asks ACC only about each page", async () => {
    const many = Array.from({ length: 1201 }, () => randomUUID());
    const { db, log } = fakeDatabase({ push_subscription: rows(...many), notification: [] });
    const asked: number[] = [];
    const summary = await sweepAccountOrphans(
      db,
      withAccountRow(async (_handle, ids) => {
        asked.push(ids.length);
        return new Set();
      }),
    );
    expect(summary.found.pushSubscriptions).toBe(1201);
    expect(asked).toEqual([500, 500, 201]);
    expect(log.filter((line) => line.startsWith('select distinct "user_id"'))).toHaveLength(4);
  });

  it.each([0, -1, 1.5, ACCOUNT_ORPHAN_MAX_LIMIT + 1, Number.NaN])(
    "refuses the limit %s before any statement",
    async (limit) => {
      const { db, log } = fixture();
      await expect(sweepAccountOrphans(db, existing, { apply: true, limit })).rejects.toThrow(
        /^Invalid account orphan limit$/,
      );
      expect(log).toEqual([]);
    },
  );

  it("schedules as a counting job only: a periodic run never removes rows", async () => {
    const { db, log, tables } = fixture();
    const before = structuredClone(tables);
    const job = accountOrphansJob(existing);
    expect(job.kind).toBe("plt.count_account_orphans");
    expect(job.payload.safeParse({}).success).toBe(true);
    expect(job.payload.safeParse({ apply: true }).success).toBe(false);
    await job.run(
      {},
      { db, now: () => new Date(), job: { id: randomUUID(), attempt: 1 }, step: async () => "ran" },
    );
    expect(log.some(isDelete)).toBe(false);
    expect(tables).toEqual(before);
  });
});
