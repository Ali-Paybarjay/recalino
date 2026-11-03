// P1-09 (RR-10, DEBT-F-8): a processing job that fails its run still ends as a successful job
// (worker.ts records the failure on the run and returns), so the health check's failed_jobs signal
// never counts it. This read-only count lets the health check see failed runs directly.
import { sql } from "kysely";
import type { Database } from "../db";

/** The window of a failed-run count: runs that finished from `since` up to and including `until`. */
export interface RunHealthWindow {
  since: Date;
  until: Date;
}

/**
 * How many processing runs ended in `failed` within the window. Read-only; a count only, never a
 * run's id, owner or error. A run that needs input (an uncertain provider outcome or an expired
 * upload) is not a failure and is not counted.
 */
export async function countFailedRuns(db: Database, window: RunHealthWindow): Promise<number> {
  const { since, until } = window;
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since > until)
    throw new Error("Invalid failed-run window");
  const row = await db
    .selectFrom("proc.processing_run")
    .select(sql<string>`count(*)`.as("count"))
    .where("state", "=", "failed")
    .where("finished_at", ">=", since)
    .where("finished_at", "<=", until)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
