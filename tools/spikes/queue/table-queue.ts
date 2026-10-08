// Candidate 2: a plain job table claimed with FOR UPDATE SKIP LOCKED (ADR-0001, "صف").
import { sql } from "kysely";
import type pg from "pg";
import {
  type Candidate,
  type ClaimedJob,
  type Db,
  type JobState,
  openDb,
  type QueueClient,
} from "./contract";

const SCHEMA = "spike_queue_table";
const T = sql.raw(`${SCHEMA}.job`);

type Row = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
  lease_token: string;
};

class TableQueue implements QueueClient {
  constructor(readonly db: Db) {}

  async enqueue(
    tx: Parameters<QueueClient["enqueue"]>[0],
    kind: string,
    payload: Record<string, unknown>,
    options: Parameters<QueueClient["enqueue"]>[3],
  ): Promise<string> {
    const result = await sql<{ id: string }>`
      insert into ${T} (kind, payload, max_attempts, lease_seconds, retry_delay_seconds)
      values (${kind}, ${JSON.stringify(payload)}::jsonb, ${options.maxAttempts},
              ${options.leaseSeconds}, ${options.retryDelaySeconds})
      returning id`.execute(tx);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("enqueue returned no id");
    return id;
  }

  async claim(kind: string, limit: number): Promise<ClaimedJob[]> {
    const result = await sql<Row>`
      with picked as (
        select id from ${T}
        where kind = ${kind} and state in ('queued', 'retry_scheduled') and run_at <= now()
        order by run_at
        for update skip locked
        limit ${limit}
      )
      update ${T} j
      set state = 'running', attempt = j.attempt + 1, lease_token = gen_random_uuid(),
          lease_until = now() + make_interval(secs => j.lease_seconds), updated_at = now()
      from picked where j.id = picked.id
      returning j.id, j.kind, j.payload, j.attempt, j.lease_token`.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      attempt: row.attempt,
      token: row.lease_token,
    }));
  }

  async complete(job: ClaimedJob): Promise<boolean> {
    const result = await sql`
      update ${T} set state = 'succeeded', lease_token = null, lease_until = null, updated_at = now()
      where id = ${job.id} and lease_token = ${job.token} and state = 'running'`.execute(this.db);
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async fail(job: ClaimedJob, reason: string): Promise<void> {
    await sql`
      update ${T}
      set state = case when attempt >= max_attempts then 'failed' else 'retry_scheduled' end,
          run_at = now() + make_interval(secs => retry_delay_seconds * power(2, attempt - 1)),
          last_error = ${reason}, lease_token = null, lease_until = null, updated_at = now()
      where id = ${job.id} and lease_token = ${job.token} and state = 'running'`.execute(this.db);
  }

  async cancel(_kind: string, id: string): Promise<void> {
    await sql`
      update ${T} set state = 'cancelled', lease_token = null, updated_at = now()
      where id = ${id} and state in ('queued', 'retry_scheduled', 'running')`.execute(this.db);
  }

  async state(_kind: string, id: string): Promise<JobState | null> {
    const result = await sql<{ state: JobState }>`select state from ${T} where id = ${id}`.execute(
      this.db,
    );
    return result.rows[0]?.state ?? null;
  }

  async sweep(kind: string): Promise<void> {
    await sql`
      update ${T}
      set state = case when attempt >= max_attempts then 'failed' else 'retry_scheduled' end,
          run_at = now(), last_error = 'lease expired', lease_token = null, lease_until = null,
          updated_at = now()
      where kind = ${kind} and state = 'running' and lease_until < now()`.execute(this.db);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }
}

export const tableCandidate: Candidate = {
  name: "table + SKIP LOCKED",
  async install(admin: pg.Pool) {
    await admin.query(`
      create schema if not exists ${SCHEMA};
      create table if not exists ${SCHEMA}.job (
        id uuid primary key default gen_random_uuid(),
        kind text not null,
        payload jsonb not null,
        state text not null default 'queued' check (state in
          ('queued', 'running', 'retry_scheduled', 'succeeded', 'failed', 'cancelled')),
        attempt integer not null default 0,
        max_attempts integer not null check (max_attempts >= 1),
        lease_seconds integer not null check (lease_seconds >= 1),
        retry_delay_seconds integer not null default 0,
        run_at timestamptz not null default now(),
        lease_token uuid,
        lease_until timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists job_ready_idx on ${SCHEMA}.job (kind, run_at)
        where state in ('queued', 'retry_scheduled');
      create index if not exists job_lease_idx on ${SCHEMA}.job (lease_until) where state = 'running';
      grant usage on schema ${SCHEMA} to recalino_app;
      grant select, insert, update on ${SCHEMA}.job to recalino_app;
    `);
  },
  async uninstall(admin: pg.Pool) {
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  },
  async open(connectionString: string) {
    return new TableQueue(openDb(connectionString));
  },
};
