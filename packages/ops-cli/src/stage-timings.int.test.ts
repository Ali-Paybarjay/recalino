import { createDatabase } from "@recalino/core/db";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../core/test/local-db";
import { readRunTimes, stageDurations } from "./stage-timings";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

it("NFR-07 reads stage timestamps of class runs in one read-only transaction", async () => {
  const runs = await readRunTimes(db, new Date(0), new Date(Date.now() + 86_400_000));
  for (const run of runs) {
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.createdAt).toBeInstanceOf(Date);
    for (const value of Object.values(stageDurations(run)))
      if (value !== null) expect(value).toBeGreaterThanOrEqual(0);
  }
});
