import { longestProviderTimeoutMs } from "../aip";
import {
  GENERATED_IDENTITY_VERSION,
  normalizeGeneratedStudyModel,
  publishKnowledgeVersion,
} from "../lkm";
import type { JobDefinition } from "../plt";
import { amountsSchema } from "../quota";
import { assertSourcesLive, updateAutomaticSourceRoles } from "../src";
import { settleClassMaterial } from "./charged-material";
import { processingQueue } from "./contracts";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";
import { teachingAdaptation } from "./learner-context";

export { generatedKnowledgeSchema } from "./generated-knowledge";

import { planLessonParts } from "./knowledge-parts";
import { correctVoiceCandidates, processVoiceSource } from "./voice-processing";

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
import {
  checkpointAndContinue,
  hasTime,
  liveRun,
  PROVIDER_CALL_SAFETY_MS,
  type ProcessingDependencies,
  providerStep,
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
        const { provider, initial, settings, snapshot } = stage;
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
          const { missing, lessonContext, practiceFocus, compactGeneration, quality } = prepared;
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
          if (dependencies.diarizeVoice) {
            // Optional correction must not share a job with a newly paid knowledge stage.
            if (knowledgeDispatched) {
              return "checkpoint";
            }
            // Nor with the acoustic check that ran in this job: the check is saved first.
            if (voiceCheck && (await voiceCheck.wait())) return "checkpoint";
            for (const source of extracted) {
              const voiceProgress = await processVoiceSource({
                db: job.db,
                ctx,
                sessionId: initial.session_id,
                runId: payload.runId,
                source,
                explanationLanguage: settings.explanationLanguage,
                diarize: dependencies.diarizeVoice,
                now: job.now,
                correct: (analysis) =>
                  correctVoiceCandidates({
                    db: job.db,
                    ctx,
                    analysis,
                    explanationLanguage: settings.explanationLanguage,
                    provider,
                    now: job.now,
                    referenceTexts: classified
                      .filter((item) => item.kind !== "audio" && item.role !== "user_notes")
                      .flatMap((item) => item.blocks.map((block) => block.text)),
                    execute: (request) =>
                      providerStep(
                        job,
                        ctx,
                        payload.runId,
                        request.step,
                        request.model,
                        provider,
                        request.schema,
                        request.effect,
                        { onCommit: request.onCommit },
                      ),
                  }),
              });
              if (voiceProgress !== "unchanged") {
                return "checkpoint";
              }
            }
          }
          await job.db.transaction().execute(async (tx) => {
            const run = await liveRun(tx, ctx, payload.runId);
            // The source's own lock prevents a late worker from publishing after an asset tombstone.
            await assertSourcesLive(
              tx,
              ctx,
              snapshot.sources.map((source) => source.sourceId),
            );
            await updateAutomaticSourceRoles(
              tx,
              ctx,
              run.session_id,
              classified.map((source) => ({
                sourceId: source.sourceId,
                role: source.role ?? "class_material",
              })),
              job.now(),
            );
            const version = await publishKnowledgeVersion(
              tx,
              ctx,
              {
                runId: run.id,
                sessionId: run.session_id,
                sourcesVersion: snapshot.sourcesVersion,
                sourceFingerprint: snapshot.fingerprint,
                model,
                sources: classified,
                explanationLanguage: settings.explanationLanguage,
                generation: {
                  provider: provider.name,
                  model: settings.provider.llmModel,
                  promptVersion: settings.provider.promptVersion,
                  identityVersion: GENERATED_IDENTITY_VERSION,
                  settings: settings.provider,
                  profileVersion: settings.profileVersion,
                  teachingPreferences: settings.teachingPreferences,
                  ...(practiceAudit.applied ? { studyPractice: practiceAudit } : {}),
                  ...(settings.learnerContext
                    ? {
                        teachingAdaptation: teachingAdaptation({
                          context: settings.learnerContext,
                          shorterExamples: settings.teachingPreferences.shorterExamples,
                          focus: practiceFocus,
                          items: model.learningItems,
                        }),
                      }
                    : {}),
                },
              },
              job.now(),
            );
            // D59: charge only material no earlier publication paid for, within the reservation.
            await settleClassMaterial(tx, ctx, {
              runId: run.id,
              sessionId: run.session_id,
              reservationId: run.reservation_id,
              held: amountsSchema.parse(run.requested_amounts),
              sources: extracted.filter((source) => source.blocks.length),
              charactersPerPage: settings.provider.charactersPerPage,
              now: job.now(),
            });
            await tx
              .updateTable("proc.processing_run")
              .set({
                state: missing.length ? "partial_ready" : "ready",
                output_version_id: version.id,
                finished_at: job.now(),
                updated_at: job.now(),
                last_error: null,
              })
              .where("id", "=", run.id)
              .execute();
          });
          return "published";
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
