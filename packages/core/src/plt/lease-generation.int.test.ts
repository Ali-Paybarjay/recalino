import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { createDatabase, withTransaction } from "../db";
import {
  type ClaimedJob,
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  type JobDefinition,
  jobState,
  renewJobLease,
} from "./jobs";
import { DEFAULT_PLT_SETTINGS } from "./settings";

// Recalino ADR-0004, rule 3, step 1 (P11-09): the lease generation row and the two nullable
// plt.job columns exist, and the code deployed before them behaves exactly as before. Rejecting
// claims by generation or build is P11-08's check and its own test (claim-barrier.int.test.ts).

const app = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });

afterAll(async () => {
  await Promise.all([app.destroy(), admin.destroy()]);
});

const T0 = new Date("2026-11-12T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const DEFAULTS = { ...DEFAULT_PLT_SETTINGS.jobs, retryBaseSeconds: 30, retryMaxSeconds: 3600 };
const SESSION = "0b6f6a0e-7f1d-4c38-8d39-2a5d3f0c9e14";

function definition(): JobDefinition<{ sessionId: string }> {
  return {
    kind: `test.k_${randomBytes(4).toString("hex")}`,
    version: 1,
    payload: z.strictObject({ sessionId: z.uuid() }),
    run: async () => {},
  };
}

async function enqueue(def: JobDefinition<{ sessionId: string }>): Promise<string> {
  const id = await withTransaction(app, (tx) =>
    enqueueJob(tx, def, { payload: { sessionId: SESSION }, now: T0, defaults: DEFAULTS }),
  );
  if (id === null) throw new Error("job not enqueued");
  return id;
}

async function claimOne(def: { kind: string }, now: Date): Promise<ClaimedJob> {
  const claimed = await claimJobs(app, [def.kind], 1, now);
  expect(claimed).toHaveLength(1);
  const [job] = claimed;
  if (!job) throw new Error("job not claimed");
  return job;
}

async function leaseColumns(id: string) {
  return admin
    .selectFrom("plt.job")
    .select(["lease_generation", "lease_build"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

describe("lease generation row (ADR-0004 rules 2 and 3, P11-09)", () => {
  it("holds exactly one row, at generation 1", async () => {
    const rows = await admin
      .selectFrom("plt.job_lease_generation")
      .select(["singleton", "generation", "changed_at"])
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ singleton: true, generation: 1 });
    expect(rows[0]?.changed_at).toBeInstanceOf(Date);
  });

  it("rejects a second row", async () => {
    // Both statements run in a transaction that rolls back, so the row is never changed.
    await expect(
      withTransaction(admin, (tx) =>
        tx.insertInto("plt.job_lease_generation").values({ generation: 2 }).execute(),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      withTransaction(admin, (tx) =>
        tx
          .insertInto("plt.job_lease_generation")
          .values({ singleton: false, generation: 2 })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const count = await admin
      .selectFrom("plt.job_lease_generation")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it("has row level security on and no policy", async () => {
    const table = await sql<{ rls: boolean }>`
      select relrowsecurity as rls from pg_class
      where oid = 'plt.job_lease_generation'::regclass`.execute(admin);
    expect(table.rows).toEqual([{ rls: true }]);
    const policies = await sql<{ n: string }>`
      select count(*) as n from pg_policies
      where schemaname = 'plt' and tablename = 'job_lease_generation'`.execute(admin);
    expect(Number(policies.rows[0]?.n)).toBe(0);
  });

  it("grants nothing to browser roles and only reading to the app role", async () => {
    const grants = await sql<{ grantee: string; privilege: string }>`
      select grantee, privilege_type as privilege from information_schema.role_table_grants
      where table_schema = 'plt' and table_name = 'job_lease_generation'
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'recalino_app')
      order by grantee, privilege_type`.execute(admin);
    expect(grants.rows).toEqual([{ grantee: "recalino_app", privilege: "SELECT" }]);

    for (const role of ["anon", "authenticated"]) {
      await expect(
        withTransaction(admin, async (tx) => {
          await sql.raw(`set local role ${role}`).execute(tx);
          await sql`select generation from plt.job_lease_generation`.execute(tx);
        }),
      ).rejects.toThrow(/permission denied/);
    }

    const read = await app
      .selectFrom("plt.job_lease_generation")
      .select("generation")
      .executeTakeFirstOrThrow();
    expect(read.generation).toBe(1);
    await expect(
      withTransaction(app, (tx) =>
        tx.updateTable("plt.job_lease_generation").set({ generation: 2 }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("plt.job lease columns, additive only (P11-09)", () => {
  it("are nullable, without a default and without a column grant", async () => {
    const columns = await sql<{
      name: string;
      type: string;
      nullable: string;
      default: string | null;
    }>`
      select column_name as name, data_type as type, is_nullable as nullable,
        column_default as default
      from information_schema.columns
      where table_schema = 'plt' and table_name = 'job'
        and column_name in ('lease_generation', 'lease_build')
      order by column_name`.execute(admin);
    expect(columns.rows).toEqual([
      { name: "lease_build", type: "text", nullable: "YES", default: null },
      { name: "lease_generation", type: "integer", nullable: "YES", default: null },
    ]);
    const acl = await sql<{ n: string }>`
      select count(*) as n from pg_attribute
      where attrelid = 'plt.job'::regclass
        and attname in ('lease_generation', 'lease_build') and attacl is not null`.execute(admin);
    expect(Number(acl.rows[0]?.n)).toBe(0);
  });

  it("have no constraint, index or trigger on plt.job", async () => {
    const constraints = await sql<{ n: string }>`
      select count(*) as n from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'plt.job'::regclass
        and a.attname in ('lease_generation', 'lease_build')`.execute(admin);
    expect(Number(constraints.rows[0]?.n)).toBe(0);
    const indexes = await sql<{ n: string }>`
      select count(*) as n from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'plt.job'::regclass
        and a.attname in ('lease_generation', 'lease_build')`.execute(admin);
    expect(Number(indexes.rows[0]?.n)).toBe(0);
    const triggers = await sql<{ n: string }>`
      select count(*) as n from pg_trigger
      where tgrelid = 'plt.job'::regclass and not tgisinternal`.execute(admin);
    expect(Number(triggers.rows[0]?.n)).toBe(0);
  });
});

describe("the code deployed before the migration is unchanged (ADR-0004 rule 3 step 1)", () => {
  it("claims with both new columns NULL, then renews and completes", async () => {
    const def = definition();
    const id = await enqueue(def);
    expect(await leaseColumns(id)).toEqual({ lease_generation: null, lease_build: null });

    const job = await claimOne(def, T0);
    expect(job).toMatchObject({ id, attempt: 1 });
    expect(await jobState(app, id)).toBe("running");
    expect(await leaseColumns(id)).toEqual({ lease_generation: null, lease_build: null });

    expect(await renewJobLease(app, job, at(10))).toBe(true);
    expect(await completeJob(app, job, at(20))).toBe(true);
    expect(await jobState(app, id)).toBe("succeeded");
    expect(await leaseColumns(id)).toEqual({ lease_generation: null, lease_build: null });
  });

  it("claims a job whose columns hold values left by an earlier claim, and fails it", async () => {
    const def = definition();
    const id = await enqueue(def);
    const first = await claimOne(def, T0);
    expect(await failJob(app, first, "test_retry", at(1))).toBe("retry_scheduled");

    // Values an earlier claim by a later build would have left; the current code ignores them.
    await admin
      .updateTable("plt.job")
      .set({ lease_generation: 1, lease_build: "build-from-an-earlier-claim" })
      .where("id", "=", id)
      .execute();

    const second = await claimOne(def, at(3600));
    expect(second).toMatchObject({ id, attempt: 2 });
    expect(second.token).not.toBe(first.token);
    expect(await jobState(app, id)).toBe("running");
    expect(await completeJob(app, first, at(3601))).toBe(false); // the earlier claim is void
    expect(await failJob(app, second, "test_terminal", at(3602), true)).toBe("failed");
    expect(await jobState(app, id)).toBe("failed");
  });

  it("claims whatever the allowed builds hold", async () => {
    const before = await admin
      .selectFrom("plt.job_lease_generation")
      .select(["allowed_builds", "changed_at"])
      .executeTakeFirstOrThrow();
    try {
      for (const allowed of [[], ["a-build-that-is-not-running"]]) {
        await admin
          .updateTable("plt.job_lease_generation")
          .set({ allowed_builds: allowed })
          .execute();
        const def = definition();
        const id = await enqueue(def);
        const job = await claimOne(def, T0);
        expect(job).toMatchObject({ id, attempt: 1 });
        expect(await leaseColumns(id)).toEqual({ lease_generation: null, lease_build: null });
        expect(await completeJob(app, job, at(1))).toBe(true);
        expect(await jobState(app, id)).toBe("succeeded");
      }
    } finally {
      await admin
        .updateTable("plt.job_lease_generation")
        .set({ allowed_builds: before.allowed_builds, changed_at: before.changed_at })
        .execute();
    }
  });
});
