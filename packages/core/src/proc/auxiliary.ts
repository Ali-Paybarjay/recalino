import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import type { AiProvider, ProviderResult } from "../aip";
import type { Tx } from "../db";
import { assertSessionOwner } from "../org";
import {
  cancelJob,
  canonicalJson,
  enqueueJob,
  errors,
  type JobContext,
  type JobDefinition,
  type LearnerContext,
  readPltSettings,
  sha256Hex,
} from "../plt";
import {
  type Amounts,
  amountsSchema,
  emptyAmounts,
  reserveAllowance,
  settleAllowance,
} from "../quota";
import { ownedRun } from "./runs";
import { providerStep } from "./worker";

/** Injected into higher-module jobs: every AI operation uses PROC attempt/cost/state handling. */
export async function scheduleAuxiliaryRun(
  tx: Tx,
  ctx: LearnerContext,
  input: {
    sessionId: string;
    operationKey: string;
    subjectId: string;
    requested: Amounts;
    request: unknown;
    settings: unknown;
    job: JobDefinition<{ runId: string; userId: string; subjectId: string }>;
  },
  now = new Date(),
): Promise<string> {
  await lockAccount(tx, ctx.userId);
  const session = await assertSessionOwner(tx, ctx, input.sessionId);
  const requestHash = sha256Hex(
    canonicalJson({
      subjectId: input.subjectId,
      request: input.request,
      settings: input.settings,
      requested: input.requested,
    }),
  );
  const previous = await tx
    .selectFrom("proc.processing_run")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("operation_key", "=", input.operationKey)
    .executeTakeFirst();
  if (previous) {
    if (previous.request_hash !== requestHash) throw errors.idempotencyMismatch();
    return previous.id;
  }
  const active = await tx
    .selectFrom("proc.processing_run")
    .select("id")
    .where("session_id", "=", session.id)
    .where("state", "in", ["awaiting_upload", "queued", "processing"])
    .executeTakeFirst();
  if (active) throw errors.conflict();
  const id = randomUUID();
  const requested = amountsSchema.parse(input.requested);
  const reservation = await reserveAllowance(tx, ctx, `auxiliary:${id}`, requested, now);
  const jobId = await enqueueJob(tx, input.job, {
    payload: { runId: id, userId: ctx.userId, subjectId: input.subjectId },
    singletonKey: id,
    now,
    defaults: readPltSettings().jobs,
  });
  await tx
    .insertInto("proc.processing_run")
    .values({
      id,
      kind: "auxiliary",
      user_id: ctx.userId,
      session_id: session.id,
      operation_key: input.operationKey,
      request_hash: requestHash,
      sources_version: session.sourcesVersion,
      source_fingerprint: requestHash,
      input_snapshot: JSON.stringify({ subjectId: input.subjectId, request: input.request }),
      settings: JSON.stringify(input.settings),
      requested_amounts: JSON.stringify(requested),
      reservation_id: reservation.id,
      state: "queued",
      job_id: jobId,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}
export async function executeAuxiliaryProviderStep<T>(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  input: {
    step: string;
    model: string;
    provider: AiProvider;
    schema: z.ZodType<T>;
    effect: (operationKey: string) => Promise<ProviderResult<T>>;
  },
): Promise<T> {
  await job.db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, runId, true);
    await assertSessionOwner(tx, ctx, run.session_id);
    if (!["queued", "processing"].includes(run.state)) throw errors.conflict();
    await tx
      .updateTable("proc.processing_run")
      .set({ state: "processing", updated_at: job.now() })
      .where("id", "=", run.id)
      .execute();
  });
  return providerStep(
    job,
    ctx,
    runId,
    input.step,
    input.model,
    input.provider,
    input.schema,
    input.effect,
  );
}
export async function completeAuxiliaryRun(
  tx: Tx,
  ctx: LearnerContext,
  runId: string,
  published: Amounts,
  now = new Date(),
): Promise<void> {
  await lockAccount(tx, ctx.userId);
  const run = await ownedRun(tx, ctx, runId, true);
  await assertSessionOwner(tx, ctx, run.session_id);
  if (run.state === "ready") return;
  if (!["queued", "processing"].includes(run.state)) throw errors.conflict();
  await settleAllowance(tx, ctx, run.reservation_id, published, now);
  await tx
    .updateTable("proc.processing_run")
    .set({ state: "ready", finished_at: now, updated_at: now })
    .where("id", "=", run.id)
    .execute();
}
export async function failAuxiliaryRun(
  db: Tx,
  ctx: LearnerContext,
  runId: string,
  input: { code: string; uncertain?: boolean; cancelled?: boolean },
  now = new Date(),
): Promise<void> {
  await lockAccountForCleanup(db, ctx.userId);
  const run = await ownedRun(db, ctx, runId, true);
  if (!["queued", "processing", "awaiting_upload"].includes(run.state)) return;
  if (run.job_id && input.cancelled) await cancelJob(db, run.job_id, now);
  await settleAllowance(db, ctx, run.reservation_id, emptyAmounts(), now);
  await db
    .updateTable("proc.processing_run")
    .set({
      state: input.cancelled ? "cancelled" : input.uncertain ? "needs_input" : "failed",
      last_error: input.code,
      finished_at: now,
      updated_at: now,
    })
    .where("id", "=", run.id)
    .execute();
}
