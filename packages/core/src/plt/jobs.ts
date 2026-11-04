// FR-PLT-005: the durable job queue (ADR-0003). A plain table in `plt`, claimed with
// FOR UPDATE SKIP LOCKED. Times come from the caller, so every rule is testable without waiting.
import { sql } from "kysely";
import type { z } from "zod";
import type { Database, Tx } from "../db";
import { AppError } from "./errors";
import { causeCode, errorLocation, type Logger } from "./log";
import { recordSecurityEvent } from "./security";
import type { PltSettings } from "./settings";

export type JobState =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobOptions = Pick<
  PltSettings["jobs"],
  "maxAttempts" | "leaseSeconds" | "retryBaseSeconds" | "retryMaxSeconds"
>;

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: unknown;
  payloadVersion: number;
  attempt: number;
  /** This claim only: once the lease runs out and another runner claims the job, it is void. */
  token: string;
  /** A live runner renews the lease before it ends (rule 5). */
  leaseSeconds: number;
}

/** Internal orchestration target, derived from an already-authorized resource. */
export interface JobTarget {
  readonly userId: string;
  readonly subjectId: string;
}

export interface JobContext {
  db: Database;
  now: () => Date;
  /** For records and logs; the payload carries the job's subject. */
  job: { id: string; attempt: number };
  /**
   * When the runner's function stops. A long handler starts no new external call it cannot
   * finish before this, and checkpoints instead. Absent when the runner does not know its limit.
   */
  deadline?: Date;
  /** The runner's allow-listed logger, when it has one (FR-PLT-007); identifiers only. */
  log?: Logger;
  /**
   * Runs `effect` at most once for this job, in one transaction with the step's record
   * (FR-PLT-005 rule 6). Throws `JobCancelled` when the job was cancelled meanwhile (rule 7).
   */
  step(name: string, effect: (tx: Tx) => Promise<void>): Promise<"ran" | "skipped">;
}

/**
 * A job kind, defined by the module that owns it. Kinds read "<module>.<action>". The payload
 * holds identifiers and a version only, never class content (PRD-PRIV-06).
 */
export interface JobDefinition<P> {
  kind: string;
  version: number;
  payload: z.ZodType<P>;
  options?: Partial<JobOptions>;
  run(payload: P, ctx: JobContext): Promise<void>;
}

/** Thrown at a step boundary when the job was cancelled; the runner stops without settling. */
export class JobCancelled extends Error {
  constructor() {
    super("job cancelled");
    this.name = "JobCancelled";
  }
}

const KIND = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const REASON = /^[a-z0-9_.]{1,64}$/;

export interface EnqueueRequest<P> {
  payload: P;
  now: Date;
  defaults: PltSettings["jobs"];
  runAt?: Date;
  /** At most one job per (kind, key), ever: repeats return null. */
  singletonKey?: string;
}

/**
 * Adds a job inside the caller's transaction: if that transaction rolls back, there is no job
 * (rule 1). Returns the job id, or null when a job with the same singleton key exists.
 */
export async function enqueueJob<P>(
  tx: Tx,
  definition: Pick<JobDefinition<P>, "kind" | "version" | "payload" | "options">,
  request: EnqueueRequest<P>,
): Promise<string | null> {
  if (!KIND.test(definition.kind)) throw new Error(`Invalid job kind: ${definition.kind}`);
  const payload = definition.payload.parse(request.payload);
  const options = { ...request.defaults, ...definition.options };
  const row = await tx
    .insertInto("plt.job")
    .values({
      kind: definition.kind,
      payload: JSON.stringify(payload),
      payload_version: definition.version,
      max_attempts: options.maxAttempts,
      lease_seconds: options.leaseSeconds,
      retry_base_seconds: options.retryBaseSeconds,
      retry_max_seconds: Math.max(options.retryMaxSeconds, options.retryBaseSeconds),
      run_at: request.runAt ?? request.now,
      singleton_key: request.singletonKey ?? null,
      created_at: request.now,
      updated_at: request.now,
    })
    .onConflict((oc) =>
      oc.columns(["kind", "singleton_key"]).where("singleton_key", "is not", null).doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

/** Claims due jobs of the given kinds; concurrent claims never get the same job (rule 3). */
export async function claimJobs(
  db: Database,
  kinds: readonly string[],
  limit: number,
  now: Date,
  target?: JobTarget,
): Promise<ClaimedJob[]> {
  if (kinds.length === 0) return [];
  if (
    target !== undefined &&
    (!target ||
      typeof target.userId !== "string" ||
      !target.userId ||
      typeof target.subjectId !== "string" ||
      !target.subjectId)
  )
    throw new Error("Invalid job target");
  const targetFilter =
    target === undefined
      ? sql``
      : sql`and payload @> ${JSON.stringify({ userId: target.userId, subjectId: target.subjectId })}::jsonb`;
  const result = await sql<{
    id: string;
    kind: string;
    payload: unknown;
    payload_version: number;
    attempt: number;
    lease_token: string;
    lease_seconds: number;
  }>`
    with picked as (
      select id from plt.job
      where state in ('queued', 'retry_scheduled') and run_at <= ${now}
        and kind = any(${kinds as string[]})
        ${targetFilter}
      order by run_at
      for update skip locked
      limit ${limit}
    )
    update plt.job j
    set state = 'running', attempt = j.attempt + 1, lease_token = gen_random_uuid(),
        lease_until = ${now}::timestamptz + make_interval(secs => j.lease_seconds),
        updated_at = ${now}
    from picked where j.id = picked.id
    returning j.id, j.kind, j.payload, j.payload_version, j.attempt, j.lease_token,
      j.lease_seconds`.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    payloadVersion: row.payload_version,
    attempt: row.attempt,
    token: row.lease_token,
    leaseSeconds: row.lease_seconds,
  }));
}

/**
 * Extends a running job's lease from `now` (rule 5). Only the current claim may renew, so a
 * runner whose lease already ran out, or whose job was cancelled, gets false and stops renewing.
 */
export async function renewJobLease(db: Database, job: ClaimedJob, now: Date): Promise<boolean> {
  const result = await sql`
    update plt.job
    set lease_until = ${now}::timestamptz + make_interval(secs => lease_seconds)
    where id = ${job.id} and lease_token = ${job.token} and state = 'running'`.execute(db);
  return Number(result.numAffectedRows ?? 0) === 1;
}

/** False when this claim is void: its lease ran out, or the job was cancelled. */
export async function completeJob(db: Database, job: ClaimedJob, now: Date): Promise<boolean> {
  const result = await db
    .updateTable("plt.job")
    .set({
      state: "succeeded",
      lease_token: null,
      lease_until: null,
      updated_at: now,
      finished_at: now,
    })
    .where("id", "=", job.id)
    .where("lease_token", "=", job.token)
    .where("state", "=", "running")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

/**
 * Records a failed attempt with a short reason code. Retries later with a growing delay, or
 * fails for good after the last attempt or when `terminal` (rule 4).
 */
export async function failJob(
  db: Database,
  job: ClaimedJob,
  reason: string,
  now: Date,
  terminal = false,
): Promise<JobState | null> {
  const code = REASON.test(reason) ? reason : "handler_error";
  const result = await sql<{ state: JobState }>`
    update plt.job
    set state = case when ${terminal} or attempt >= max_attempts then 'failed' else 'retry_scheduled' end,
        run_at = ${now}::timestamptz + make_interval(secs =>
          least(retry_max_seconds, retry_base_seconds * power(2, attempt - 1))),
        finished_at = case when ${terminal} or attempt >= max_attempts then ${now}::timestamptz end,
        last_error = ${code}, lease_token = null, lease_until = null, updated_at = ${now}
    where id = ${job.id} and lease_token = ${job.token} and state = 'running'
    returning state`.execute(db);
  return result.rows[0]?.state ?? null;
}

/** A cancelled job is never claimed; a running one stops at its next step (rule 7). */
export async function cancelJob(db: Database | Tx, jobId: string, now: Date): Promise<void> {
  await db
    .updateTable("plt.job")
    .set({
      state: "cancelled",
      lease_token: null,
      lease_until: null,
      updated_at: now,
      finished_at: now,
    })
    .where("id", "=", jobId)
    .where("state", "in", ["queued", "retry_scheduled", "running"])
    .execute();
}

export async function jobState(db: Database, jobId: string): Promise<JobState | null> {
  const row = await db
    .selectFrom("plt.job")
    .select("state")
    .where("id", "=", jobId)
    .executeTakeFirst();
  return (row?.state as JobState | undefined) ?? null;
}

/** States of several jobs at once; a purged (finished) job is simply absent from the map. */
export async function jobStates(
  db: Database | Tx,
  jobIds: readonly string[],
): Promise<Map<string, JobState>> {
  const ids = [...new Set(jobIds)];
  if (!ids.length) return new Map();
  const rows = await db
    .selectFrom("plt.job")
    .select(["id", "state"])
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((row) => [row.id, row.state as JobState]));
}

/** Trusted orchestration avoids duplicate work through the platform API. */
export async function latestJobStateForPayload(
  db: Database | Tx,
  kind: string,
  identifiers: Readonly<Record<string, string>>,
): Promise<JobState | null> {
  if (!KIND.test(kind) || !Object.keys(identifiers).length) throw new Error("Invalid job lookup");
  const row = await db
    .selectFrom("plt.job")
    .select("state")
    .where("kind", "=", kind)
    .where("payload", "@>", JSON.stringify(identifiers))
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return (row?.state as JobState | undefined) ?? null;
}

/**
 * P2-03: when the last job of `kind` that succeeded finished, at or before `before`; null when none
 * did (or it was purged). Read-only: a time only, never a job's id or payload. The health check
 * reads it to start its next window where the last successful check left off.
 */
export async function lastSucceededJobAt(
  db: Database | Tx,
  kind: string,
  before: Date,
): Promise<Date | null> {
  if (!KIND.test(kind) || !Number.isFinite(before.getTime())) throw new Error("Invalid job lookup");
  const row = await db
    .selectFrom("plt.job")
    .select((eb) => eb.fn.max("finished_at").as("finished_at"))
    .where("kind", "=", kind)
    .where("state", "=", "succeeded")
    .where("finished_at", "<=", before)
    .executeTakeFirst();
  const at = row?.finished_at ?? null;
  return at === null ? null : new Date(at);
}

/**
 * Returns jobs whose lease ran out (the runner crashed or timed out) to the queue, or fails them
 * after their last attempt (rule 5). Every runner sweeps before it claims.
 */
export async function sweepJobs(db: Database, now: Date): Promise<number> {
  const result = await sql`
    update plt.job
    set state = case when attempt >= max_attempts then 'failed' else 'retry_scheduled' end,
        finished_at = case when attempt >= max_attempts then ${now}::timestamptz end,
        run_at = ${now}, last_error = 'lease_expired', lease_token = null, lease_until = null,
        updated_at = ${now}
    where state = 'running' and lease_until < ${now}`.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

/** Read an existing checkpoint before an idempotent external effect that must not hold a DB lease. */
export async function hasJobStep(db: Database, jobId: string, name: string): Promise<boolean> {
  const marked = await db
    .selectFrom("plt.job_step")
    .select("step")
    .where("job_id", "=", jobId)
    .where("step", "=", name)
    .executeTakeFirst();
  return marked !== undefined;
}

/** One step of a claimed job; `JobContext.step` calls this. Exported for tests and tools. */
export async function runJobStep(
  db: Database,
  job: ClaimedJob,
  name: string,
  effect: (tx: Tx) => Promise<void>,
  now: Date,
): Promise<"ran" | "skipped"> {
  return db.transaction().execute(async (tx) => {
    const current = await tx
      .selectFrom("plt.job")
      .select("state")
      .where("id", "=", job.id)
      .forUpdate()
      .executeTakeFirst();
    if (current?.state === "cancelled") throw new JobCancelled();
    const marked = await tx
      .insertInto("plt.job_step")
      .values({ job_id: job.id, step: name, done_at: now })
      .onConflict((oc) => oc.doNothing())
      .returning("step")
      .executeTakeFirst();
    if (!marked) return "skipped";
    await effect(tx);
    return "ran";
  });
}

export interface RunOptions {
  /** Stop claiming new jobs after this moment, so the function ends within its time limit. */
  deadline: Date;
  /** When the runner's function itself stops; handlers see it as `JobContext.deadline`. */
  finishBy?: Date;
  now?: () => Date;
  log?: Logger;
  /** Only these kinds, e.g. the one just enqueued; defaults to every definition. */
  kinds?: readonly string[];
  /** Restrict an immediate wake to its authorized owner and subject; never fall back to all jobs. */
  target?: JobTarget;
  /** How often a running job's lease is renewed; defaults to a quarter of its lease. */
  leaseRenewalMs?: number;
}

/** A hung renewal plus one more; any more would only take further pool connections. */
const MAX_UNSETTLED_RENEWALS = 2;

/**
 * Calls `renew` every `every` ms until stopped or until it reports the claim lost. A renewal
 * still unsettled after most of its period counts as failed, so the next one still runs: the
 * pool has no query timeout, and one hung connection must not let the lease run out. Each
 * unsettled renewal still holds a pool connection, so no new one starts while
 * `MAX_UNSETTLED_RENEWALS` are unsettled. The returned stop waits for a renewal in flight only up
 * to that bound.
 */
export function keepRenewing(
  renew: () => Promise<boolean>,
  every: number,
  report: (
    event: "job_lease_lost" | "job_lease_renewal_failed" | "job_lease_renewal_timeout",
  ) => void,
): () => Promise<void> {
  const boundMs = Math.max(1, Math.floor(every * 0.8));
  let renewal: Promise<void> | null = null;
  let unsettled = 0;
  let lost = false;
  const timer = setInterval(() => {
    if (renewal || lost || unsettled >= MAX_UNSETTLED_RENEWALS) return;
    let bound: ReturnType<typeof setTimeout> | undefined;
    unsettled += 1;
    const call = renew().finally(() => {
      unsettled -= 1;
    });
    const current: Promise<void> = Promise.race([
      call.then(
        (renewed) => {
          // Cancelled, or claimed again after an expiry: the token guards completion either way.
          if (!renewed) {
            lost = true;
            report("job_lease_lost");
          }
        },
        () => report("job_lease_renewal_failed"),
      ),
      new Promise<void>((resolve) => {
        bound = setTimeout(() => {
          report("job_lease_renewal_timeout");
          resolve();
        }, boundMs);
      }),
    ]).finally(() => {
      clearTimeout(bound);
      if (renewal === current) renewal = null;
    });
    renewal = current;
  }, every);
  return async () => {
    clearInterval(timer);
    await renewal;
  };
}

/**
 * Renews the claim while its handler runs (rule 5), so a lease can be short and a runner that
 * stopped is found soon after.
 */
function keepLease(
  db: Database,
  job: ClaimedJob,
  now: () => Date,
  options: Pick<RunOptions, "leaseRenewalMs" | "log">,
): () => Promise<void> {
  const every = options.leaseRenewalMs ?? Math.max(1000, (job.leaseSeconds * 1000) / 4);
  const fields = { kind: job.kind, job_id: job.id, attempt: job.attempt };
  return keepRenewing(
    () => renewJobLease(db, job, now()),
    every,
    (event) => options.log?.("warn", event, fields),
  );
}

export interface RunSummary {
  swept: number;
  succeeded: number;
  failed: number;
  retried: number;
  cancelled: number;
}

/** Sweeps, then runs due jobs one at a time until none are left or the deadline passes. */
export async function runDueJobs(
  db: Database,
  // biome-ignore lint/suspicious/noExplicitAny: each definition checks its own payload type.
  definitions: readonly JobDefinition<any>[],
  options: RunOptions,
): Promise<RunSummary> {
  const now = options.now ?? (() => new Date());
  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));
  const kinds = options.kinds ?? [...byKind.keys()];
  const summary: RunSummary = {
    swept: await sweepJobs(db, now()),
    succeeded: 0,
    failed: 0,
    retried: 0,
    cancelled: 0,
  };

  while (now() < options.deadline) {
    const [job] = await claimJobs(db, kinds, 1, now(), options.target);
    if (!job) break;
    const definition = byKind.get(job.kind);
    const fields = { kind: job.kind, job_id: job.id, attempt: job.attempt };
    const parsed = definition?.payload.safeParse(job.payload);
    if (!definition || !parsed?.success || job.payloadVersion !== definition.version) {
      // A payload that doesn't match its definition was not written by our code.
      await failJob(db, job, "payload_invalid", now(), true);
      await recordSecurityEvent(db, { kind: "job_tampered", route: job.kind }, options.log);
      summary.failed += 1;
      continue;
    }
    const ctx: JobContext = {
      db,
      now,
      job: { id: job.id, attempt: job.attempt },
      ...(options.finishBy ? { deadline: options.finishBy } : {}),
      ...(options.log ? { log: options.log } : {}),
      step: (name, effect) => runJobStep(db, job, name, effect, now()),
    };
    const stopRenewal = keepLease(db, job, now, options);
    try {
      try {
        await definition.run(parsed.data, ctx);
      } finally {
        await stopRenewal();
      }
      if (await completeJob(db, job, now())) summary.succeeded += 1;
      options.log?.("info", "job_succeeded", fields);
    } catch (error) {
      if (error instanceof JobCancelled) {
        summary.cancelled += 1;
        options.log?.("info", "job_cancelled", fields);
        continue;
      }
      const code = error instanceof AppError ? error.code : "handler_error";
      const state = await failJob(db, job, code, now());
      if (state === "failed") summary.failed += 1;
      else summary.retried += 1;
      options.log?.(state === "failed" ? "error" : "warn", "job_failed", {
        ...fields,
        code,
        error_name: error instanceof Error ? error.name : typeof error,
        error_location: errorLocation(error),
        cause_code: causeCode(error),
        reason: error instanceof AppError ? error.reason : undefined,
      });
    }
  }
  return summary;
}

/**
 * Adds a periodic job once per period: the period number is its singleton key, so the cron run
 * that comes first in each period adds it and the rest find it there.
 */
export async function ensurePeriodicJob(
  db: Database,
  definition: JobDefinition<Record<string, never>>,
  everySeconds: number,
  now: Date,
  defaults: PltSettings["jobs"],
): Promise<string | null> {
  const period = Math.floor(now.getTime() / 1000 / everySeconds);
  return db.transaction().execute((tx) =>
    enqueueJob(tx, definition, {
      payload: {},
      now,
      defaults,
      singletonKey: `every-${everySeconds}s-${period}`,
    }),
  );
}

/** Deletes finished jobs older than the retention period, with their steps. */
export async function purgeFinishedJobs(db: Database, before: Date): Promise<number> {
  const result = await db
    .deleteFrom("plt.job")
    .where("finished_at", "<", before)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
