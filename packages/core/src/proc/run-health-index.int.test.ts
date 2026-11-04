import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";

// P2-02: countFailedRuns (run-health.ts) filters proc.processing_run on state = 'failed' and a
// finished_at range; migration 20261104130000 adds the partial index that supports it.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

it("has the partial finished_at index for failed processing runs", async () => {
  const { rows } = await sql<{ indexdef: string }>`
    select indexdef from pg_indexes
    where schemaname = 'proc' and tablename = 'processing_run'
      and indexname = 'processing_run_failed_finished_at_idx'`.execute(db);
  expect(rows).toHaveLength(1);
  const definition = rows[0]?.indexdef.replace(/\s+/g, " ") ?? "";
  expect(definition).toMatch(/ ON proc\.processing_run USING btree \(finished_at\)/);
  expect(definition).toMatch(/ WHERE \(state = 'failed'::text\)$/);
});
