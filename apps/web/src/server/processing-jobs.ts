import "server-only";
import { processingJob } from "@recalino/core/proc";
import { markSourceAudioTranscribed } from "@recalino/core/src";
import { getAiProvider } from "./ai";
import { prepareAudio } from "./audio-preparer";
import { finalizeAutomaticRun } from "./automatic-learning-publication";
import { prepareProcessingImage } from "./image-preparer";
import { preparePdfPage } from "./pdf-preparer";
import { getObjectStore } from "./storage";
import { diarizeSourceVoice } from "./voice-processing";
export function getProcessingDefinition() {
  const store = getObjectStore();
  if (!store) return null;
  const definition = processingJob({
    store,
    provider: getAiProvider(),
    prepareAudio,
    prepareImage: prepareProcessingImage,
    preparePdfPage,
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
    },
  };
}
