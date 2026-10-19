import "server-only";
import {
  type AudioPreparer,
  type PdfPagesPreparer,
  type ProcessingDependencies,
  processingJob,
  recordProcessingNotification,
} from "@recalino/core/proc";
import { markSourceAudioTranscribed } from "@recalino/core/src";
import { getAiProvider } from "./ai";
import { finalizeAutomaticRun } from "./automatic-learning-publication";
import { getObjectStore } from "./storage";
import { diarizeSourceVoice } from "./voice-processing";

// PERF-01: the preparers load on first use inside a processing job. The PDF renderer loads Canvas
// when it is evaluated, and only the processing routes and the job runner ship Canvas.
const prepareAudio: AudioPreparer = async (input) =>
  (await import("./audio-preparer")).prepareAudio(input);
const prepareProcessingImage: NonNullable<ProcessingDependencies["prepareImage"]> = async (input) =>
  (await import("./image-preparer")).prepareProcessingImage(input);
const preparePdfPages: PdfPagesPreparer = async (input) =>
  (await import("./pdf-preparer")).preparePdfPages(input);

export function getProcessingDefinition() {
  const store = getObjectStore();
  if (!store) return null;
  const definition = processingJob({
    store,
    provider: getAiProvider(),
    prepareAudio,
    prepareImage: prepareProcessingImage,
    preparePdfPages,
    onTranscribed: markSourceAudioTranscribed,
    diarizeVoice: diarizeSourceVoice,
  });
  return {
    ...definition,
    async run(
      payload: { runId: string; userId: string },
      job: Parameters<typeof definition.run>[1],
    ) {
      await definition.run(payload, job);
      await finalizeAutomaticRun(
        job.db,
        { userId: payload.userId, requestId: job.job.id },
        payload.runId,
        job.now(),
      );
      await recordProcessingNotification(
        job.db,
        { userId: payload.userId, requestId: job.job.id },
        payload.runId,
        job.now(),
      );
    },
  };
}
