import "server-only";
import { processingJob } from "@recalino/core/proc";
import { markSourceAudioTranscribed } from "@recalino/core/src";
import { getAiProvider } from "./ai";
import { prepareAudio } from "./audio-preparer";
import { preparePdfPage } from "./pdf-preparer";
import { getObjectStore } from "./storage";
export function getProcessingDefinition() {
  const store = getObjectStore();
  return store
    ? processingJob({
        store,
        provider: getAiProvider(),
        prepareAudio,
        preparePdfPage,
        onTranscribed: markSourceAudioTranscribed,
      })
    : null;
}
