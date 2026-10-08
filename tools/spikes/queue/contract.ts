// SPIKE-05, queue part: the contract both candidates implement, so one test suite measures both
// (docs/plans/M4_QUEUE_STORAGE.md, T1). Spike code only; removed after the choice (T6).
import { type Kysely, Kysely as KyselyClass, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";

// The spike talks to its own throwaway schemas with plain SQL, so the database type is empty.
export type Db = Kysely<Record<string, never>>;
export type Tx = Transaction<Record<string, never>>;

/** FR-PLT-005 states. */
export type JobState =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobOptions {
  maxAttempts: number;
  /** How long a claim lasts before another runner may take the job again (crash recovery). */
  leaseSeconds: number;
  retryDelaySeconds: number;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
  /** Identifies this claim, so a runner whose lease ran out can't settle the job. */
  token: string;
}

export interface QueueClient {
  readonly db: Db;
  /** Inside the caller's transaction: if it rolls back, the job does not exist. */
  enqueue(
    tx: Tx,
    kind: string,
    payload: Record<string, unknown>,
    options: JobOptions,
  ): Promise<string>;
  claim(kind: string, limit: number): Promise<ClaimedJob[]>;
  /** False when the claim was lost, e.g. its lease ran out and another runner took the job. */
  complete(job: ClaimedJob): Promise<boolean>;
  fail(job: ClaimedJob, reason: string): Promise<void>;
  cancel(kind: string, id: string): Promise<void>;
  state(kind: string, id: string): Promise<JobState | null>;
  /** Returns jobs whose lease ran out to the queue, or fails them after the last attempt. */
  sweep(kind: string): Promise<void>;
  close(): Promise<void>;
}

export interface Candidate {
  name: string;
  install(admin: pg.Pool): Promise<void>;
  uninstall(admin: pg.Pool): Promise<void>;
  open(connectionString: string): Promise<QueueClient>;
}

export function openDb(connectionString: string, max = 3): Db {
  return new KyselyClass<Record<string, never>>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}

/** Local stack (`pnpm db:start`); the spike's cloud run passes its own URLs. */
export const LOCAL = {
  admin: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  direct: "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres",
  pooler: "postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:54329/postgres",
};
