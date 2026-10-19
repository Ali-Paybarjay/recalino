import { lockAccount } from "../../acc";
import { ProviderError } from "../../aip";
import { AppError, JobCancelled, readPltSettings } from "../../plt";
import { emptyAmounts, settleAllowance } from "../../quota";
import { ownedRun } from "../runs";
import type { ProcessingRun } from "./context";
import { processingFailureCode } from "./knowledge-checks";

/**
 * The last stage of a failed job (audit QUA-01, moved from processingJob): a cancelled job ends
 * quietly and a retryable provider failure is rethrown for the runner's retry; otherwise the
 * whole hold is released and the run records a code-owned failure code.
 */
export async function failRun(
  base: Pick<ProcessingRun, "job" | "ctx" | "payload">,
  error: unknown,
): Promise<void> {
  const { job, ctx, payload } = base;
  if (error instanceof JobCancelled) return;
  if (
    error instanceof ProviderError &&
    error.retryable &&
    job.job.attempt < readPltSettings().jobs.maxAttempts
  )
    throw error;
  await job.db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, payload.runId, true);
    if (!["queued", "processing"].includes(run.state)) return;
    const code =
      error instanceof ProviderError
        ? error.code
        : error instanceof AppError
          ? (processingFailureCode(error) ?? error.code)
          : "processing_failed";
    await settleAllowance(tx, ctx, run.reservation_id, emptyAmounts(), job.now());
    await tx
      .updateTable("proc.processing_run")
      .set({
        state: error instanceof ProviderError && error.uncertain ? "needs_input" : "failed",
        last_error: code,
        finished_at: job.now(),
        updated_at: job.now(),
      })
      .where("id", "=", run.id)
      .execute();
  });
}
