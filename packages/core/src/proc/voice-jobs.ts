import { z } from "zod";
import { getAccountState, lockAccount, lockAccountForCleanup } from "../acc";
import { type AiProvider, ProviderError, providerSettingsSchema, requireProvider } from "../aip";
import type { Database, Tx } from "../db";
import { getLatestVersion, isExplanationLanguage } from "../lkm";
import { assertSessionOwner } from "../org";
import {
  AppError,
  canonicalJson,
  enqueueJob,
  errors,
  type JobContext,
  type JobDefinition,
  type LearnerContext,
  readPltSettings,
  sha256Hex,
} from "../plt";
import { amounts, amountsSchema, emptyAmounts } from "../quota";
import { liveTemporaryAudioObject, TEMPORARY_AUDIO_SWEEP_SECONDS } from "../src";
import { getVoiceEnrollment, readVoiceSettings, type VoiceAnalysisBlockedReason } from "../voc";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  scheduleAuxiliaryRun,
} from "./auxiliary";
import { sourceSnapshotSchema } from "./contracts";
import { ownedRun, selectProcessingSourceSnapshot } from "./runs";
import { assertWriteAuthority, isJobLeaseLost } from "./steps/runtime";
import {
  analyzeVoiceSources,
  correctVoiceCandidates,
  hasTranscriptVoiceEvidence,
  processVoiceSource,
  type VoiceDiarizer,
  voiceDiarizationOptions,
} from "./voice-processing";

const payloadSchema = z.strictObject({ runId: z.uuid(), userId: z.uuid(), subjectId: z.uuid() });
const settingsSchema = z.strictObject({
  provider: providerSettingsSchema,
  profileVersion: z.int().nonnegative(),
  explanationLanguage: z.string().min(2).max(35).refine(isExplanationLanguage).default("fa"),
});
const snapshotSchema = z.strictObject({ subjectId: z.uuid(), request: sourceSnapshotSchema });
export interface VoiceJobDependencies {
  provider?: AiProvider;
  diarize: VoiceDiarizer;
}

async function voiceReanalysisInput(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  originalLiveAt = new Date(),
) {
  const enrollment = await getVoiceEnrollment(db, ctx);
  if (!enrollment.enabled) throw errors.validationFailed({ voice: ["consent_required"] });
  const snapshot = sourceSnapshotSchema.parse(
    await selectProcessingSourceSnapshot(db, ctx, sessionId),
  );
  if (!snapshot.sources.some((source) => source.kind === "audio" && source.contentVersionId))
    throw errors.validationFailed({ voice: ["transcript_required"] });
  const availability = await Promise.all(
    snapshot.sources
      .filter((source) => source.kind === "audio" && source.contentVersionId)
      .map(
        async (source) =>
          hasTranscriptVoiceEvidence(source) ||
          (source.objectId
            ? await liveTemporaryAudioObject(
                db,
                ctx,
                source.sourceId,
                source.objectId,
                originalLiveAt,
              )
            : false),
      ),
  );
  if (!availability.some(Boolean))
    throw errors.validationFailed({ voice: ["original_audio_required"] });
  const knowledge = await getLatestVersion(db, ctx, sessionId);
  const account = knowledge ? null : await getAccountState(db, ctx.userId);
  const explanationLanguage =
    knowledge?.model.language.explanation ??
    (account?.profile.explanationLanguage === "english" ? "en" : account?.profile.firstLanguage);
  if (!explanationLanguage)
    throw errors.validationFailed({ voice: ["explanation_language_missing"] });
  return { enrollment, snapshot, explanationLanguage };
}

/**
 * A read-only preflight shares the queue's source selection and cache validity checks. It offers
 * a check only while the original outlasts the next deletion sweep, so a check started now still
 * reads it: never one on audio about to be deleted (D29).
 */
export async function voiceAnalysisBlockedReason(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<VoiceAnalysisBlockedReason | null> {
  await assertSessionOwner(db, ctx, sessionId);
  try {
    await voiceReanalysisInput(
      db,
      ctx,
      sessionId,
      new Date(now.getTime() + TEMPORARY_AUDIO_SWEEP_SECONDS * 1000),
    );
    return null;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "validation_failed") throw error;
    const fields = z.record(z.string(), z.array(z.string())).safeParse(error.details?.fields);
    if (!fields.success) throw error;
    for (const reason of [
      "consent_required",
      "transcript_required",
      "original_audio_required",
      "explanation_language_missing",
    ] as const)
      if (fields.data.voice?.includes(reason)) return reason;
    if (
      fields.data.sources?.some((reason) =>
        ["select_at_least_one", "not_verified"].includes(reason),
      )
    )
      return "sources_unavailable";
    throw error;
  }
}

/** Explicit retry/enabling on an existing class uses the standard reservation and cost ledger. */
export async function scheduleVoiceReanalysis(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  dependencies: VoiceJobDependencies,
  options: { now?: Date; operationKey?: string } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const requestKey = z
    .string()
    .min(8)
    .max(200)
    .parse(options.operationKey ?? ctx.requestId);
  const operationKey = `voice:${sessionId}:${sha256Hex(requestKey)}`;
  const provider = requireProvider(dependencies.provider);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const { enrollment, snapshot, explanationLanguage } = await voiceReanalysisInput(
      tx,
      ctx,
      sessionId,
    );
    const active = await tx
      .selectFrom("proc.processing_run")
      .select(["id", "kind", "settings", "input_snapshot", "operation_key"])
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", sessionId)
      .where("state", "in", ["queued", "processing", "awaiting_upload"])
      .executeTakeFirst();
    if (active?.kind === "auxiliary") {
      const priorSettings = settingsSchema.safeParse(active.settings);
      const priorSnapshot = snapshotSchema.safeParse(active.input_snapshot);
      if (
        priorSettings.success &&
        priorSnapshot.success &&
        active.operation_key === operationKey &&
        priorSettings.data.profileVersion === enrollment.version &&
        priorSettings.data.explanationLanguage === explanationLanguage &&
        canonicalJson(priorSettings.data.provider) === canonicalJson(provider.settings) &&
        priorSnapshot.data.subjectId === sessionId &&
        canonicalJson(priorSnapshot.data.request) === canonicalJson(snapshot)
      )
        return active.id;
    }
    return scheduleAuxiliaryRun(
      tx,
      ctx,
      {
        sessionId,
        operationKey,
        subjectId: sessionId,
        requested: amounts({ regeneration: 1 }),
        request: snapshot,
        settings: {
          provider: provider.settings,
          profileVersion: enrollment.version,
          explanationLanguage,
        },
        job: voiceAnalysisJob(dependencies),
      },
      now,
    );
  });
}

export async function voiceProcessingStatus(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<boolean> {
  await assertSessionOwner(db, ctx, sessionId);
  const rows = await db
    .selectFrom("proc.processing_run")
    .select(["kind", "settings", "input_snapshot"])
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("state", "in", ["queued", "processing"])
    .execute();
  return rows.some(
    (row) =>
      row.kind === "auxiliary" &&
      settingsSchema.safeParse(row.settings).success &&
      snapshotSchema.safeParse(row.input_snapshot).success,
  );
}

/**
 * C11-77 (P12-06; owner answers to E553 and E559): an auxiliary job writes its run's pointer
 * (proc.processing_run.job_id), ends the run or fails it only while it owns the run: its claim is
 * valid (ADR-0004 rule 4) and the pointer names it, both checked in the transaction that writes,
 * with the job row locked first, then the account, then the run (as liveRun in steps/runtime.ts).
 * A job that does not own the run stands aside: it writes nothing and leaves one log line. With a
 * valid claim it then ends as a success with nothing done; without one it throws `JobLeaseLost`, so
 * the runner leaves its job as it is. The guard of a new provider attempt is P12-01's (runtime.ts).
 */
type AuxiliaryPayload = { runId: string; userId: string; subjectId: string };
type StandAsideCode = "continuation_exists" | "pointer_moved" | "not_owner" | "job_lease_lost";

/** Thrown inside a transaction so that everything it wrote rolls back; never leaves this file. */
class StandAside extends Error {
  constructor(readonly code: StandAsideCode) {
    super(code);
    this.name = "StandAside";
  }
}

/** The one distinguishable log line of a stand-aside: identifiers and codes only (FR-PLT-007). */
function logStandAside(
  job: JobContext,
  kind: string,
  code: StandAsideCode,
  step: "continue" | "complete" | "fail",
) {
  job.log?.("warn", "auxiliary_run_not_owner", {
    module: "proc",
    kind,
    job_id: job.job.id,
    attempt: job.job.attempt,
    code,
    reason: step,
  });
}

/**
 * The run, locked after the job's authority and the account (ADR-0004 rule 4). A job without a
 * valid claim gets `JobLeaseLost` here and the transaction rolls back.
 */
async function lockedRun(
  tx: Tx,
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  lock: (tx: Tx, userId: string) => Promise<unknown> = lockAccount,
) {
  await assertWriteAuthority(tx, job);
  await lock(tx, ctx.userId);
  return ownedRun(tx, ctx, runId, true);
}

/**
 * Whether the job owns the run: the run's pointer names it. Read only after lockedRun, where a
 * context without a lease can only be PLT's hand-made test-only one (P11-02 AC-14), which keeps
 * the earlier behaviour of ending and failing the run. The pointer move itself has no such
 * exception (continueAuxiliaryJob).
 */
function ownsRun(job: JobContext, run: { job_id: string | null }): boolean {
  return job.lease === undefined || run.job_id === job.job.id;
}

/**
 * Each saved step continues in a fresh job, so no job holds both a check and a paid call. In one
 * transaction, after the authority check: the `dependent` checkpoint, the next job and the pointer
 * moved from this job to that one, and only from this job (a conditional write). If the next job
 * already exists (this job continued before and was claimed again) or the pointer no longer names
 * this job, all of it rolls back: no checkpoint, no next job, the pointer as it was. Returns
 * whether the run was handed on; false also when the run has ended.
 */
export async function continueAuxiliaryJob<P extends AuxiliaryPayload>(
  job: JobContext,
  ctx: LearnerContext,
  definition: JobDefinition<P>,
  payload: P,
  dependent?: (tx: Tx) => Promise<void>,
): Promise<boolean> {
  try {
    return await job.db.transaction().execute(async (tx) => {
      const run = await lockedRun(tx, job, ctx, payload.runId);
      if (!["queued", "processing"].includes(run.state)) return false;
      await dependent?.(tx);
      const next = await enqueueJob(tx, definition, {
        payload,
        singletonKey: `${run.id}:${job.job.id}`,
        now: job.now(),
        defaults: readPltSettings().jobs,
      });
      if (next === null) throw new StandAside("continuation_exists");
      const moved = await tx
        .updateTable("proc.processing_run")
        .set({ job_id: next, state: "processing", updated_at: job.now() })
        .where("id", "=", run.id)
        .where("job_id", "=", job.job.id)
        .where("state", "in", ["queued", "processing"])
        .executeTakeFirst();
      if (Number(moved.numUpdatedRows) !== 1) throw new StandAside("pointer_moved");
      return true;
    });
  } catch (error) {
    if (!(error instanceof StandAside)) throw error;
    logStandAside(job, definition.kind, error.code, "continue");
    return false;
  }
}

/**
 * Ends the run with `complete` in the caller's place, only as its owner. Returns false, having
 * written nothing, when the job does not own the run.
 */
export async function completeOwnedAuxiliaryRun(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  kind: string,
  complete: (tx: Tx) => Promise<void>,
): Promise<boolean> {
  const owner = await job.db.transaction().execute(async (tx) => {
    if (!ownsRun(job, await lockedRun(tx, job, ctx, runId))) return false;
    await complete(tx);
    return true;
  });
  if (!owner) logStandAside(job, kind, "not_owner", "complete");
  return owner;
}

/**
 * F-7 (P12-06 AC-5): the error path of an auxiliary job. A job without a valid claim (its error
 * is `JobLeaseLost`, or the check here refuses it) and a job that does not own the run fail
 * nothing, settle nothing and leave the run's pointer and its other jobs alone. The owner keeps the
 * existing contract: a retryable provider error with attempts left is thrown again for the
 * runner's retry, any other error fails the run and releases its whole hold (failAuxiliaryRun).
 */
export async function failOwnedAuxiliaryRun(
  job: JobContext,
  ctx: LearnerContext,
  runId: string,
  kind: string,
  error: unknown,
  fallbackCode: string,
): Promise<void> {
  const retry =
    error instanceof ProviderError &&
    error.retryable &&
    job.job.attempt < readPltSettings().jobs.maxAttempts;
  let outcome: "failed" | "retry" | "not_owner";
  try {
    if (isJobLeaseLost(error)) throw error;
    outcome = await job.db.transaction().execute(async (tx) => {
      if (!ownsRun(job, await lockedRun(tx, job, ctx, runId, lockAccountForCleanup)))
        return "not_owner";
      if (retry) return "retry";
      await failAuxiliaryRun(
        tx,
        ctx,
        runId,
        {
          code:
            error instanceof ProviderError
              ? error.code
              : error instanceof AppError
                ? error.code
                : fallbackCode,
          uncertain: error instanceof ProviderError && error.uncertain,
        },
        job.now(),
      );
      return "failed";
    });
  } catch (failure) {
    if (isJobLeaseLost(failure)) logStandAside(job, kind, "job_lease_lost", "fail");
    throw failure;
  }
  if (outcome === "not_owner") logStandAside(job, kind, "not_owner", "fail");
  if (outcome === "retry") throw error;
}

export function voiceAnalysisJob(
  dependencies: VoiceJobDependencies,
): JobDefinition<z.infer<typeof payloadSchema>> {
  const definition: JobDefinition<z.infer<typeof payloadSchema>> = {
    kind: "proc.voice_analysis",
    version: 1,
    payload: payloadSchema,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      try {
        const run = await ownedRun(job.db, ctx, payload.runId);
        if (!["queued", "processing"].includes(run.state)) return;
        if (run.session_id !== payload.subjectId) throw errors.notFound();
        const provider = requireProvider(dependencies.provider);
        const settings = settingsSchema.parse(run.settings);
        // Pre-upgrade jobs never snapshotted language: retry rather than bill Persian output.
        if (!Object.hasOwn(run.settings as object, "explanationLanguage"))
          throw errors.validationFailed({ voice: ["explanation_language_snapshot_missing"] });
        if (canonicalJson(settings.provider) !== canonicalJson(provider.settings))
          throw errors.validationFailed({ voice: ["provider_settings_changed"] });
        const enrollment = await getVoiceEnrollment(job.db, ctx);
        if (!enrollment.enabled || enrollment.version !== settings.profileVersion)
          throw errors.validationFailed({ voice: ["consent_changed"] });
        const snapshot = snapshotSchema.parse(run.input_snapshot).request;
        const voiceSettings = readVoiceSettings();
        // A background check: its parts are diarized together, and it may cover more audio.
        const options = voiceDiarizationOptions(voiceSettings, true);
        // P12-01 (AC-35): each voice write of both calls only as the run's owner, checked when it
        // is made; a refused one ends here through failOwnedAuxiliaryRun's stand-aside.
        const analyzed = await analyzeVoiceSources({
          db: job.db,
          ctx,
          job,
          sessionId: run.session_id,
          runId: run.id,
          sources: snapshot.sources,
          diarize: dependencies.diarize,
          ...(options ? { options } : {}),
          explanationLanguage: settings.explanationLanguage,
          concurrency: voiceSettings.diarizationConcurrency,
          canStart: () => true,
          now: job.now,
        });
        for (const source of analyzed ? [] : snapshot.sources) {
          const progress = await processVoiceSource({
            db: job.db,
            ctx,
            job,
            runId: run.id,
            sessionId: run.session_id,
            source,
            diarize: dependencies.diarize,
            ...(options ? { options } : {}),
            explanationLanguage: settings.explanationLanguage,
            now: job.now,
            correct: (analysis) =>
              correctVoiceCandidates({
                db: job.db,
                ctx,
                analysis,
                provider,
                explanationLanguage: settings.explanationLanguage,
                referenceTexts: snapshot.sources
                  .filter((item) => item.kind !== "audio" && item.role !== "user_notes")
                  .flatMap((item) => item.blocks.map((block) => block.text)),
                now: job.now,
                execute: (request) =>
                  executeAuxiliaryProviderStep(job, ctx, run.id, { ...request, provider }),
              }),
          });
          if (progress !== "unchanged") {
            await continueAuxiliaryJob(job, ctx, definition, payload);
            return;
          }
        }
        if (analyzed) {
          await continueAuxiliaryJob(job, ctx, definition, payload);
          return;
        }
        const charged = await job.db
          .selectFrom("proc.provider_attempt")
          .select("id")
          .where("run_id", "=", run.id)
          .where("state", "=", "succeeded")
          .executeTakeFirst();
        await completeOwnedAuxiliaryRun(job, ctx, run.id, definition.kind, (tx) =>
          completeAuxiliaryRun(
            tx,
            ctx,
            run.id,
            charged ? amountsSchema.parse(run.requested_amounts) : emptyAmounts(),
            job.now(),
          ),
        );
      } catch (error) {
        await failOwnedAuxiliaryRun(
          job,
          ctx,
          payload.runId,
          definition.kind,
          error,
          "voice_processing_failed",
        );
      }
    },
  };
  return definition;
}
