// OPS-02 (audit 2026-10-18): the platform signals the hourly health check and the admin overview
// read. Counts and times only, from tables and functions the application role can already read:
// plt.job (FR-PLT-005) and pg_database_size, which every role with CONNECT may call.
import { sql } from "kysely";
import type { Database } from "../db";

export interface PlatformHealth {
  /** Size of the whole database in bytes; the Supabase Free plan turns read-only at its limit. */
  databaseBytes: number;
  /** Jobs that failed for good (no retry left) in the hour before `now`. */
  failedJobsLastHour: number;
  /** When the longest-waiting due job became due; null when nothing is waiting. */
  oldestQueuedAt: Date | null;
  /**
   * The last time a cron runner added its periodic jobs: every run adds the due ones, and the
   * shortest periods are one minute (FR-PLT-005). Null when no periodic job is recorded.
   */
  lastRunnerAt: Date | null;
}

export async function readPlatformHealth(db: Database, now: Date): Promise<PlatformHealth> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const { rows } = await sql<{
    database_bytes: string;
    failed_last_hour: string;
    oldest_queued_at: Date | null;
    last_runner_at: Date | null;
  }>`
    select pg_database_size(current_database()) as database_bytes,
      count(*) filter (where state = 'failed' and finished_at >= ${hourAgo}) as failed_last_hour,
      min(run_at) filter (where state in ('queued', 'retry_scheduled') and run_at <= ${now})
        as oldest_queued_at,
      max(created_at) filter (where singleton_key like 'every-%') as last_runner_at
    from plt.job`.execute(db);
  const row = rows[0];
  return {
    databaseBytes: Number(row?.database_bytes ?? 0),
    failedJobsLastHour: Number(row?.failed_last_hour ?? 0),
    oldestQueuedAt: row?.oldest_queued_at ?? null,
    lastRunnerAt: row?.last_runner_at ?? null,
  };
}

/** OPS-02: one round trip for the readiness check; throws when the database cannot be reached. */
export async function pingDatabase(db: Database): Promise<void> {
  await sql`select 1`.execute(db);
}
