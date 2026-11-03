// OPS-02 (audit 2026-10-18): the hourly health check reads real queue signals as the application
// role and raises one audit event per episode, never again while the condition lasts.
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import type { Logger } from "../plt";
import { readPlatformHealth } from "../plt";
import {
  DEFAULT_HEALTH_SETTINGS,
  type HealthReading,
  readHealth,
  readSystemHealth,
  runHealthCheck,
} from "./health";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

const KIND = "test.health_probe";

async function insertJob(state: "failed" | "queued", at: Date) {
  const row = await db
    .insertInto("plt.job")
    .values({
      kind: KIND,
      payload: JSON.stringify({ probe: randomUUID() }),
      payload_version: 1,
      state,
      attempt: state === "failed" ? 5 : 0,
      max_attempts: 5,
      lease_seconds: 120,
      retry_base_seconds: 30,
      retry_max_seconds: 3600,
      run_at: at,
      created_at: at,
      updated_at: at,
      finished_at: state === "failed" ? at : null,
      last_error: state === "failed" ? "handler_error" : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

it("counts jobs that failed for good and the longest wait of a due job", async () => {
  const now = new Date();
  const before = await readPlatformHealth(db, now);
  const ids = [
    await insertJob("failed", new Date(now.getTime() - 60_000)),
    await insertJob("queued", new Date(now.getTime() - 20 * 60_000)),
  ];
  try {
    const health = await readPlatformHealth(db, now);
    expect(health.failedJobsLastHour).toBe(before.failedJobsLastHour + 1);
    expect(health.oldestQueuedAt?.getTime()).toBeLessThanOrEqual(now.getTime() - 20 * 60_000);
    expect(health.databaseBytes).toBeGreaterThan(0);
    const overview = await readSystemHealth(db, now, { settings: DEFAULT_HEALTH_SETTINGS });
    expect(overview.alerts).toEqual(expect.arrayContaining(["failed_jobs", "queue_delay"]));
    expect(JSON.stringify(overview)).not.toContain(KIND);
  } finally {
    await db.deleteFrom("plt.job").where("id", "in", ids).execute();
  }
});

// P1-09 (RR-10): a failed run ends its job successfully, so only failed_runs sees it.
it("counts processing runs that failed in the last hour and opens failed_runs", async () => {
  const x = await studyFixture(db);
  const now = new Date();
  const insertRun = async (state: "failed" | "ready", finishedAt: Date) =>
    (
      await db
        .insertInto("proc.processing_run")
        .values({
          user_id: x.ctx.userId,
          session_id: x.session.id,
          operation_key: randomUUID(),
          request_hash: "synthetic-health",
          sources_version: 0,
          source_fingerprint: "a".repeat(64),
          input_snapshot: "{}",
          settings: "{}",
          requested_amounts: "{}",
          reservation_id: randomUUID(),
          kind: "class",
          state,
          last_error: state === "failed" ? "processing_failed" : null,
          finished_at: finishedAt,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  const before = await readHealth(db, now);
  const ids = [
    await insertRun("failed", new Date(now.getTime() - 60_000)),
    await insertRun("failed", new Date(now.getTime() - 2 * 3_600_000)),
    await insertRun("ready", new Date(now.getTime() - 60_000)),
  ];
  try {
    const health = await readHealth(db, now);
    expect(health.failedRunsLastHour).toBe(before.failedRunsLastHour + 1);
    expect(health.failedJobsLastHour).toBe(before.failedJobsLastHour);
    const overview = await readSystemHealth(db, now, { settings: DEFAULT_HEALTH_SETTINGS });
    expect(overview.alerts).toContain("failed_runs");
    expect(overview).not.toHaveProperty("failedRunsLastHour");
    for (const id of ids) expect(JSON.stringify(overview)).not.toContain(id);
  } finally {
    // The application role may not delete runs (select, insert and update only), so the synthetic
    // runs leave every health window instead: later checks in this shared database see none of them.
    await db
      .updateTable("proc.processing_run")
      .set({ finished_at: new Date(now.getTime() - 30 * 24 * 3_600_000) })
      .where("id", "in", ids)
      .execute();
  }
});

it("raises one alert per episode and records the recovery", async () => {
  const now = new Date();
  const healthy: HealthReading = {
    databaseBytes: 1,
    failedJobsLastHour: 0,
    failedRunsLastHour: 0,
    oldestQueuedAt: null,
    lastRunnerAt: now,
  };
  let signals = healthy;
  const lines: string[] = [];
  const log: Logger = (level, event, fields) => lines.push(`${level}:${event}:${fields?.kind}`);
  const check = () =>
    runHealthCheck(db, now, {
      settings: DEFAULT_HEALTH_SETTINGS,
      log,
      read: async () => signals,
    });
  // Close any alert an earlier run of this file left open.
  await check();
  lines.length = 0;
  const since = new Date();

  signals = { ...healthy, failedJobsLastHour: 3 };
  expect(await check()).toEqual({ raised: ["failed_jobs"], cleared: [] });
  expect(await check()).toEqual({ raised: [], cleared: [] });
  signals = healthy;
  expect(await check()).toEqual({ raised: [], cleared: ["failed_jobs"] });

  const audit = await db
    .selectFrom("plt.audit_event")
    .select(["action", "subject_id"])
    .where("actor_id", "=", "ops.health_check")
    .where("occurred_at", ">=", since)
    .orderBy("id")
    .execute();
  expect(audit).toEqual([
    { action: "ops.health_alert", subject_id: "failed_jobs" },
    { action: "ops.health_recovered", subject_id: "failed_jobs" },
  ]);
  expect(lines).toEqual(["error:health_alert:failed_jobs", "info:health_recovered:failed_jobs"]);
});
