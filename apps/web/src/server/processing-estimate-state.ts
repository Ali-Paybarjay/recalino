import "server-only";
import type { Database } from "@recalino/core/db";
import { AppError, type LearnerContext } from "@recalino/core/plt";
import { readProcessingEstimate } from "./processing-routes";

export type ProcessingEstimateProblem =
  | "no_selected_sources"
  | "sources_not_ready"
  | "selection_too_large"
  | "unavailable";

export type ProcessingEstimateState =
  | {
      estimate: Awaited<ReturnType<typeof readProcessingEstimate>>;
      problem: null;
    }
  | { estimate: null; problem: ProcessingEstimateProblem };

/** Keep expected selection problems distinct without sending server errors to the page. */
export async function readProcessingEstimateState(
  db: Database,
  learner: LearnerContext,
  sessionId: string,
): Promise<ProcessingEstimateState> {
  try {
    return { estimate: await readProcessingEstimate(db, learner, sessionId), problem: null };
  } catch (failure) {
    if (failure instanceof AppError) {
      if (failure.code === "unauthenticated" || failure.code === "not_found") throw failure;
      if (failure.code === "validation_failed") {
        const fields = failure.details?.fields;
        const sources =
          typeof fields === "object" && fields !== null && "sources" in fields
            ? fields.sources
            : undefined;
        if (Array.isArray(sources)) {
          if (sources.includes("select_at_least_one"))
            return { estimate: null, problem: "no_selected_sources" };
          if (sources.includes("not_verified"))
            return { estimate: null, problem: "sources_not_ready" };
          if (sources.includes("selected_text_too_large"))
            return { estimate: null, problem: "selection_too_large" };
        }
      }
    }
    return { estimate: null, problem: "unavailable" };
  }
}
