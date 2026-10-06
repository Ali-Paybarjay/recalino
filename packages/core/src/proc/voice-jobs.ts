import { z } from "zod";
import { lockAccount } from "../acc";
import { type AiProvider, ProviderError, providerSettingsSchema, requireProvider } from "../aip";
import type { Database } from "../db";
import { assertSessionOwner } from "../org";
import {
  AppError,
  canonicalJson,
  enqueueJob,
  errors,
  type JobDefinition,
  type LearnerContext,
  readPltSettings,
  sha256Hex,
} from "../plt";
import { amounts, amountsSchema, emptyAmounts } from "../quota";
import { getVoiceEnrollment } from "../voc";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  scheduleAuxiliaryRun,
} from "./auxiliary";
import { sourceSnapshotSchema } from "./contracts";
import { ownedRun, selectProcessingSourceSnapshot } from "./runs";
import { correctVoiceCandidates, processVoiceSource, type VoiceDiarizer } from "./voice-processing";

const payloadSchema = z.strictObject({ runId: z.uuid(), userId: z.uuid(), subjectId: z.uuid() });
const settingsSchema = z.strictObject({
  provider: providerSettingsSchema,
  profileVersion: z.int().nonnegative(),
});
const snapshotSchema = z.strictObject({ subjectId: z.uuid(), request: sourceSnapshotSchema });
export interface VoiceJobDependencies {
  provider?: AiProvider;
  diarize: VoiceDiarizer;
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
  const enrollment = await getVoiceEnrollment(db, ctx);
  if (!enrollment.enabled) throw errors.validationFailed({ voice: ["consent_required"] });
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const snapshot = sourceSnapshotSchema.parse(
      await selectProcessingSourceSnapshot(tx, ctx, sessionId),
    );
    if (!snapshot.sources.some((source) => source.kind === "audio" && source.contentVersionId))
      throw errors.validationFailed({ voice: ["transcript_required"] });
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
        settings: { provider: provider.settings, profileVersion: enrollment.version },
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
        if (canonicalJson(settings.provider) !== canonicalJson(provider.settings))
          throw errors.validationFailed({ voice: ["provider_settings_changed"] });
        const enrollment = await getVoiceEnrollment(job.db, ctx);
        if (!enrollment.enabled || enrollment.version !== settings.profileVersion)
          throw errors.validationFailed({ voice: ["consent_changed"] });
        const snapshot = snapshotSchema.parse(run.input_snapshot).request;
        for (const source of snapshot.sources) {
          const progress = await processVoiceSource({
            db: job.db,
            ctx,
            runId: run.id,
            sessionId: run.session_id,
            source,
            diarize: dependencies.diarize,
            now: job.now,
            correct: (analysis) =>
              correctVoiceCandidates({
                db: job.db,
                ctx,
                analysis,
                provider,
                referenceTexts: snapshot.sources
                  .filter((item) => item.kind !== "audio" && item.role !== "user_notes")
                  .flatMap((item) => item.blocks.map((block) => block.text)),
                now: job.now,
                execute: (request) =>
                  executeAuxiliaryProviderStep(job, ctx, run.id, {
                    ...request,
                    provider,
                    model: provider.settings.llmModel,
                  }),
              }),
          });
          if (progress !== "unchanged") {
            await job.db.transaction().execute(async (tx) => {
              const current = await ownedRun(tx, ctx, run.id, true);
              if (!["queued", "processing"].includes(current.state)) return;
              const jobId = await enqueueJob(tx, definition, {
                payload,
                singletonKey: `${run.id}:${job.job.id}`,
                now: job.now(),
                defaults: readPltSettings().jobs,
              });
              await tx
                .updateTable("proc.processing_run")
                .set({ job_id: jobId, state: "processing", updated_at: job.now() })
                .where("id", "=", run.id)
                .execute();
            });
            return;
          }
        }
        const charged = await job.db
          .selectFrom("proc.provider_attempt")
          .select("id")
          .where("run_id", "=", run.id)
          .where("state", "=", "succeeded")
          .executeTakeFirst();
        await job.db
          .transaction()
          .execute((tx) =>
            completeAuxiliaryRun(
              tx,
              ctx,
              run.id,
              charged ? amountsSchema.parse(run.requested_amounts) : emptyAmounts(),
              job.now(),
            ),
          );
      } catch (error) {
        if (
          error instanceof ProviderError &&
          error.retryable &&
          job.job.attempt < readPltSettings().jobs.maxAttempts
        )
          throw error;
        await job.db.transaction().execute((tx) =>
          failAuxiliaryRun(
            tx,
            ctx,
            payload.runId,
            {
              code:
                error instanceof ProviderError
                  ? error.code
                  : error instanceof AppError
                    ? error.code
                    : "voice_processing_failed",
              uncertain: error instanceof ProviderError && error.uncertain,
            },
            job.now(),
          ),
        );
      }
    },
  };
  return definition;
}
