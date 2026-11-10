import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import {
  AppError,
  emptyPayload,
  type JobState,
  jobStates,
  type LearnerContext,
  type PeriodicJob,
} from "../plt";
import { emptyAmounts, settleAllowance } from "../quota";
import { getSource, readInputContract, temporaryAudioUploadStates } from "../src";
import { failAuxiliaryRun } from "./auxiliary";
import { snapshotSourceSchema } from "./contracts";
import { type AwaitingUploadFailure, failAwaitingUploadRun, ownedRun } from "./runs";

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
) {
  return db.transaction().execute(async (tx) => {
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
      await afterAuxiliaryClose?.(tx, ctx, run.id, closed, now);
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
) => Promise<void>;
/**
 * PRD-02: closes runs whose job ended without the worker settling them, so the reservation is
 * released, the learner is told, and the same session can be processed again (or, with a provider
 * request in flight, reviewed by the operator first). Stuck runs are never updated, so they sort
 * first. One failing run does not hold back the others; the first failure is rethrown at the end,
 * so the job is logged as failed and retried next period.
 */
export async function reconcileEndedJobRuns(
  db: Database,
  now = new Date(),
  options: {
    afterClose?: RunClosedHook;
    afterAuxiliaryClose?: AuxiliaryRunClosedHook;
    userId?: string;
    limit?: number;
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
      const kind = await closeEndedJobRun(db, ctx, runId, now, options.afterAuxiliaryClose);
      if (!kind) continue;
      closed++;
      // Like the worker's completion hook; the minute notification sweep repairs a failure here.
      if (kind === "class") await options.afterClose?.(db, ctx, runId, now);
    } catch (error) {
      // A deleted account or run is cleaned up by its own deletion path.
      if (error instanceof AppError && error.code === "not_found") continue;
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
          await reconcileEndedJobRuns(job.db, job.now(), {
            afterClose: options.afterRunClosed,
            afterAuxiliaryClose: options.afterAuxiliaryClose,
          });
        },
      },
    },
  ];
}
