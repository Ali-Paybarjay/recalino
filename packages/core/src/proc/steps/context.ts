import type { z } from "zod";
import type { AiProvider } from "../../aip";
import type { JobContext, JobDefinition, LearnerContext } from "../../plt";
import type { runSettingsSchema, sourceSnapshotSchema } from "../contracts";
import type { liveRun, ProcessingDependencies } from "./runtime";
import type { VisionContract } from "./vision";

/**
 * Everything a stage of one processing job invocation reads (audit QUA-01). The names are the
 * ones processingJob always used, so each stage's body reads exactly as it did inside `run`.
 */
export interface ProcessingRun {
  job: JobContext;
  ctx: LearnerContext;
  payload: { runId: string; userId: string };
  /** The job definition, for queueing a fresh runner after a checkpoint. */
  definition: JobDefinition<{ runId: string; userId: string }>;
  dependencies: ProcessingDependencies;
  provider: AiProvider;
  /** The run row as the job found it. */
  initial: Awaited<ReturnType<typeof liveRun>>;
  settings: z.infer<typeof runSettingsSchema>;
  snapshot: z.infer<typeof sourceSnapshotSchema>;
  vision: VisionContract;
}

/** The shared stage signature: the run and the stage's own input, to its output. */
export type ProcessingStage<Input, Output> = (run: ProcessingRun, input: Input) => Promise<Output>;

/** A stage saved its progress and queued a fresh runner; this job invocation ends. */
export const YIELDED = "yielded" as const;
export type Yielded = typeof YIELDED;
