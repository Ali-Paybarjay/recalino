import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createDatabase } from "@recalino/core/db";
import { createSchemaGuard, DEFAULT_PLT_SETTINGS, type SchemaGuard } from "@recalino/core/plt";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOCAL_ADMIN_DATABASE_URL,
  LOCAL_APP_DATABASE_URL,
} from "../../../../packages/core/test/local-db";
import { defineRoute } from "./api";
import { periodicJobs, runJobsHandler } from "./jobs";
import { ROUTES } from "./routes";
import { routeDeps } from "./test-support";

// The real cron route and every registered periodic definition (FR-PLT-005, M4).
// Global recovery sweeps must not publish, expire or drain another test's fixtures.
const databaseName = `recalino_cron_${randomUUID().replaceAll("-", "")}`;
const databaseNamePattern = /^recalino_cron_[a-f0-9]{32}$/;

function localDatabaseUrl(value: string, isolated = false): string {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !databaseNamePattern.test(databaseName)
  )
    throw new Error("Invalid isolated cron test database configuration");
  if (isolated) url.pathname = `/${databaseName}`;
  return url.toString();
}

const provision = createDatabase(localDatabaseUrl(LOCAL_ADMIN_DATABASE_URL), {
  maxConnections: 1,
});
const migrations = createDatabase(localDatabaseUrl(LOCAL_ADMIN_DATABASE_URL, true), {
  maxConnections: 1,
});
const db = createDatabase(localDatabaseUrl(LOCAL_APP_DATABASE_URL, true), {
  maxConnections: 2,
});
let created = false;
let disposed = false;

async function dropCreatedDatabase() {
  if (!created) return;
  if (!databaseNamePattern.test(databaseName)) throw new Error("Invalid cron database name");
  await sql`drop database ${sql.id(databaseName)}`.execute(provision);
  created = false;
}

async function disposeDatabase() {
  if (disposed) return;
  disposed = true;
  try {
    try {
      await db.destroy();
    } finally {
      await migrations.destroy();
    }
  } finally {
    try {
      await dropCreatedDatabase();
    } finally {
      await provision.destroy();
    }
  }
}

beforeAll(async () => {
  try {
    await sql`create database ${sql.id(databaseName)} template template0`.execute(provision);
    created = true;
    // App migrations reference only Auth UUIDs. This cron fixture has no accounts or Auth calls.
    await sql`create schema auth`.execute(migrations);
    await sql`create table auth.users (id uuid primary key)`.execute(migrations);
    const directory = new URL("../../../../supabase/migrations/", import.meta.url);
    for (const filename of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await sql.raw(await readFile(new URL(filename, directory), "utf8")).execute(migrations);
  } catch (error) {
    await disposeDatabase();
    throw error;
  }
}, 120_000);
afterAll(disposeDatabase);

const SECRET = "cron-secret-for-tests-0123456789abcdef";

function cronRun(now: Date, overrides: { schema?: SchemaGuard } = {}) {
  const route = defineRoute(
    ROUTES.jobsRun,
    runJobsHandler({
      now: () => now,
      settings: () => DEFAULT_PLT_SETTINGS,
      log: () => {},
      kinds: periodicJobs(DEFAULT_PLT_SETTINGS).map((job) => job.definition.kind),
      ...(overrides.schema ? { schema: overrides.schema } : {}),
    }),
    { ...routeDeps(db), cronSecret: () => SECRET },
  );
  return route(
    new Request("http://localhost/api/jobs/run", {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

describe("GET /api/jobs/run", () => {
  it("adds each periodic job once per period and runs it", async () => {
    // The isolated database makes a fixed, valid period independent of wall-clock time.
    const hour = new Date("2099-01-01T00:00:00Z");
    const kinds = periodicJobs(DEFAULT_PLT_SETTINGS).map((job) => job.definition.kind);

    const first = await cronRun(hour);
    expect(first.status).toBe(200);
    const summary = await first.json();
    expect(summary).toMatchObject({ failed: 0, retried: 0, succeeded: kinds.length });

    // Repeat inside the same period, including the one-minute automatic-learning sweep.
    const again = await cronRun(new Date(hour.getTime() + 1_000));
    expect(await again.json()).toMatchObject({ succeeded: 0 });

    const rows = await db
      .selectFrom("plt.job")
      .select(["kind", "state"])
      .where("kind", "in", kinds)
      .where("created_at", "=", hour)
      .execute();
    expect(rows.map((row) => row.kind).sort()).toEqual([...kinds].sort());
    expect(new Set(rows.map((row) => row.state))).toEqual(new Set(["succeeded"]));

    const nextMinute = new Date(hour.getTime() + 60_000);
    const next = await cronRun(nextMinute);
    expect(await next.json()).toMatchObject({
      failed: 0,
      retried: 0,
      succeeded: periodicJobs(DEFAULT_PLT_SETTINGS).filter((job) => job.everySeconds === 60).length,
    });
    const nextRows = await db
      .selectFrom("plt.job")
      .select(["kind", "state"])
      .where("kind", "in", kinds)
      .where("created_at", "=", nextMinute)
      .execute();
    expect(nextRows.map((row) => row.kind).sort()).toEqual(
      periodicJobs(DEFAULT_PLT_SETTINGS)
        .filter((job) => job.everySeconds === 60)
        .map((job) => job.definition.kind)
        .sort(),
    );
    expect(new Set(nextRows.map((row) => row.state))).toEqual(new Set(["succeeded"]));
  });
});

describe("OPS-05 runner and the applied schema version", () => {
  const EXPECTED = "20991231000000";
  function guard(applied: string, lines: string[]) {
    return createSchemaGuard({
      expected: EXPECTED,
      read: async () => applied,
      log: (level, event, fields) => lines.push(`${level}:${event}:${fields?.schema_applied}`),
    });
  }

  it("claims no job and logs schema_behind while the database is behind", async () => {
    const at = new Date("2099-02-01T00:00:00Z");
    const lines: string[] = [];
    const behind = guard("20991230000000", lines);
    const first = await cronRun(at, { schema: behind });
    expect(await first.json()).toMatchObject({ succeeded: 0, schemaBehind: true });
    await cronRun(new Date(at.getTime() + 1000), { schema: behind });
    const rows = await db.selectFrom("plt.job").select("id").where("created_at", "=", at).execute();
    expect(rows).toEqual([]);
    expect(lines.filter((line) => line.startsWith("warn:schema_behind:"))).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith("error:schema_behind_alert:"))).toHaveLength(1);
    const audit = await db
      .selectFrom("plt.audit_event")
      .select("subject_id")
      .where("action", "=", "ops.schema_behind")
      .execute();
    expect(audit).toEqual([{ subject_id: EXPECTED }]);
  });

  it.each(["20991231000000", "21000101000000"])("works normally with %s applied", async (v) => {
    const at = new Date(v === EXPECTED ? "2099-03-01T00:00:00Z" : "2099-04-01T00:00:00Z");
    const lines: string[] = [];
    const response = await cronRun(at, { schema: guard(v, lines) });
    expect(await response.json()).toMatchObject({ failed: 0, retried: 0 });
    expect(
      (await db.selectFrom("plt.job").select("id").where("created_at", "=", at).execute()).length,
    ).toBeGreaterThan(0);
    expect(lines).toEqual([]);
  });
});
