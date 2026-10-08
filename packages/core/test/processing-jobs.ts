import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Database } from "../src/db";
import {
  AppError,
  type ClaimedJob,
  cancelJob,
  completeJob,
  failJob,
  JobCancelled,
  type JobDefinition,
  runJobStep,
} from "../src/plt";

/** Exercise the real job lease/checkpoints while never claiming another fixture's queue. */
export async function runFixtureProcessingStep<P extends { runId: string; userId: string }>(
  db: Database,
  definition: JobDefinition<P>,
  subject: { runId: string; userId: string },
): Promise<boolean> {
  const claimed = await db.transaction().execute(async (tx) => {
    const run = await tx
      .selectFrom("proc.processing_run")
      .select(["job_id", "state"])
      .where("id", "=", subject.runId)
      .where("user_id", "=", subject.userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!run.job_id || !["queued", "processing"].includes(run.state)) return null;
    const job = await tx
      .selectFrom("plt.job")
      .selectAll()
      .where("id", "=", run.job_id)
      .where("kind", "=", definition.kind)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const now = new Date();
    if (!["queued", "retry_scheduled"].includes(job.state) || job.run_at > now) return null;
    const payload = definition.payload.parse(job.payload);
    if (
      payload.runId !== subject.runId ||
      payload.userId !== subject.userId ||
      job.payload_version !== definition.version
    )
      throw new Error("Fixture job ownership or version mismatch");
    const token = randomUUID();
    await tx
      .updateTable("plt.job")
      .set({
        state: "running",
        attempt: job.attempt + 1,
        lease_token: token,
        lease_until: new Date(now.getTime() + job.lease_seconds * 1000),
        updated_at: now,
      })
      .where("id", "=", job.id)
      .execute();
    const claim: ClaimedJob = {
      id: job.id,
      kind: job.kind,
      payload,
      payloadVersion: job.payload_version,
      attempt: job.attempt + 1,
      token,
    };
    return { claim, payload };
  });
  if (!claimed) return false;
  const { claim, payload } = claimed;
  try {
    await definition.run(payload, {
      db,
      now: () => new Date(),
      job: { id: claim.id, attempt: claim.attempt },
      step: (name, effect) => runJobStep(db, claim, name, effect, new Date()),
    });
    await completeJob(db, claim, new Date());
  } catch (error) {
    if (!(error instanceof JobCancelled))
      await failJob(
        db,
        claim,
        error instanceof AppError ? error.code : "handler_error",
        new Date(),
      );
  }
  return true;
}

/** No global sweep: bounded continuations for just this synthetic learner/session. */
export async function runFixtureProcessingJobs<P extends { runId: string; userId: string }>(
  db: Database,
  definition: JobDefinition<P>,
  subject: { userId: string; sessionId: string },
): Promise<void> {
  for (let step = 0; step < 20; step++) {
    const run = await db
      .selectFrom("proc.processing_run")
      .select("id")
      .where("user_id", "=", subject.userId)
      .where("session_id", "=", subject.sessionId)
      .where("state", "in", ["queued", "processing"])
      .executeTakeFirst();
    if (
      !run ||
      !(await runFixtureProcessingStep(db, definition, { runId: run.id, userId: subject.userId }))
    )
      return;
  }
  throw new Error("Fixture processing exceeded its bounded continuation count");
}

/** Only IDs created by the calling test file are eligible for cleanup. */
export async function cleanupFixtureProcessingJobs(
  db: Database,
  runIds: readonly string[],
): Promise<void> {
  if (!runIds.length) return;
  const jobs = await db
    .selectFrom("plt.job")
    .select("id")
    .where(sql<string>`payload->>'runId'`, "in", runIds)
    .where("kind", "in", ["proc.process", "proc.voice_analysis"])
    .execute();
  for (const job of jobs) await cancelJob(db, job.id, new Date());
}
