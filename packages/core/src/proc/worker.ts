import { longestProviderTimeoutMs } from "../aip";
import { normalizeGeneratedStudyModel } from "../lkm";
import type { JobDefinition } from "../plt";
import { processingQueue } from "./contracts";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";

export { generatedKnowledgeSchema } from "./generated-knowledge";

import { planLessonParts } from "./knowledge-parts";

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
import { validateGeneratedKnowledge } from "./steps/knowledge-checks";
import { prepareLesson } from "./steps/lesson-input";
import { generateLessonKnowledge } from "./steps/lesson-knowledge";
import { generateLessonParts } from "./steps/lesson-parts";
import { publishLesson } from "./steps/publish";
import {
  checkpointAndContinue,
  hasTime,
  PROVIDER_CALL_SAFETY_MS,
  type ProcessingDependencies,
  YIELD_DELAY_SECONDS,
} from "./steps/runtime";
import { startRun } from "./steps/start";
import { beginVoiceCheck } from "./steps/voice-check";
import { correctSpokenMistakes } from "./steps/voice-correction";

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
        const { provider, settings } = stage;
        const extracted = await extractSources(stage);
        if (extracted === YIELDED) return;
        // Each lesson stage makes at most one provider call, on any model of the run. A stage
        // whose call could not finish before the runner's deadline is left to a fresh runner.
        const lessonCallMs = longestProviderTimeoutMs(provider.settings) + PROVIDER_CALL_SAFETY_MS;
        if (!hasTime(job, lessonCallMs)) {
          await checkpointAndContinue(job, ctx, payload.runId, definition, YIELD_DELAY_SECONDS);
          return;
        }
        const voiceCheck = await beginVoiceCheck(stage, extracted);
        if (voiceCheck === YIELDED) return;
        const lessonStage = async (): Promise<"checkpoint" | "published"> => {
          const prepared = await prepareLesson(stage, extracted);
          const { missing, lessonContext, compactGeneration, quality } = prepared;
          let knowledgeDispatched = false;
          let validated: ReturnType<typeof validateGeneratedKnowledge>;
          // D63: a class longer than one part is taught part by part and merged by code.
          const partPlan =
            compactGeneration && quality?.classPartMinutes
              ? planLessonParts(extracted, quality.classPartMinutes, missing)
              : null;
          if (partPlan) {
            const merged = await generateLessonParts(stage, { lesson: prepared, plan: partPlan });
            if (merged === "checkpoint") return "checkpoint";
            validated = validateGeneratedKnowledge(
              merged,
              extracted,
              missing,
              settings.explanationLanguage,
            );
          } else {
            const dispatch = { knowledgeDispatched };
            const knowledge = await generateLessonKnowledge(stage, { lesson: prepared, dispatch });
            knowledgeDispatched = dispatch.knowledgeDispatched;
            if (knowledge === "checkpoint") return "checkpoint";
            validated = knowledge;
          }
          const { classified } = validated;
          const { model, audit: practiceAudit } = finalizeGeneratedStudyPractice(
            normalizeGeneratedStudyModel(
              validated.model,
              extracted.some((source) => source.kind === "audio"),
              lessonContext,
            ),
            classified,
            settings.learnerContext,
          );
          if (
            (await correctSpokenMistakes(stage, {
              extracted,
              classified,
              knowledgeDispatched,
              voiceCheck,
            })) === "checkpoint"
          )
            return "checkpoint";
          return publishLesson(stage, { lesson: prepared, classified, model, practiceAudit });
        };
        let outcome: "checkpoint" | "published";
        try {
          do outcome = await lessonStage();
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
