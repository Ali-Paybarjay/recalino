// Candidate 1: pg-boss 12 with its own pool, no supervisor, scheduler or migrations inside the
// process (ADR-0001: "supervise، schedule و migrate خاموش داخل Functionها"). Its schema comes from
// getConstructionPlans(), the SQL a migration would hold.

import type pg from "pg";
import { fromKysely, getConstructionPlans, PgBoss } from "pg-boss";
import {
  type Candidate,
  type ClaimedJob,
  type Db,
  type JobOptions,
  type JobState,
  openDb,
  type QueueClient,
  type Tx,
} from "./contract";

const SCHEMA = "spike_pgboss";

const STATES: Record<string, JobState> = {
  created: "queued",
  retry: "retry_scheduled",
  active: "running",
  completed: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

class PgBossQueue implements QueueClient {
  private readonly queues = new Set<string>();

  constructor(
    private readonly boss: PgBoss,
    readonly db: Db,
  ) {}

  private async ensureQueue(kind: string, options: JobOptions) {
    if (this.queues.has(kind)) return;
    await this.boss.createQueue(kind, {
      retryLimit: options.maxAttempts - 1,
      retryDelay: options.retryDelaySeconds,
      expireInSeconds: options.leaseSeconds,
    });
    this.queues.add(kind);
  }

  async enqueue(
    tx: Tx,
    kind: string,
    payload: Record<string, unknown>,
    options: JobOptions,
  ): Promise<string> {
    await this.ensureQueue(kind, options);
    const id = await this.boss.send(kind, payload, {
      db: fromKysely(tx),
      retryLimit: options.maxAttempts - 1,
      retryDelay: options.retryDelaySeconds,
      expireInSeconds: options.leaseSeconds,
    });
    if (!id) throw new Error("send returned no id");
    return id;
  }

  async claim(kind: string, limit: number): Promise<ClaimedJob[]> {
    const jobs = await this.boss.fetch<Record<string, unknown>>(kind, {
      batchSize: limit,
      includeMetadata: true,
    });
    return jobs.map((job) => ({
      id: job.id,
      kind,
      payload: job.data,
      attempt: job.retryCount + 1,
      token: String(job.retryCount),
    }));
  }

  async complete(job: ClaimedJob): Promise<boolean> {
    const result = await this.boss.complete(job.kind, {
      id: job.id,
      retryCount: Number(job.token),
    });
    // The runtime returns { affected }, but pg-boss 12.35's CommandResponse type is empty.
    return (result as { affected?: number }).affected === 1;
  }

  async fail(job: ClaimedJob, reason: string): Promise<void> {
    await this.boss.fail(job.kind, { id: job.id, retryCount: Number(job.token) }, { reason });
  }

  async cancel(kind: string, id: string): Promise<void> {
    await this.boss.cancel(kind, id);
  }

  async state(kind: string, id: string): Promise<JobState | null> {
    const [job] = await this.boss.findJobs(kind, { id });
    return job ? (STATES[job.state] ?? null) : null;
  }

  async sweep(kind: string): Promise<void> {
    await this.boss.supervise(kind);
  }

  async close(): Promise<void> {
    await this.boss.stop({ graceful: false });
    await this.db.destroy();
  }
}

export const pgBossCandidate: Candidate = {
  name: "pg-boss",
  async install(admin: pg.Pool) {
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.query(getConstructionPlans(SCHEMA));
    await admin.query(`
      grant usage on schema ${SCHEMA} to recalino_app;
      grant select, insert, update, delete on all tables in schema ${SCHEMA} to recalino_app;
      grant usage on all sequences in schema ${SCHEMA} to recalino_app;
      grant execute on all functions in schema ${SCHEMA} to recalino_app;
    `);
  },
  async uninstall(admin: pg.Pool) {
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  },
  async open(connectionString: string) {
    const boss = new PgBoss({
      connectionString,
      schema: SCHEMA,
      max: 3,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    boss.on("error", (error) => console.error("pg-boss:", error.message));
    await boss.start();
    return new PgBossQueue(boss, openDb(connectionString));
  },
};
