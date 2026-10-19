import { z } from "zod";
import { transcriptSchema } from "../../aip";
import { deleteObject, errors, ownedObjectMetadata } from "../../plt";
import type { sourceContentSchema } from "../../src";
import type { RunSource } from "../contracts";
import { scopedVoiceSpeakerId } from "../voice-processing";
import { type ProcessingStage, type StoredSource, YIELDED, type Yielded } from "./context";
import {
  audioChunkSchema,
  cached,
  checkpointAndContinue,
  completedSteps,
  liveRun,
  saveStep,
  storeExtraction,
  TRANSCRIPTION_CONCURRENCY,
  transcribeChunks,
  withinSelection,
  YIELD_DELAY_SECONDS,
} from "./runtime";

/**
 * An audio source (audit QUA-01, moved from processingJob): the chunk plan is saved once, chunks
 * are transcribed a few at a time across jobs, and the joined transcript is stored as content.
 */
export const extractAudioSource: ProcessingStage<StoredSource, RunSource | Yielded> = async (
  run,
  source,
) => {
  const { job, ctx, payload, definition, dependencies, provider, settings } = run;
  if (!dependencies.prepareAudio)
    throw errors.validationFailed({ audio: ["preparer_unavailable"] });
  let chunks = await cached(
    job.db,
    payload.runId,
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
          runId: payload.runId,
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
    await job.db.transaction().execute(async (tx) => {
      await liveRun(tx, ctx, payload.runId);
      await saveStep(tx, payload.runId, `audio:${source.sourceId}`, chunks, job.now());
    });
  }
  const transcribed = await completedSteps(
    job.db,
    payload.runId,
    chunks.map((chunk) => `stt:${chunk.id}`),
  );
  for (const chunk of chunks) {
    if (!transcribed.has(`stt:${chunk.id}`)) continue;
    // Only a job that stopped between a saved transcript and its deletion leaves bytes.
    const object = await ownedObjectMetadata(job.db, ctx, chunk.objectId).catch(() => null);
    if (object && object.state !== "deleted")
      await deleteObject(job.db, dependencies.store, ctx, chunk.objectId, job.now());
  }
  const pending = chunks.filter((chunk) => !transcribed.has(`stt:${chunk.id}`));
  if (pending.length) {
    const launched = await transcribeChunks(job, {
      ctx,
      runId: payload.runId,
      chunks: pending,
      provider,
      model: settings.provider.sttModel,
      store: dependencies.store,
      concurrency: dependencies.transcriptionConcurrency ?? TRANSCRIPTION_CONCURRENCY,
    });
    // No chunk fit before the runner's deadline: a fresh runner continues from the saved
    // chunk plan.
    await checkpointAndContinue(
      job,
      ctx,
      payload.runId,
      definition,
      launched ? 0 : YIELD_DELAY_SECONDS,
    );
    return YIELDED;
  }
  const units: z.infer<typeof sourceContentSchema>["units"] = [];
  const blocks: z.infer<typeof sourceContentSchema>["blocks"] = [];
  for (const chunk of chunks) {
    const transcript = await cached(job.db, payload.runId, `stt:${chunk.id}`, transcriptSchema);
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
            ? {
                speakerId: scopedVoiceSpeakerId(source.sourceId, chunk.id, segment.speakerId),
              }
            : {}),
        });
      }
  }
  const stored = withinSelection(
    await storeExtraction(
      job,
      ctx,
      payload.runId,
      source,
      { units, blocks },
      {
        provider: provider.name,
        model: settings.provider.sttModel,
        promptVersion: settings.provider.promptVersion,
      },
    ),
  );
  await dependencies.onTranscribed?.(job.db, ctx, source.sourceId, job.now());
  return stored;
};
