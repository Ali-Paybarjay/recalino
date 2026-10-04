import "server-only";
import { type MediaDependencies, mediaSettingsSchema, mediaTtsJob } from "@recalino/core/media";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  scheduleAuxiliaryRun,
} from "@recalino/core/proc";
import { getAiProvider } from "./ai";
import { getObjectStore } from "./storage";

export function getMediaDependencies(): MediaDependencies | null {
  const store = getObjectStore();
  if (!store || !process.env.RECALINO_MEDIA_SETTINGS_JSON) return null;
  try {
    return {
      store,
      provider: getAiProvider(),
      settings: mediaSettingsSchema.parse(JSON.parse(process.env.RECALINO_MEDIA_SETTINGS_JSON)),
      processor: {
        schedule: scheduleAuxiliaryRun,
        execute: executeAuxiliaryProviderStep,
        complete: completeAuxiliaryRun,
        fail: failAuxiliaryRun,
      },
    };
  } catch {
    return null;
  }
}
export function getMediaJobDefinition() {
  const deps = getMediaDependencies();
  return deps ? mediaTtsJob(deps) : null;
}
