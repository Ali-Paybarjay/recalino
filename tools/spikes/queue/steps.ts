// FR-PLT-005 rule 6: a handler's effect is recorded with a step key in the same transaction, so a
// job that runs again after a crash does not repeat a finished step. Shared by both candidates.
import { sql } from "kysely";
import type pg from "pg";
import type { Db } from "./contract";

export const STEP_SCHEMA = "spike_queue";

export async function installSteps(admin: pg.Pool): Promise<void> {
  await admin.query(`
    create schema if not exists ${STEP_SCHEMA};
    create table if not exists ${STEP_SCHEMA}.job_step (
      job_id text not null,
      step text not null,
      done_at timestamptz not null default now(),
      primary key (job_id, step)
    );
    create table if not exists ${STEP_SCHEMA}.effect (
      id bigint generated always as identity primary key,
      job_id text not null,
      step text not null
    );
    grant usage on schema ${STEP_SCHEMA} to recalino_app;
    grant select, insert on all tables in schema ${STEP_SCHEMA} to recalino_app;
  `);
}

export async function uninstallSteps(admin: pg.Pool): Promise<void> {
  await admin.query(`drop schema if exists ${STEP_SCHEMA} cascade`);
}

/** Runs one step at most once per job: "ran", or "skipped" when an earlier attempt finished it. */
export async function runStep(db: Db, jobId: string, step: string): Promise<"ran" | "skipped"> {
  return db.transaction().execute(async (tx) => {
    const marked = await sql<{ job_id: string }>`
      insert into ${sql.raw(STEP_SCHEMA)}.job_step (job_id, step) values (${jobId}, ${step})
      on conflict do nothing returning job_id`.execute(tx);
    if (marked.rows.length === 0) return "skipped";
    await sql`insert into ${sql.raw(STEP_SCHEMA)}.effect (job_id, step) values (${jobId}, ${step})`.execute(
      tx,
    );
    return "ran";
  });
}

export async function effectCount(db: Db, jobId: string, step: string): Promise<number> {
  const result = await sql<{ n: string }>`
    select count(*) as n from ${sql.raw(STEP_SCHEMA)}.effect where job_id = ${jobId} and step = ${step}`.execute(
    db,
  );
  return Number(result.rows[0]?.n ?? 0);
}
