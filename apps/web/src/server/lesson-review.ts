import "server-only";
import { lessonReviewJob } from "@recalino/core/eval";
import { getAiProvider } from "./ai";

/** Advisory reviews use the existing provider and durable runner only after an explicit request. */
export function getLessonReviewDefinition() {
  const provider = getAiProvider();
  return provider ? lessonReviewJob({ provider }) : null;
}
