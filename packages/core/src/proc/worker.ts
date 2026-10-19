import { longestProviderTimeoutMs } from "../aip";
import type { JobDefinition } from "../plt";
import { processingQueue } from "./contracts";

export { generatedKnowledgeSchema } from "./generated-knowledge";

export { knowledgePrompt, validateGeneratedKnowledge } from "./steps/knowledge-checks";
export {
  type AudioChunk,
  type AudioPreparer,
  audioChunkSchema,
  PDF_PAGE_PREPARATION_BATCH_SIZE,
  type PdfPageImage,
  type PdfPagePreparer,
  type PdfPagesPreparer,
  type ProcessingDependencies,
  providerStep,
  TRANSCRIPTION_CONCURRENCY,
  TRANSCRIPTION_LAUNCH_WINDOW_MS,
  VISION_CONCURRENCY,
  VOICE_ANALYSIS_TIME_MS,
} from "./steps/runtime";

import { YIELDED } from "./steps/context";
import { extractSources } from "./steps/extract-sources";
import { failRun } from "./steps/fail-run";
import { teachLesson } from "./steps/lesson";
import {
  checkpointAndContinue,
  hasTime,
  PROVIDER_CALL_SAFETY_MS,
  type ProcessingDependencies,
  YIELD_DELAY_SECONDS,
} from "./steps/runtime";
import { startRun } from "./steps/start";
import { beginVoiceCheck } from "./steps/voice-check";

/** One provider chunk per invocation; continuation jobs keep long classes within Function limits. */
export function processingJob(
  dependencies: ProcessingDependencies,
): JobDefinition<{ runId: string; userId: string }> {
  const definition: JobDefinition<{ runId: string; userId: string }> = {
    ...processingQueue,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      try {
        const stage = await startRun({ job, ctx, payload, definition, dependencies });
        const extracted = await extractSources(stage);
        if (extracted === YIELDED) return;
        // Each lesson stage makes at most one provider call, on any model of the run. A stage
        // whose call could not finish before the runner's deadline is left to a fresh runner.
        const lessonCallMs =
          longestProviderTimeoutMs(stage.provider.settings) + PROVIDER_CALL_SAFETY_MS;
        if (!hasTime(job, lessonCallMs)) {
          await checkpointAndContinue(job, ctx, payload.runId, definition, YIELD_DELAY_SECONDS);
          return;
        }
        const voiceCheck = await beginVoiceCheck(stage, extracted);
        if (voiceCheck === YIELDED) return;
        let outcome: "checkpoint" | "published";
        try {
          do outcome = await teachLesson(stage, { extracted, voiceCheck });
          while (
            // While the acoustic check still runs, the lesson goes on in this job instead of the
            // next, as long as one more stage's call can finish before the runner's deadline.
            outcome === "checkpoint" &&
            voiceCheck?.running() &&
            hasTime(job, lessonCallMs)
          );
        } catch (error) {
          // The check's worker never outlives its job; the lesson's own failure is reported.
          await voiceCheck?.settle();
          throw error;
        }
        await voiceCheck?.wait();
        if (outcome === "checkpoint")
          await checkpointAndContinue(job, ctx, payload.runId, definition);
      } catch (error) {
        await failRun({ job, ctx, payload }, error);
        return;
      }
    },
  };
  return definition;
}
