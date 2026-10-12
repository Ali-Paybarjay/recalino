import "server-only";
import type { Database } from "@recalino/core/db";
import { createLogger, type LearnerContext } from "@recalino/core/plt";
import {
  captureTranscriptionJob,
  readAuxiliaryRun,
  scheduleCaptureTranscription,
} from "@recalino/core/proc";
import { markSourceAudioTranscribed, stagedAudioVerificationJob } from "@recalino/core/src";
import { getAiProvider } from "./ai";
import { audioVerifier, prepareAudio } from "./audio-preparer";
import { notifyAutomaticLearning } from "./automatic-learning-notifications";
import { getObjectStore } from "./storage";

/**
 * Approved by the owner on 2026-10-12 and on by default; each has a kill switch:
 * - D60 `RECALINO_CAPTURE_EARLY_UPLOAD=off`: sealed parts wait for Stop again.
 * - D61 `RECALINO_CAPTURE_EARLY_TRANSCRIPTION=off`: staged parts wait for the class run.
 */
export function captureFlags() {
  const earlyUpload = process.env.RECALINO_CAPTURE_EARLY_UPLOAD !== "off";
  return {
    earlyUpload,
    earlyTranscription: earlyUpload && process.env.RECALINO_CAPTURE_EARLY_TRANSCRIPTION !== "off",
  };
}

function transcriptionDependencies() {
  const store = getObjectStore();
  return store
    ? { store, provider: getAiProvider(), prepareAudio, onTranscribed: markSourceAudioTranscribed }
    : null;
}

/** D61: background transcription of a staged part; the class run then reuses its transcript. */
export function captureTranscriptionDefinition() {
  const dependencies = transcriptionDependencies();
  if (!dependencies) return null;
  const definition = captureTranscriptionJob(dependencies);
  return {
    ...definition,
    async run(
      payload: Parameters<typeof definition.run>[0],
      job: Parameters<typeof definition.run>[1],
    ) {
      await definition.run(payload, job);
      // A class run waiting for this part can start now instead of at the next reconcile.
      const ctx = { userId: payload.userId, requestId: job.job.id };
      const run = await readAuxiliaryRun(job.db, ctx, payload.runId).catch(() => null);
      if (run && !["queued", "processing"].includes(run.state))
        await notifyAutomaticLearning(job.db, ctx, run.sessionId, false);
    },
  };
}

export function stagedAudioJobDefinition() {
  const store = getObjectStore();
  return store
    ? stagedAudioVerificationJob(
        store,
        audioVerifier(),
        async (db: Database, ctx: LearnerContext, assetId: string) => {
          if (!captureFlags().earlyTranscription) return;
          const dependencies = transcriptionDependencies();
          if (!dependencies) return;
          try {
            await scheduleCaptureTranscription(db, ctx, assetId, dependencies);
          } catch (failure) {
            // Verification stands; the class run transcribes this part instead.
            createLogger()("error", "capture_transcription_not_scheduled", {
              request_id: ctx.requestId,
              user_id: ctx.userId,
              error_name: failure instanceof Error ? failure.name : typeof failure,
            });
          }
        },
      )
    : null;
}
