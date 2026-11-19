import { sql } from "kysely";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import {
  AppError,
  assertJobAuthority,
  emptyPayload,
  errors,
  type JobContext,
  type JobState,
  jobStates,
  type LearnerContext,
  type PeriodicJob,
} from "../plt";
import { emptyAmounts, providerAttemptHoldSql, settleAllowance } from "../quota";
import { getSource, readInputContract, temporaryAudioUploadStates } from "../src";
import { failAuxiliaryRun } from "./auxiliary";
import { snapshotSourceSchema } from "./contracts";
import { type AwaitingUploadFailure, failAwaitingUploadRun, ownedRun } from "./runs";
import {
  assertWriteAuthority,
  closeAttemptHoldAtMaximum,
  isConservativelyClosedAttempt,
  isJobLeaseLost,
  UNRESOLVED_ATTEMPT_STATES,
} from "./steps/runtime";

// P12-01 (AC-3, r1): the one three-part definition lives beside the worker's trace that also reads
// it (steps/runtime.ts); the reconciliation and the operator's counts use it from here.
export { isConservativelyClosedAttempt };

const audioSourceIdsSchema = z.array(snapshotSourceSchema.shape.sourceId);

/**
 * Why an awaiting run ran out of time. Only a verifier rejection says the audio itself failed; an
 * upload that never started or never finished keeps the device original valid for a new attempt.
 */
export function expiredUploadCode(
  audioSourceIds: readonly string[],
  receipts: ReadonlyMap<string, string>,
): AwaitingUploadFailure {
  if (audioSourceIds.some((id) => receipts.get(id) === "rejected")) return "audio_upload_rejected";
  if (audioSourceIds.some((id) => receipts.has(id))) return "audio_upload_incomplete";
  return "audio_upload_not_started";
}
/**
 * Runs waiting for an audio upload, each with only the audio source ids of its snapshot. D73: a
 * regeneration's snapshot carries every extracted transcript and page (up to about 700 KB), and this
 * check runs every five minutes, so the snapshot itself never crosses the pooler here.
 */
export async function awaitingUploadRuns(db: Database) {
  return db
    .selectFrom("proc.processing_run")
    .select([
      "id",
      "user_id",
      "reservation_id",
      "created_at",
      // Not an array means a malformed snapshot: null fails validation, as the whole parse did.
      sql<unknown>`case when jsonb_typeof(input_snapshot->'sources') = 'array' then coalesce((
        select jsonb_agg(source->'sourceId' order by ordinal)
        from jsonb_array_elements(input_snapshot->'sources') with ordinality as sources(source, ordinal)
        where source->>'kind' = 'audio'), '[]'::jsonb) end`.as("audio_source_ids"),
    ])
    .where("state", "=", "awaiting_upload")
    .orderBy("created_at")
    .limit(250)
    .execute();
}
/** The recorded SRC contract sets each audio upload's timeout; commercial limits are never guessed. */
export async function expireAwaitingUploads(db: Database, now = new Date()): Promise<number> {
  let expired = 0;
  for (const run of await awaitingUploadRuns(db)) {
    const ctx = { userId: run.user_id, requestId: `expire:${run.id}` };
    let deadline = Number.POSITIVE_INFINITY;
    let missingSource = false;
    const audio = audioSourceIdsSchema.parse(run.audio_source_ids);
    try {
      for (const sourceId of audio) {
        const asset = await getSource(db, ctx, sourceId);
        const contract = await readInputContract(db, asset.contract_version);
        deadline = Math.min(deadline, run.created_at.getTime() + contract.uploadTtlSeconds * 1000);
      }
    } catch (error) {
      if (!(error instanceof AppError && error.code === "not_found")) throw error;
      deadline = 0;
      missingSource = true;
    }
    if (deadline <= now.getTime()) {
      // A deleted source keeps the earlier code: no saved original can be promised for it.
      const code = missingSource
        ? "audio_upload_rejected"
        : expiredUploadCode(audio, await temporaryAudioUploadStates(db, ctx, run.reservation_id));
      const result = await failAwaitingUploadRun(db, ctx, run.id, code, now);
      if (result.state === "needs_input") expired++;
    }
  }
  return expired;
}
/**
 * PRD-02: the fixed code of a run whose job ended without settling it, e.g. when the function
 * was stopped at its time limit on the last attempt and the sweep failed the job (`lease_expired`).
 * The learner sees the generic "could not finish" message with a retry.
 */
export const ENDED_JOB_RUN_ERROR = "processing_interrupted";
/** Run states only their job moves on; `awaiting_upload` has its own expiry above. */
const JOB_OWNED_RUN_STATES = new Set(["queued", "processing"]);
/** No handler runs such a job again. A finished job is purged later, so absence counts too. */
function jobEnded(state: JobState | undefined): boolean {
  return state === undefined || state === "failed" || state === "cancelled";
}
/**
 * How the worker itself ends such a run. A provider request still marked in flight may have been
 * answered and billed, so, like a reclaimed worker (`provider_outcome_unresolved`), the run waits
 * for the operator's review instead of offering a retry; otherwise it fails with the fixed code.
 */
export function endedJobRunOutcome(providerOutcomeUnresolved: boolean) {
  return providerOutcomeUnresolved
    ? ({ state: "needs_input", code: "provider_outcome_unresolved" } as const)
    : ({ state: "failed", code: ENDED_JOB_RUN_ERROR } as const);
}
/** The runs reconciliation closes: job-owned runs whose current job has ended. */
export function runsLeftByEndedJobs(
  runs: readonly { id: string; state: string; jobId: string | null }[],
  states: ReadonlyMap<string, JobState>,
): string[] {
  return runs
    .filter(
      (run) =>
        JOB_OWNED_RUN_STATES.has(run.state) &&
        run.jobId !== null &&
        jobEnded(states.get(run.jobId)),
    )
    .map((run) => run.id);
}
/**
 * Closes one run through the worker's own final-failure path: the whole reservation is released
 * (nothing is charged, FR-QUOTA-006) and the run ends as `endedJobRunOutcome` says. Re-checked
 * under the account and run locks, so a run the worker settled or a continuation re-queued is
 * left alone, and running it again has no further effect (PRD-COST-02).
 */
async function closeEndedJobRun(
  db: Database,
  ctx: LearnerContext,
  runId: string,
  now: Date,
  afterAuxiliaryClose?: AuxiliaryRunClosedHook,
  job?: Pick<JobContext, "lease">,
) {
  // C11-4 (P11-02): effects a hook defers until this transaction commits (a byte delete).
  const afterCommit: (() => Promise<void>)[] = [];
  const kind = await db.transaction().execute(async (tx) => {
    // P12-01 (F-11): run by the periodic job, the close has that job's authority first. A caller
    // without a job keeps the earlier behaviour for the run, and never closes a cost hold.
    if (job) await assertWriteAuthority(tx, job);
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, runId, true);
    const states = run.job_id ? await jobStates(tx, [run.job_id]) : new Map<string, JobState>();
    if (!runsLeftByEndedJobs([{ id: run.id, state: run.state, jobId: run.job_id }], states).length)
      return null;
    const inFlight = await tx
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", run.id)
      .where("state", "in", ["started", "uncertain"])
      .executeTakeFirst();
    const outcome = endedJobRunOutcome(inFlight !== undefined);
    if (run.kind === "auxiliary") {
      const closed = { code: outcome.code, uncertain: outcome.state === "needs_input" };
      await failAuxiliaryRun(tx, ctx, run.id, closed, now);
      // C8-4: the owning module ends its own record of this run (a speech asset) in the same
      // transaction, so a failing hook leaves the run open for the next reconciliation.
      await afterAuxiliaryClose?.(tx, ctx, run.id, closed, now, (effect) => {
        afterCommit.push(effect);
      });
      return run.kind;
    }
    await settleAllowance(tx, ctx, run.reservation_id, emptyAmounts(), now);
    await tx
      .updateTable("proc.processing_run")
      .set({
        state: outcome.state,
        last_error: outcome.code,
        finished_at: now,
        updated_at: now,
      })
      .where("id", "=", run.id)
      .execute();
    return run.kind;
  });
  for (const effect of afterCommit) await effect();
  return kind;
}
export type RunClosedHook = (
  db: Database,
  ctx: LearnerContext,
  runId: string,
  now: Date,
) => Promise<void>;
/**
 * C8-4: called when reconciliation fails an auxiliary run, after `failAuxiliaryRun` and inside its
 * transaction, with the code and certainty the run was closed with. The module that scheduled the
 * run (MEDIA for `media.tts`) injects it to end its own record of that run; PROC never imports
 * that module. A hook ignores runs it does not own.
 */
export type AuxiliaryRunClosedHook = (
  tx: Tx,
  ctx: LearnerContext,
  runId: string,
  outcome: { code: string; uncertain: boolean },
  now: Date,
  /** C11-4 (P11-02): runs `effect` once the transaction committed, e.g. a byte delete. */
  afterCommit?: (effect: () => Promise<void>) => void,
) => Promise<void>;
/**
 * P12-01 (AC-1, AC-8): job states whose work is still live, so their run's attempts are left to
 * them: a claim (with a valid lease, or an ended one the sweep requeues or fails), a queued job,
 * and one whose retry is scheduled; a job dispatched again closes its own unresolved hold
 * (beginProviderAttempt). Any other job, or none (its finished job was purged), has no authority
 * left over the run's attempts.
 */
const LIVE_JOB_STATES: readonly string[] = ["queued", "running", "retry_scheduled"];
/**
 * P12-01 (AC-1, F-3; AC-14): the run states in which an ended job can leave an unresolved attempt
 * with its hold open: a job-owned run whose job ended (also with its finished job purged), a run
 * left for review after the last try, and a run cancelled, or whose class or account was deleted,
 * while the call was in flight.
 */
const UNOWNED_ATTEMPT_RUN_STATES: readonly string[] = [
  "queued",
  "processing",
  "needs_input",
  "cancelled",
];
/**
 * One unresolved provider attempt with its hold, its run and its run's job; identifiers, states
 * and amounts only, never user data or provider output.
 */
export interface ProviderAttemptFacts {
  attemptId: string;
  userId: string;
  runId: string;
  holdId: string;
  operationKey: string;
  provider: string;
  model: string;
  estimatePriceVersion: string | null;
  attemptState: string;
  runState: string;
  /** Null when the run has no job: its finished job was purged (the pointer is set null). */
  jobState: string | null;
  holdCurrency: string;
  holdMaximumMicros: number;
  holdCreatedAt: Date;
  holdClosed: boolean;
  /** Whether a provider_cost row carries this attempt's own id. */
  costRecorded: boolean;
}
type AttemptClassFacts = Pick<
  ProviderAttemptFacts,
  "attemptState" | "runState" | "jobState" | "holdClosed" | "costRecorded"
>;
/**
 * P12-01 (AC-1, AC-8, E477 rule 2): the one definition of an attempt that no job will settle: its
 * outcome unknown, its hold still open, its run in a state an ended job leaves, and no live job on
 * the run. The reconciliation selects exactly these, re-checks each under the account lock, and
 * the operator's count of "still open, without authority" counts exactly these.
 */
export function isUnownedOpenAttempt(facts: AttemptClassFacts): boolean {
  return (
    UNRESOLVED_ATTEMPT_STATES.includes(facts.attemptState) &&
    !facts.holdClosed &&
    UNOWNED_ATTEMPT_RUN_STATES.includes(facts.runState) &&
    (facts.jobState === null || !LIVE_JOB_STATES.includes(facts.jobState))
  );
}
/**
 * P12-01: the facts of unresolved attempts whose hold is open; with `startedSince`, also those
 * started since then whose hold is closed; with `attemptId`, that attempt whatever its hold. A
 * light read, oldest hold first: unresolved attempts with open holds are the calls in flight and
 * the ones left behind.
 */
export async function providerAttemptFacts(
  db: Database | Tx,
  options: { userId?: string; attemptId?: string; startedSince?: Date } = {},
): Promise<ProviderAttemptFacts[]> {
  // ADR-0002 rule 4: the hold and its cost row through QUOTA's own subqueries, the job's state
  // through PLT's own read; PROC names only its own tables.
  const hold = providerAttemptHoldSql({
    attemptId: "a.id",
    holdId: "a.hold_id",
    userId: "a.user_id",
  });
  const since = options.startedSince;
  const rows = await db
    .selectFrom("proc.provider_attempt as a")
    .innerJoin("proc.processing_run as r", "r.id", "a.run_id")
    .select([
      "a.id as attempt_id",
      "a.user_id as user_id",
      "a.run_id as run_id",
      "a.hold_id as hold_id",
      "a.operation_key as operation_key",
      "a.provider as provider",
      "a.model as model",
      "a.estimate_price_version as estimate_price_version",
      "a.state as attempt_state",
      "r.state as run_state",
      "r.job_id as job_id",
      hold.currency.as("hold_currency"),
      hold.maximumMicros.as("hold_maximum_micros"),
      hold.createdAt.as("hold_created_at"),
      hold.closed.as("hold_closed"),
      hold.costRecorded.as("cost_recorded"),
    ])
    .where(hold.exists)
    .where("a.state", "in", [...UNRESOLVED_ATTEMPT_STATES])
    .$if(options.attemptId !== undefined, (query) =>
      query.where("a.id", "=", options.attemptId as string),
    )
    .$if(options.attemptId === undefined, (query) =>
      query.where(since ? sql<boolean>`(${hold.open} or a.started_at >= ${since})` : hold.open),
    )
    .$if(options.userId !== undefined, (query) =>
      query.where("a.user_id", "=", options.userId as string),
    )
    .orderBy(hold.createdAt)
    .orderBy("a.id")
    .execute();
  const jobIds = rows.flatMap((row) => (row.job_id ? [row.job_id] : []));
  const states = await jobStates(db, jobIds);
  return rows.map((row) => ({
    attemptId: row.attempt_id,
    userId: row.user_id,
    runId: row.run_id,
    holdId: row.hold_id,
    operationKey: row.operation_key,
    provider: row.provider,
    model: row.model,
    estimatePriceVersion: row.estimate_price_version,
    attemptState: row.attempt_state,
    runState: row.run_state,
    // A run without a job (its finished job was purged) has no job state.
    jobState: row.job_id ? (states.get(row.job_id) ?? null) : null,
    holdCurrency: row.hold_currency,
    holdMaximumMicros: Number(row.hold_maximum_micros),
    holdCreatedAt: new Date(row.hold_created_at),
    holdClosed: Boolean(row.hold_closed),
    costRecorded: Boolean(row.cost_recorded),
  }));
}
/**
 * P12-01 (AC-8): what the operator sees beside the unknown outcomes: attempts started since
 * `since` whose hold was closed conservatively (the three-part record), and attempts still open
 * that no job will settle (the reconciliation's own selection, isUnownedOpenAttempt). Counts only.
 */
export async function providerHoldReconcileCounts(
  db: Database,
  since: Date,
  options: { userId?: string } = {},
): Promise<{ conservativelyClosed: number; unownedOpen: number }> {
  const facts = await providerAttemptFacts(db, { startedSince: since, userId: options.userId });
  return {
    conservativelyClosed: facts.filter(isConservativelyClosedAttempt).length,
    unownedOpen: facts.filter(isUnownedOpenAttempt).length,
  };
}
/** The job a reconciliation runs as; its claim is the only authority for a cost close. */
export type ReconcileJob = Pick<JobContext, "db" | "now" | "job" | "lease" | "log">;
/**
 * ADR-0004 rule 7: a cost close needs a real claim. assertWriteAuthority, without its test-only
 * exception: a context without a lease is refused (JobLeaseLost) before any read or write.
 */
async function assertCloseAuthority(tx: Tx, job: Pick<JobContext, "lease">) {
  if (job.lease === undefined) await assertJobAuthority(tx, undefined);
  await assertWriteAuthority(tx, job);
}
/**
 * P12-01 (C11-36 step one; ADR-0004 rules 6 and 7): closes, with the reconciliation job's own
 * authority, the open hold of each attempt no job will settle (isUnownedOpenAttempt), once, at
 * the hold's maximum, through the dispatch path's own close (closeAttemptHoldAtMaximum). One
 * provider_cost row for the attempt, dated at the hold's own `created_at` (AC-13); the hold's
 * `closed_at` is the real time of the close (`job.now()`), which the log line repeats. The attempt
 * keeps its state, so every retry guard still reads an unknown outcome (AC-6). Each close is its
 * own transaction: the job's authority first, then the account lock, then the selection again;
 * a close is counted only when it wrote the row and closed the hold, read back in the same
 * transaction. A lost authority stops the pass at once; any other failure is rethrown at the end.
 * Nothing calls a provider.
 */
export async function closeUnownedProviderHolds(
  job: ReconcileJob,
  options: { userId?: string; limit?: number } = {},
): Promise<number> {
  const candidates = (await providerAttemptFacts(job.db, { userId: options.userId }))
    .filter(isUnownedOpenAttempt)
    .slice(0, Math.min(250, options.limit ?? 250));
  let closed = 0;
  let failure: unknown;
  for (const candidate of candidates) {
    const now = job.now();
    try {
      const done = await job.db.transaction().execute(async (tx) => {
        await assertCloseAuthority(tx, job);
        await lockAccountForCleanup(tx, candidate.userId);
        const [current] = await providerAttemptFacts(tx, { attemptId: candidate.attemptId });
        if (!current || !isUnownedOpenAttempt(current)) return null;
        const ctx = { userId: current.userId, requestId: `reconcile:${current.attemptId}` };
        const outcome = await closeAttemptHoldAtMaximum(
          tx,
          ctx,
          current.runId,
          {
            id: current.attemptId,
            hold_id: current.holdId,
            operation_key: current.operationKey,
            provider: current.provider,
            model: current.model,
            estimate_price_version: current.estimatePriceVersion,
          },
          { currency: current.holdCurrency, priceVersion: null, now, recordAtHoldTime: true },
        );
        if (outcome !== "recorded") return null;
        // AC-5: reported only when the attempt's row and the closed hold are there (read back).
        const [after] = await providerAttemptFacts(tx, { attemptId: current.attemptId });
        if (!after || !isConservativelyClosedAttempt(after)) throw errors.conflict();
        return current;
      });
      if (!done) continue;
      closed++;
      // AC-13: the real time of the close is this line's own time and the hold's closed_at.
      job.log?.("warn", "provider_hold_closed_conservatively", {
        module: "proc",
        job_id: job.job.id,
        attempt: job.job.attempt,
        code: "hold_closed_at_maximum",
        state: done.attemptState,
        reason: done.operationKey,
        hold_micros: done.holdMaximumMicros,
        age_ms: now.getTime() - done.holdCreatedAt.getTime(),
      });
    } catch (error) {
      if (isJobLeaseLost(error)) throw error;
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return closed;
}
/**
 * PRD-02: closes runs whose job ended without the worker settling them, so the reservation is
 * released, the learner is told, and the same session can be processed again (or, with a provider
 * request in flight, reviewed by the operator first). Stuck runs are never updated, so they sort
 * first. One failing run does not hold back the others; the first failure is rethrown at the end,
 * so the job is logged as failed and retried next period.
 *
 * P12-01: given `job`, the reconciliation job's own context, each run close checks that job's
 * authority first, and the pass then closes the open cost holds no job will settle
 * (closeUnownedProviderHolds). Without `job` no cost hold is closed: there is no default authority
 * and no fallback. The count is of runs closed, as before.
 */
export async function reconcileEndedJobRuns(
  db: Database,
  now = new Date(),
  options: {
    afterClose?: RunClosedHook;
    afterAuxiliaryClose?: AuxiliaryRunClosedHook;
    userId?: string;
    limit?: number;
    job?: ReconcileJob;
  } = {},
): Promise<number> {
  const runs = await db
    .selectFrom("proc.processing_run")
    .select(["id", "user_id", "state", "job_id as jobId"])
    .where("state", "in", [...JOB_OWNED_RUN_STATES])
    .where("job_id", "is not", null)
    .$if(!!options.userId, (query) => query.where("user_id", "=", options.userId as string))
    .orderBy("updated_at")
    .limit(Math.min(250, options.limit ?? 250))
    .execute();
  const states = await jobStates(
    db,
    runs.flatMap((run) => (run.jobId ? [run.jobId] : [])),
  );
  const owners = new Map(runs.map((run) => [run.id, run.user_id]));
  let closed = 0;
  let failure: unknown;
  for (const runId of runsLeftByEndedJobs(runs, states)) {
    const ctx = { userId: owners.get(runId) as string, requestId: `reconcile:${runId}` };
    try {
      const kind = await closeEndedJobRun(
        db,
        ctx,
        runId,
        now,
        options.afterAuxiliaryClose,
        options.job,
      );
      if (!kind) continue;
      closed++;
      // Like the worker's completion hook; the minute notification sweep repairs a failure here.
      if (kind === "class") await options.afterClose?.(db, ctx, runId, now);
    } catch (error) {
      // P12-01: without its authority the job writes nothing more in this pass.
      if (isJobLeaseLost(error)) throw error;
      // A deleted account or run is cleaned up by its own deletion path.
      if (error instanceof AppError && error.code === "not_found") continue;
      failure ??= error;
    }
  }
  if (options.job) {
    try {
      await closeUnownedProviderHolds(options.job, {
        userId: options.userId,
        limit: options.limit,
      });
    } catch (error) {
      if (isJobLeaseLost(error)) throw error;
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return closed;
}
export function processingPeriodicJobs(
  options: { afterRunClosed?: RunClosedHook; afterAuxiliaryClose?: AuxiliaryRunClosedHook } = {},
): PeriodicJob[] {
  return [
    {
      everySeconds: 300,
      definition: {
        kind: "proc.expire_uploads",
        version: 1,
        payload: emptyPayload,
        async run(_payload, job) {
          await expireAwaitingUploads(job.db, job.now());
        },
      },
    },
    {
      everySeconds: 300,
      definition: {
        kind: "proc.reconcile_ended_jobs",
        version: 1,
        payload: emptyPayload,
        async run(_payload, job) {
          // P12-01 (F-11): the job's own context is its authority for every close it makes.
          await reconcileEndedJobRuns(job.db, job.now(), {
            afterClose: options.afterRunClosed,
            afterAuxiliaryClose: options.afterAuxiliaryClose,
            job,
          });
        },
      },
    },
  ];
}
