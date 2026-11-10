// Run-step primitives shared by the processing job and its stages (audit QUA-01): checkpoints,
// the paid provider step, timing and the continuation job. Moved verbatim from worker.ts.

import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../../acc";
import {
  type AiProvider,
  effectiveProviderTimeoutMs,
  estimatedUsageCost,
  estimateRatesSchema,
  maximumProviderCost,
  ProviderError,
  type ProviderResult,
  readEstimateRates,
  transcriptSchema,
} from "../../aip";
import type { Database, DB, Tx } from "../../db";
import { assertSessionOwner } from "../../org";
import {
  AppError,
  deleteObject,
  enqueueJob,
  errors,
  JobCancelled,
  type JobContext,
  type JobDefinition,
  type LearnerContext,
  type ObjectStore,
  readOwnedObject,
  readPltSettings,
} from "../../plt";
import { beginProviderStep, finishProviderStep } from "../../quota";
import { appendContentVersion, automaticSourceRole, sourceContentSchema } from "../../src";
import type { RunSource } from "../contracts";
import { knowledgeTruncationSchema } from "../knowledge-compact";
import { usesContentKnowledgeContract } from "../knowledge-contract";
import { knowledgeRepairDetailSchema } from "../knowledge-generation";
import { knowledgeSchemaFailureSchema } from "../knowledge-generation-step";
import { ownedRun } from "../runs";
import type { VoiceDiarizer } from "../voice-processing";

export const audioChunkSchema = z.strictObject({
  id: z.string().min(1).max(100),
  sourceId: z.uuid(),
  objectId: z.uuid(),
  offsetMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  format: z.literal("mp3"),
});
export type AudioChunk = z.infer<typeof audioChunkSchema>;
export type AudioPreparer = (input: {
  db: Database;
  store: ObjectStore;
  ctx: LearnerContext;
  runId: string;
  source: RunSource;
  now: Date;
}) => Promise<AudioChunk[]>;
export interface PdfPageImage {
  page: number;
  objectId: string;
  mimeType: "image/png" | "image/jpeg";
}
export type PdfPagePreparer = (input: {
  db: Database;
  store: ObjectStore;
  ctx: LearnerContext;
  runId: string;
  source: RunSource;
  page: number;
  now: Date;
}) => Promise<PdfPageImage>;
/** Bound speculative page rendering without increasing paid provider calls per invocation. */
export const PDF_PAGE_PREPARATION_BATCH_SIZE = 3;
/**
 * Audio chunks transcribed at once. Each keeps its own attempt, cost hold and idempotency key;
 * the bound keeps one class from sending its whole recording to the provider in one burst.
 */
export const TRANSCRIPTION_CONCURRENCY = 4;
/** After this long a job starts no further chunk; the rest continue in the next job. */
export const TRANSCRIPTION_LAUNCH_WINDOW_MS = 120_000;
/** Photos or scanned pages read at once by one job (diagnosis 2026-10-12, 0.5). */
export const VISION_CONCURRENCY = 4;
/** Time kept after the last provider call a job starts, before its runner's deadline. */
export const PROVIDER_CALL_SAFETY_MS = 15_000;
/** A class's acoustic check starts only with this much time left (twice a 128-minute class's). */
export const VOICE_ANALYSIS_TIME_MS = 360_000;
/** A job that cannot fit its next step leaves it to a fresh runner after this delay. */
export const YIELD_DELAY_SECONDS = 30;

export function hasTime(job: JobContext, ms: number): boolean {
  return !job.deadline || job.deadline.getTime() - job.now().getTime() >= ms;
}

/** Whether one request on this model's own deadline can still finish before the runner's. */
export function callFits(job: JobContext, provider: AiProvider, model: string): boolean {
  return hasTime(
    job,
    effectiveProviderTimeoutMs(provider.settings, model) + PROVIDER_CALL_SAFETY_MS,
  );
}

/**
 * Which of several lanes' failures a job reports: cancellation first, then an unknown provider
 * outcome, then a definite failure, and a retryable one last, so a retry never hides the others.
 */
export function failureRank(error: unknown): number {
  if (error instanceof JobCancelled) return 3;
  if (error instanceof ProviderError) return error.uncertain ? 2 : error.retryable ? 0 : 1;
  return 1;
}

export type PdfPagesPreparer = (
  input: Omit<Parameters<PdfPagePreparer>[0], "page"> & {
    pages: number[];
  },
) => Promise<PdfPageImage[]>;
export interface ProcessingDependencies {
  provider?: AiProvider;
  store: ObjectStore;
  prepareAudio?: AudioPreparer;
  preparePdfPage?: PdfPagePreparer;
  /** May return a prepared prefix when a later page cannot be rendered. */
  preparePdfPages?: PdfPagesPreparer;
  prepareImage?: (input: { bytes: Uint8Array; mimeType: string }) => Promise<{
    bytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }>;
  onTranscribed?: (db: Database, ctx: LearnerContext, sourceId: string, now: Date) => Promise<void>;
  diarizeVoice?: VoiceDiarizer;
  /** Defaults to TRANSCRIPTION_CONCURRENCY. */
  transcriptionConcurrency?: number;
  /** Defaults to VISION_CONCURRENCY. */
  visionConcurrency?: number;
}
export const pdfTextSchema = sourceContentSchema.pick({ units: true, blocks: true });
export const pdfPageImageSchema = z.strictObject({
  page: z.number().int().positive(),
  objectId: z.uuid(),
  mimeType: z.enum(["image/png", "image/jpeg"]),
});

export async function liveRun(tx: Tx, ctx: LearnerContext, id: string) {
  await lockAccount(tx, ctx.userId);
  const run = await ownedRun(tx, ctx, id, true);
  if (!["queued", "processing"].includes(run.state)) throw new JobCancelled();
  await assertSessionOwner(tx, ctx, run.session_id);
  return run;
}
const undispatchedProviderErrors = new Set([
  "provider_request_too_large",
  "provider_input_too_large",
  "provider_bounded_images_unsupported",
  "provider_url_invalid",
  "provider_request_schema_too_complex",
]);
const knowledgeGenerationSteps = [
  "knowledge",
  "knowledge:compact",
  "knowledge:repair",
  "knowledge:study-repair",
  "knowledge:repair-language",
];
export async function cached<T>(
  db: Database | Tx,
  runId: string,
  step: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const row = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", runId)
    .where("step", "=", step)
    .executeTakeFirst();
  return row ? schema.parse(row.output) : null;
}
export async function saveStep(tx: Tx, runId: string, step: string, output: unknown, now: Date) {
  await tx
    .insertInto("proc.run_step")
    .values({ run_id: runId, step, output: JSON.stringify(output), completed_at: now })
    .onConflict((oc) => oc.columns(["run_id", "step"]).doNothing())
    .execute();
}
/** One read for many checkpoints, e.g. every transcribed chunk of a long class. */
export async function completedSteps(
  db: Database,
  runId: string,
  steps: readonly string[],
): Promise<Set<string>> {
  if (!steps.length) return new Set();
  const rows = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", runId)
    .where("step", "in", [...steps])
    .execute();
  return new Set(rows.map((row) => row.step));
}

/** QUA-01: one paid provider call of a run step, as providerStep's helpers share it. */
interface ProviderCall<T> {
  job: JobContext;
  ctx: LearnerContext;
  runId: string;
  step: string;
  model: string;
  provider: AiProvider;
  schema: z.ZodType<T>;
  maximumMicros: number;
}
type ProviderAttempt = Selectable<DB["proc.provider_attempt"]>;
/** Which estimate rates price a step's usage when the provider reports no cost. */
function usageKind(step: string) {
  return step.startsWith("stt:")
    ? "transcription"
    : step.startsWith("vision:")
      ? "vision"
      : step === "speech"
        ? "tts"
        : "generation";
}
/**
 * The estimated cost of usage without an actual one, at the rates the attempt started with.
 * P5-02 (P4-04 nit): an estimate above the step's hold (`maximumMicros`) is recorded as it is,
 * never clamped, so the recorded cost is not understated; it is only logged, with numbers and
 * identifiers, never user text: `measured` is the estimate and `hold_micros` the hold, both in
 * micros (P6-03).
 */
function estimatedAttemptCost<T>(
  call: ProviderCall<T>,
  attempt: ProviderAttempt,
  model: string,
  usage: ProviderResult<unknown>["usage"],
) {
  const { job, step, maximumMicros } = call;
  const estimate =
    (attempt.estimate_rates
      ? estimatedUsageCost(
          estimateRatesSchema.parse(attempt.estimate_rates),
          model,
          usage,
          usageKind(step),
        )
      : null) ?? maximumMicros;
  if (estimate > maximumMicros)
    job.log?.("warn", "provider_estimate_above_hold", {
      module: "proc",
      job_id: job.job.id,
      attempt: job.job.attempt,
      kind: usageKind(step),
      measured: estimate,
      hold_micros: maximumMicros,
    });
  return estimate;
}
/** The step's latest attempt, read under the account lock of the dispatch transaction. */
async function latestAttempt<T>(tx: Tx, call: ProviderCall<T>) {
  return tx
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", call.runId)
    .where("step", "=", call.step)
    .orderBy("attempt", "desc")
    .executeTakeFirst();
}
/**
 * P9-05 (C9-1, C9-2, C8-3; E215-R): the hold of an attempt whose provider outcome is unknown,
 * left started by a stopped job or answered with an uncertain result, closes at the hold's own
 * maximum, the conservative cost, once (a hold already closed is left as it is). The attempt
 * itself is not touched here: it stays started or uncertain, so every retry guard still reads it
 * as an unknown outcome awaiting operator review. Nothing here calls the provider again or
 * schedules a retry.
 */
async function closeHoldAtMaximum<T>(tx: Tx, call: ProviderCall<T>, attempt: ProviderAttempt) {
  const { job, ctx, runId, provider } = call;
  await finishProviderStep(
    tx,
    ctx,
    attempt.hold_id,
    {
      operationKey: attempt.operation_key,
      provider: attempt.provider,
      model: attempt.model,
      currency: provider.settings.currency,
      actualMicros: null,
      estimatedMicros: "hold_maximum",
      priceVersion: attempt.estimate_price_version ?? provider.settings.priceVersion,
      usage: {},
      runId,
      attemptId: attempt.id,
    },
    job.now(),
  );
}
/**
 * QUA-01: the guards that share the account lock and the transaction that inserts the next
 * attempt, for a step whose latest attempt (`previous`) is resolved.
 */
async function assertAttemptAllowed<T>(
  tx: Tx,
  call: ProviderCall<T>,
  previous: ProviderAttempt | undefined,
  singleResponse: boolean | undefined,
) {
  const { runId, step, model, provider } = call;
  if (singleResponse && previous) {
    const attempts = await tx
      .selectFrom("proc.provider_attempt")
      .select(["state", "error_code"])
      .where("run_id", "=", runId)
      .where("step", "=", step)
      .execute();
    // This guard shares the account lock and transaction that inserts the next attempt.
    // A reclaimed worker cannot pass a preflight then rebill after another worker records
    // its paid invalid response. Definite HTTP refusals alone can be attempted again.
    const response = attempts.find(
      (entry) =>
        entry.state !== "failed" || !/^provider_http_[45]\d\d$/.test(entry.error_code ?? ""),
    );
    if (response)
      throw new ProviderError(
        response.error_code ?? "provider_response_already_recorded",
        false,
        false,
      );
  }
  // Content-contract lessons have at most two generation dispatches per run, whichever steps
  // used them. This also covers a retried job after a paid response whose commit failed.
  if (
    usesContentKnowledgeContract(provider.settings, model) &&
    knowledgeGenerationSteps.includes(step)
  ) {
    const attempts = await tx
      .selectFrom("proc.provider_attempt")
      .select(["state", "error_code"])
      .where("run_id", "=", runId)
      .where("step", "in", knowledgeGenerationSteps)
      .execute();
    // A known HTTP 4xx or local request refusal never generated a lesson; all else counts.
    const generations = attempts.filter(
      (entry) =>
        entry.state !== "failed" ||
        !(
          /^provider_http_4\d\d$/.test(entry.error_code ?? "") ||
          undispatchedProviderErrors.has(entry.error_code ?? "")
        ),
    );
    if (generations.length >= 2)
      throw errors.validationFailed({ output: ["knowledge_repair_exhausted"] });
  }
  // Each bounded correction has one paid dispatch, including known failed responses.
  if (
    [
      "knowledge:repair",
      "knowledge:repair-language",
      "knowledge:study-repair",
      "knowledge:compact",
    ].includes(step) &&
    previous
  )
    throw errors.validationFailed({ output: ["knowledge_repair_exhausted"] });
}
/**
 * QUA-01: the dispatch transaction. A concurrent single response is reused; an unresolved latest
 * attempt keeps its state, has its hold closed at its maximum cost and is reported, never
 * dispatched again (P9-05); otherwise the next attempt and its maximum cost hold are committed
 * before any dispatch.
 */
async function beginProviderAttempt<T>(
  call: ProviderCall<T>,
  estimateSchedule: Awaited<ReturnType<typeof readEstimateRates>>,
  singleResponse: boolean | undefined,
): Promise<{ cachedOutput: T } | { unresolved: ProviderError } | ProviderAttempt> {
  const { job, ctx, runId, step, model, provider, schema, maximumMicros } = call;
  return job.db.transaction().execute(async (tx) => {
    const run = await liveRun(tx, ctx, runId);
    if (singleResponse) {
      // A concurrent worker may have committed its valid response after our optimistic read.
      // Reuse it under the dispatch lock, before deciding whether another response is allowed.
      const checkpoint = await cached(tx, runId, step, schema);
      if (checkpoint !== null) return { cachedOutput: checkpoint };
    }
    const previous = await latestAttempt(tx, call);
    if (previous && ["started", "uncertain"].includes(previous.state)) {
      // Committed with this transaction, so the hold closes even though the step then fails;
      // the attempt stays started or uncertain for the retry guards (E215-R).
      await closeHoldAtMaximum(tx, call, previous);
      return { unresolved: new ProviderError("provider_outcome_unresolved", false, true) };
    }
    await assertAttemptAllowed(tx, call, previous, singleResponse);
    const number = (previous?.attempt ?? 0) + 1;
    const operationKey = `${runId}:${step}:${number}`;
    const hold = await beginProviderStep(
      tx,
      ctx,
      {
        sessionId: run.session_id,
        reservationId: run.reservation_id,
        operationKey,
        maximumMicros,
        currency: provider.settings.currency,
      },
      job.now(),
    );
    return tx
      .insertInto("proc.provider_attempt")
      .values({
        run_id: runId,
        user_id: ctx.userId,
        step,
        attempt: number,
        operation_key: operationKey,
        hold_id: hold.id,
        provider: provider.name,
        model,
        estimate_rates: estimateSchedule ? JSON.stringify(estimateSchedule.rates) : null,
        estimate_price_version: estimateSchedule?.version ?? null,
        started_at: job.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
/**
 * QUA-01: settles a valid response and saves its checkpoint in one commit. The accounting
 * persists even when the run ended or its class was deleted during dispatch; the job then ends.
 */
async function commitProviderOutput<T>(
  call: ProviderCall<T>,
  attempt: ProviderAttempt,
  result: ProviderResult<T>,
  output: T,
  onCommit: ((tx: Tx, output: T) => Promise<void>) | undefined,
): Promise<T> {
  const { job, ctx, runId, step, provider } = call;
  return job.db
    .transaction()
    .execute(async (tx) => {
      // Provider accounting persists even when cancellation/deletion happened during dispatch.
      await lockAccountForCleanup(tx, ctx.userId);
      await finishProviderStep(
        tx,
        ctx,
        attempt.hold_id,
        {
          operationKey: attempt.operation_key,
          provider: result.provider,
          model: result.model,
          currency: provider.settings.currency,
          actualMicros: result.actualMicros,
          estimatedMicros:
            result.actualMicros === null
              ? estimatedAttemptCost(call, attempt, result.model, result.usage)
              : null,
          priceVersion: attempt.estimate_price_version ?? provider.settings.priceVersion,
          usage: result.usage,
          runId,
          attemptId: attempt.id,
        },
        job.now(),
      );
      await tx
        .updateTable("proc.provider_attempt")
        .set({
          state: "succeeded",
          provider_request_id: result.requestId,
          finished_at: job.now(),
        })
        .where("id", "=", attempt.id)
        .execute();
      const run = await ownedRun(tx, ctx, runId, true);
      if (!["queued", "processing"].includes(run.state)) return null;
      try {
        await assertSessionOwner(tx, ctx, run.session_id);
      } catch (error) {
        if (error instanceof AppError && error.code === "not_found") return null;
        throw error;
      }
      await onCommit?.(tx, output);
      await saveStep(tx, runId, step, output, job.now());
      return output;
    })
    .then((output) => {
      if (output === null) throw new JobCancelled();
      return output;
    });
}
/**
 * QUA-01: records a failed or unknown outcome once. A definite failure is settled at its
 * reported or estimated cost; an unknown one stays uncertain with its hold closed at the hold's
 * maximum (P9-05); a known invalid or truncated lesson keeps a checkpoint for its single recovery.
 */
async function recordProviderFailure<T>(
  call: ProviderCall<T>,
  attempt: ProviderAttempt,
  providerError: ProviderError,
) {
  const { job, ctx, runId, step, model, provider } = call;
  await job.db.transaction().execute(async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const current = await tx
      .selectFrom("proc.provider_attempt")
      .select(["state", "provider_request_id"])
      .where("id", "=", attempt.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (current.state === "succeeded") return;
    if (providerError.uncertain) await closeHoldAtMaximum(tx, call, attempt);
    else
      await finishProviderStep(
        tx,
        ctx,
        attempt.hold_id,
        {
          operationKey: attempt.operation_key,
          provider: providerError.accounting?.provider ?? provider.name,
          model: providerError.accounting?.model ?? model,
          currency: provider.settings.currency,
          actualMicros:
            providerError.accounting?.actualMicros ?? (providerError.accounting ? null : 0),
          estimatedMicros:
            providerError.accounting?.actualMicros === null
              ? estimatedAttemptCost(call, attempt, model, providerError.accounting.usage)
              : null,
          priceVersion: attempt.estimate_price_version ?? provider.settings.priceVersion,
          usage: providerError.accounting?.usage ?? {},
          runId,
          attemptId: attempt.id,
        },
        job.now(),
      );
    await tx
      .updateTable("proc.provider_attempt")
      .set({
        state: providerError.uncertain ? "uncertain" : "failed",
        error_code: providerError.code,
        provider_request_id: providerError.accounting?.requestId ?? current.provider_request_id,
        finished_at: job.now(),
      })
      .where("id", "=", attempt.id)
      .execute();
    if (
      step === "knowledge" &&
      providerError.code === "provider_output_truncated" &&
      !providerError.uncertain &&
      providerError.accounting
    ) {
      await saveStep(
        tx,
        runId,
        "knowledge:truncated",
        knowledgeTruncationSchema.parse({
          reason: "provider_output_truncated",
          attemptId: attempt.id,
        }),
        job.now(),
      );
    }
    if (
      step === "knowledge" &&
      usesContentKnowledgeContract(provider.settings, model) &&
      providerError.code === "provider_schema_invalid" &&
      !providerError.uncertain &&
      providerError.accounting
    ) {
      const detail = knowledgeRepairDetailSchema.safeParse(providerError.diagnostic);
      await saveStep(
        tx,
        runId,
        "knowledge:schema-invalid",
        knowledgeSchemaFailureSchema.parse({
          reason: "provider_schema_invalid",
          attemptId: attempt.id,
          ...(detail.success ? { detail: detail.data } : {}),
        }),
        job.now(),
      );
    }
  });
}
/**
 * The attempt and maximum cost hold are committed before dispatch; an unknown result is not
 * repeated; its attempt stays unresolved and its hold closes at that maximum (P9-05).
 */
export async function providerStep<T>(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  step: string,
  model: string,
  provider: AiProvider,
  schema: z.ZodType<T>,
  effect: (operationKey: string) => Promise<ProviderResult<T>>,
  options: {
    onCommit?: (tx: Tx, output: T) => Promise<void>;
    /** Evaluations accept one response; a paid invalid result must not trigger another call. */
    singleResponse?: boolean;
  } = {},
): Promise<T> {
  const prior = await cached(job.db, runId, step, schema);
  if (prior !== null) return prior;
  const maximumMicros = maximumProviderCost(provider.settings, model);
  const estimateSchedule = await readEstimateRates(job.db);
  const call = { job, ctx, runId, step, model, provider, schema, maximumMicros };
  const attemptOrCheckpoint = await beginProviderAttempt(
    call,
    estimateSchedule,
    options.singleResponse,
  );
  if ("cachedOutput" in attemptOrCheckpoint) return attemptOrCheckpoint.cachedOutput;
  if ("unresolved" in attemptOrCheckpoint) throw attemptOrCheckpoint.unresolved;
  const attempt = attemptOrCheckpoint;
  let completedAccounting: Omit<ProviderResult<T>, "output"> | undefined;
  try {
    const result = await effect(attempt.operation_key);
    const { output: _output, ...accounting } = result;
    completedAccounting = accounting;
    const parsed = schema.safeParse(result.output);
    if (!parsed.success) {
      const { output: _output, ...accounting } = result;
      throw new ProviderError("provider_schema_invalid", false, false, accounting);
    }
    return await commitProviderOutput(call, attempt, result, parsed.data, options.onCommit);
  } catch (error) {
    if (error instanceof JobCancelled) throw error;
    const providerError =
      error instanceof ProviderError
        ? error
        : completedAccounting
          ? new ProviderError("provider_output_commit_failed", false, false, completedAccounting)
          : new ProviderError("provider_outcome_unknown", false, true);
    await recordProviderFailure(call, attempt, providerError);
    // OPS-02: the provider's code and transport cause only, never its output (PRD-PRIV-06).
    job.log?.("warn", "provider_step_failed", {
      module: "proc",
      job_id: job.job.id,
      attempt: job.job.attempt,
      code: providerError.code,
      cause_code: providerError.causeCode,
      state: providerError.uncertain ? "uncertain" : "failed",
    });
    throw providerError;
  }
}
/**
 * Transcribes chunks a few at a time and returns how many it started. Every chunk is its own
 * paid provider step, committed before its bytes are deleted, so a retry repeats only unfinished
 * chunks. A chunk, the first included, starts only while its call can still end before the
 * runner's deadline. After a failure no new chunk starts, the calls in flight settle, and the
 * most significant failure is thrown (failureRank).
 */
export async function transcribeChunks(
  job: JobContext,
  input: {
    ctx: LearnerContext;
    runId: string;
    chunks: readonly AudioChunk[];
    provider: AiProvider;
    model: string;
    store: ObjectStore;
    concurrency: number;
  },
): Promise<number> {
  const { ctx, runId, provider, model, store } = input;
  const launchUntil = Math.min(
    job.now().getTime() + TRANSCRIPTION_LAUNCH_WINDOW_MS,
    (job.deadline?.getTime() ?? Number.POSITIVE_INFINITY) -
      effectiveProviderTimeoutMs(provider.settings, model) -
      PROVIDER_CALL_SAFETY_MS,
  );
  const queue = [...input.chunks];
  let launched = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure) {
      if (job.now().getTime() >= launchUntil) return;
      const chunk = queue.shift();
      if (!chunk) return;
      launched += 1;
      try {
        const bytes = await readOwnedObject(job.db, store, ctx, chunk.objectId);
        await providerStep(
          job,
          ctx,
          runId,
          `stt:${chunk.id}`,
          model,
          provider,
          transcriptSchema,
          (operationKey) =>
            provider.transcribe({
              operationKey,
              model,
              audio: { bytes, format: chunk.format },
              durationMs: chunk.durationMs,
              offsetMs: chunk.offsetMs,
            }),
        );
        await deleteObject(job.db, store, ctx, chunk.objectId, job.now());
      } catch (error) {
        // Another lane may have failed while this one awaited.
        const earlier = failure as { error: unknown } | null;
        if (!earlier || failureRank(error) > failureRank(earlier.error)) failure = { error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(input.concurrency), input.chunks.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failure) throw (failure as { error: unknown }).error;
  return launched;
}
export async function checkpointAndContinue(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  definition: JobDefinition<{ runId: string; userId: string }>,
  delaySeconds = 0,
) {
  await job.db.transaction().execute(async (tx) => {
    await liveRun(tx, ctx, runId);
    const id = await enqueueJob(tx, definition, {
      payload: { runId, userId: ctx.userId },
      singletonKey: `${runId}:${job.job.id}`,
      now: job.now(),
      ...(delaySeconds ? { runAt: new Date(job.now().getTime() + delaySeconds * 1000) } : {}),
      defaults: readPltSettings().jobs,
    });
    await tx
      .updateTable("proc.processing_run")
      .set({ state: "processing", job_id: id, updated_at: job.now() })
      .where("id", "=", runId)
      .execute();
  });
}
export function withinSelection(source: RunSource): RunSource {
  if (!source.ranges.length) return source;
  const units = source.units.filter((unit) =>
    source.ranges.some((range) =>
      unit.kind === "page"
        ? unit.start >= range.start && unit.start <= range.end
        : unit.kind === "time"
          ? unit.start >= range.start && (unit.end ?? unit.start) <= range.end
          : true,
    ),
  );
  const blocks = source.blocks.filter((block) => units.some((unit) => unit.id === block.unitId));
  return { ...source, units, blocks };
}
export async function storeExtraction(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  source: RunSource,
  content: Pick<z.infer<typeof sourceContentSchema>, "units" | "blocks">,
  settings: Record<string, unknown>,
): Promise<RunSource> {
  return job.db.transaction().execute(async (tx) => {
    await liveRun(tx, ctx, runId);
    const contentVersionId = await appendContentVersion(
      tx,
      ctx,
      source.sourceId,
      {
        ...content,
        schemaVersion: "1",
        provenance: "machine_extraction",
        originKey: `processing:${runId}:${source.sourceId}`,
        settings: { ...settings, ranges: source.ranges },
      },
      job.now(),
    );
    const updated = {
      ...source,
      role: automaticSourceRole(source.kind, settings.sourceClassification),
      contentVersionId,
      ...content,
    };
    await saveStep(tx, runId, `source:${source.sourceId}`, updated, job.now());
    return updated;
  });
}
