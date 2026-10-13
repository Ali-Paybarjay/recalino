import { z } from "zod";
import { lockAccount } from "../acc";
import {
  type AiProvider,
  ProviderError,
  providerSettingsSchema,
  requireProvider,
  transcriptSchema,
} from "../aip";
import type { Database } from "../db";
import {
  AppError,
  canonicalJson,
  deleteObject,
  enqueueJob,
  errors,
  type JobContext,
  type JobDefinition,
  type LearnerContext,
  type ObjectStore,
  ownedObjectMetadata,
  readOwnedObject,
  readPltSettings,
} from "../plt";
import { allowance, emptyAmounts } from "../quota";
import { appendContentVersion, recordedPartSessionId, type sourceContentSchema } from "../src";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  scheduleAuxiliaryRun,
} from "./auxiliary";
import { type RunSource, sourceSnapshotSchema } from "./contracts";
import { ownedRun, selectProcessingSourceSnapshot } from "./runs";
import { scopedVoiceSpeakerId } from "./voice-processing";
import { type AudioChunk, type AudioPreparer, audioChunkSchema } from "./worker";

/**
 * D61 (owner decision 2026-10-12): a staged part of a class still being recorded (D60) is
 * transcribed in the background. No text is shown live; the transcript becomes the part's
 * content version, which the class run after Stop reuses instead of transcribing it again.
 * The work is an auxiliary run: every provider call goes through PROC attempts and the AI cost
 * policy (D37, D56). It holds no allowance and charges nothing; the class run reserves and
 * charges the audio once by the usual rules (D59). A failed attempt only means the class run
 * transcribes that part itself.
 */
const PURPOSE = "capture_transcription";
const requestSchema = z.strictObject({
  kind: z.literal(PURPOSE),
  sourceId: z.uuid(),
  objectId: z.uuid(),
});
const snapshotSchema = z.strictObject({ subjectId: z.uuid(), request: requestSchema });
const settingsSchema = z.strictObject({
  purpose: z.literal(PURPOSE),
  provider: providerSettingsSchema,
});
const payloadSchema = z.strictObject({
  runId: z.uuid(),
  userId: z.uuid(),
  subjectId: z.uuid(),
});
/** Time kept after the last provider call a job starts, before its runner's deadline. */
const PROVIDER_CALL_SAFETY_MS = 15_000;

export interface CaptureTranscriptionDependencies {
  provider?: AiProvider;
  store: ObjectStore;
  prepareAudio?: AudioPreparer;
  onTranscribed?: (db: Database, ctx: LearnerContext, sourceId: string, now: Date) => Promise<void>;
}

/** The staged part as the class run would see it, or null when it has nothing to transcribe. */
async function stagedPart(db: Database, ctx: LearnerContext, sourceId: string) {
  const sessionId = await recordedPartSessionId(db, ctx, sourceId);
  if (!sessionId) return null;
  try {
    const snapshot = sourceSnapshotSchema.parse(
      await selectProcessingSourceSnapshot(db, ctx, sessionId),
    );
    const source = snapshot.sources.find(
      (item) => item.sourceId === sourceId && item.kind === "audio",
    );
    return source ? { sessionId, source } : null;
  } catch (failure) {
    // Another material of the class may not be ready yet; the class run handles this part.
    if (failure instanceof AppError && failure.code === "validation_failed") return null;
    throw failure;
  }
}

/**
 * Schedules background transcription of one verified staged part. Returns null when there is
 * nothing to do: no provider, already transcribed, another run active, or no allowance left for
 * the part, so paid work never starts for audio the class run could not process anyway.
 */
export async function scheduleCaptureTranscription(
  db: Database,
  ctx: LearnerContext,
  sourceId: string,
  dependencies: CaptureTranscriptionDependencies,
  now = new Date(),
): Promise<string | null> {
  if (!dependencies.provider || !dependencies.prepareAudio) return null;
  const provider = dependencies.provider;
  const part = await stagedPart(db, ctx, sourceId);
  if (!part || part.source.contentVersionId || !part.source.objectId || !part.source.durationMs)
    return null;
  const remaining = await allowance(db, ctx, now);
  if (
    !remaining.entitlementId ||
    (remaining.remaining.audio ?? 0) < Math.ceil(part.source.durationMs / 1000)
  )
    return null;
  try {
    return await db.transaction().execute((tx) =>
      scheduleAuxiliaryRun(
        tx,
        ctx,
        {
          sessionId: part.sessionId,
          operationKey: `${PURPOSE}:${sourceId}:${part.source.objectId}`,
          subjectId: sourceId,
          requested: emptyAmounts(),
          request: { kind: PURPOSE, sourceId, objectId: part.source.objectId },
          settings: { purpose: PURPOSE, provider: provider.settings },
          job: captureTranscriptionJob(dependencies),
        },
        now,
      ),
    );
  } catch (failure) {
    // One run per class at a time: an active run (or one for an earlier part) goes first.
    if (failure instanceof AppError && failure.code === "conflict") return null;
    throw failure;
  }
}

/** Whether a class still has background transcription in progress; its run waits for it. */
export async function captureTranscriptionActive(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .selectFrom("proc.processing_run")
    .select("settings")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("kind", "=", "auxiliary")
    .where("state", "in", ["queued", "processing"])
    .execute();
  return rows.some((row) => settingsSchema.safeParse(row.settings).success);
}

function hasTime(job: JobContext, ms: number): boolean {
  return !job.deadline || job.deadline.getTime() - job.now().getTime() >= ms;
}
async function checkpoint(db: Database, runId: string, step: string, output: unknown, now: Date) {
  await db
    .insertInto("proc.run_step")
    .values({ run_id: runId, step, output: JSON.stringify(output), completed_at: now })
    .onConflict((oc) => oc.columns(["run_id", "step"]).doNothing())
    .execute();
}
async function saved<T>(db: Database, runId: string, step: string, schema: z.ZodType<T>) {
  const row = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", runId)
    .where("step", "=", step)
    .executeTakeFirst();
  return row ? schema.parse(row.output) : null;
}

/** Same units and blocks the class run builds from a transcript (see worker.ts). */
function transcriptContent(
  source: RunSource,
  chunks: readonly AudioChunk[],
  transcripts: ReadonlyMap<string, z.infer<typeof transcriptSchema>>,
) {
  const units: z.infer<typeof sourceContentSchema>["units"] = [];
  const blocks: z.infer<typeof sourceContentSchema>["blocks"] = [];
  for (const chunk of chunks) {
    const transcript = transcripts.get(chunk.id);
    if (!transcript) throw errors.conflict();
    if (!transcript.segments.length) {
      units.push({
        id: chunk.id,
        kind: "document",
        start: 1,
        status: transcript.text.trim() ? "partial" : "failed",
        reason: transcript.text.trim() ? "timestamps_unavailable" : "no_speech",
      });
      if (transcript.text.trim())
        blocks.push({
          id: `${chunk.id}-text`,
          kind: "transcript",
          text: transcript.text,
          unitId: chunk.id,
        });
    } else
      for (const [index, segment] of transcript.segments.entries()) {
        const id = `${chunk.id}-${index}`;
        units.push({
          id,
          kind: "time",
          start: segment.startMs,
          end: segment.endMs,
          status: "extracted",
        });
        blocks.push({
          id: `${id}-text`,
          kind: "transcript",
          text: segment.text,
          unitId: id,
          speakerRole: "unknown",
          ...(segment.speakerId
            ? { speakerId: scopedVoiceSpeakerId(source.sourceId, chunk.id, segment.speakerId) }
            : {}),
        });
      }
  }
  return { units, blocks };
}

export function captureTranscriptionJob(
  dependencies: CaptureTranscriptionDependencies,
): JobDefinition<z.infer<typeof payloadSchema>> {
  const definition: JobDefinition<z.infer<typeof payloadSchema>> = {
    kind: "proc.capture_transcription",
    version: 1,
    payload: payloadSchema,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      try {
        const run = await ownedRun(job.db, ctx, payload.runId);
        if (run.kind !== "auxiliary" || !["queued", "processing"].includes(run.state)) return;
        const settings = settingsSchema.parse(run.settings);
        const request = snapshotSchema.parse(run.input_snapshot).request;
        if (request.sourceId !== payload.subjectId) throw errors.notFound();
        const provider = requireProvider(dependencies.provider);
        if (canonicalJson(settings.provider) !== canonicalJson(provider.settings))
          throw errors.validationFailed({ provider: ["settings_changed"] });
        if (!dependencies.prepareAudio)
          throw errors.validationFailed({ audio: ["preparer_unavailable"] });
        const part = await stagedPart(job.db, ctx, request.sourceId);
        const done = () =>
          job.db
            .transaction()
            .execute((tx) => completeAuxiliaryRun(tx, ctx, run.id, emptyAmounts(), job.now()));
        // Already transcribed, or removed from the class: nothing to add.
        if (!part || part.source.contentVersionId) return await done();
        if (part.source.objectId !== request.objectId)
          throw errors.validationFailed({ audio: ["staged_copy_changed"] });
        const source = part.source;
        let chunks = await saved(
          job.db,
          run.id,
          `audio:${source.sourceId}`,
          z.array(audioChunkSchema),
        );
        if (!chunks) {
          chunks = z
            .array(audioChunkSchema)
            .min(1)
            .parse(
              await dependencies.prepareAudio({
                db: job.db,
                store: dependencies.store,
                ctx,
                runId: run.id,
                source,
                now: job.now(),
              }),
            );
          if (
            chunks.some(
              (chunk) =>
                chunk.sourceId !== source.sourceId ||
                chunk.offsetMs + chunk.durationMs > (source.durationMs ?? 0),
            )
          )
            throw errors.validationFailed({ audio: ["manifest_invalid"] });
          await checkpoint(job.db, run.id, `audio:${source.sourceId}`, chunks, job.now());
        }
        const model = settings.provider.sttModel;
        const callMs = settings.provider.timeoutMs + PROVIDER_CALL_SAFETY_MS;
        const transcripts = new Map<string, z.infer<typeof transcriptSchema>>();
        for (const chunk of chunks) {
          const prior = await saved(job.db, run.id, `stt:${chunk.id}`, transcriptSchema);
          if (prior) {
            transcripts.set(chunk.id, prior);
            const object = await ownedObjectMetadata(job.db, ctx, chunk.objectId).catch(() => null);
            if (object && object.state !== "deleted")
              await deleteObject(job.db, dependencies.store, ctx, chunk.objectId, job.now());
            continue;
          }
          // A fresh runner continues from the saved chunk plan.
          if (!hasTime(job, callMs)) {
            await job.db.transaction().execute(async (tx) => {
              await lockAccount(tx, ctx.userId);
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
          const bytes = await readOwnedObject(job.db, dependencies.store, ctx, chunk.objectId);
          const transcript = await executeAuxiliaryProviderStep(job, ctx, run.id, {
            step: `stt:${chunk.id}`,
            model,
            provider,
            schema: transcriptSchema,
            effect: (operationKey) =>
              provider.transcribe({
                operationKey,
                model,
                audio: { bytes, format: chunk.format },
                durationMs: chunk.durationMs,
                offsetMs: chunk.offsetMs,
              }),
          });
          transcripts.set(chunk.id, transcript);
          await deleteObject(job.db, dependencies.store, ctx, chunk.objectId, job.now());
        }
        const content = transcriptContent(source, chunks, transcripts);
        await job.db.transaction().execute(async (tx) => {
          await appendContentVersion(
            tx,
            ctx,
            source.sourceId,
            {
              ...content,
              schemaVersion: "1",
              provenance: "machine_extraction",
              originKey: `processing:${run.id}:${source.sourceId}`,
              settings: {
                provider: provider.name,
                model,
                promptVersion: settings.provider.promptVersion,
                ranges: source.ranges,
              },
            },
            job.now(),
          );
          await completeAuxiliaryRun(tx, ctx, run.id, emptyAmounts(), job.now());
        });
        // D29: the temporary copy is deleted within 24 hours of a successful transcription.
        await dependencies.onTranscribed?.(job.db, ctx, source.sourceId, job.now());
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
                    : "capture_transcription_failed",
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
