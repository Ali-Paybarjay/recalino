import { createDatabase } from "@recalino/core/db";
import { DEFAULT_PLT_SETTINGS } from "@recalino/core/plt";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { defineRoute } from "./api";
import { periodicJobs, runJobsHandler } from "./jobs";
import { ROUTES } from "./routes";
import { routeDeps } from "./test-support";

// The cron route end to end on the local database (FR-PLT-005, M4).

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

const SECRET = "cron-secret-for-tests-0123456789abcdef";

function cronRun(now: Date) {
  const route = defineRoute(
    ROUTES.jobsRun,
    runJobsHandler({
      now: () => now,
      settings: () => DEFAULT_PLT_SETTINGS,
      log: () => {},
      kinds: periodicJobs(DEFAULT_PLT_SETTINGS).map((job) => job.definition.kind),
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
    // A far-future hour that no earlier run used, so their periodic jobs can't interfere.
    const hour = new Date(Date.UTC(2099, 0, 1) + Math.floor(Date.now() / 1000) * 3_600_000);
    const kinds = periodicJobs(DEFAULT_PLT_SETTINGS).map((job) => job.definition.kind);

    const first = await cronRun(hour);
    expect(first.status).toBe(200);
    const summary = await first.json();
    // The runner also completes retries already queued by other tests; inspect this
    // period's rows below instead of assuming the shared queue was initially empty.
    expect(summary).toMatchObject({ failed: 0, retried: 0 });
    expect(summary.succeeded).toBeGreaterThanOrEqual(kinds.length);

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
