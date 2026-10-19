import type { z } from "zod";
import {
  effectiveStructuredMaxOutputTokens,
  longestProviderTimeoutMs,
  ProviderError,
} from "../aip";
import {
  GENERATED_IDENTITY_VERSION,
  normalizeGeneratedStudyModel,
  publishKnowledgeVersion,
} from "../lkm";
import type { JobDefinition } from "../plt";
import { amountsSchema } from "../quota";
import { assertSourcesLive, sourceClassificationPrompt, updateAutomaticSourceRoles } from "../src";
import { settleClassMaterial } from "./charged-material";
import { processingQueue } from "./contracts";
import { generatedKnowledgeSchema, legacyKnowledgeWireSchema } from "./generated-knowledge";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";
import {
  compactKnowledgeBudget,
  compactKnowledgeInstruction,
  knowledgeTruncationSchema,
} from "./knowledge-compact";
import { buildKnowledgeGenerationInput, knowledgeRepairDetailSchema } from "./knowledge-generation";
import {
  generateCanonicalKnowledge,
  knowledgeSchemaFailureSchema,
} from "./knowledge-generation-step";
import { knowledgeInputContextSchema } from "./knowledge-input-context";
import { declaredTeachingContext, teachingAdaptation } from "./learner-context";

export { generatedKnowledgeSchema } from "./generated-knowledge";

import { type LessonPart, mergeLessonParts, planLessonParts } from "./knowledge-parts";
import { buildKnowledgeRepairInput } from "./knowledge-repair";
import { buildKnowledgeStudyRepairInput } from "./knowledge-study-repair";
import { buildKnowledgeTranslationInput } from "./knowledge-translation";
import { lessonBudget, lessonProductionLimit, measureLessonContent } from "./lesson-budget";
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
import {
  knowledgePrompt,
  semanticRepairReason,
  validateGeneratedKnowledge,
} from "./steps/knowledge-checks";
import { prepareLesson } from "./steps/lesson-input";
import {
  cached,
  checkpointAndContinue,
  hasTime,
  liveRun,
  PROVIDER_CALL_SAFETY_MS,
  type ProcessingDependencies,
  providerStep,
  saveStep,
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
          const {
            missing,
            lessonContext,
            practiceFocus,
            teaching,
            generationData,
            compactGeneration,
            quality,
            qualityOptions,
            knowledgeInput,
          } = prepared;
          /**
           * D63: each part has one paid generation and at most one bounded regeneration, each
           * saved before the next call; a job returns after any paid call. Parts are merged by
           * code, so no further provider call and no extra quota charge follows.
           */
          const generateLessonParts = async (
            plan: LessonPart[],
          ): Promise<"checkpoint" | z.infer<typeof generatedKnowledgeSchema>> => {
            const outputs: z.infer<typeof generatedKnowledgeSchema>[] = [];
            const model = settings.provider.llmModel;
            const outputTokens = effectiveStructuredMaxOutputTokens(settings.provider, model);
            for (const part of plan) {
              const partData = {
                ...generationData,
                sources: part.sources,
                missingSourceIds: part.missingSourceIds,
              };
              const partOptions = {
                maxOutputTokens: outputTokens,
                budget: lessonBudget(
                  outputTokens,
                  measureLessonContent(part.sources, settings.provider.charactersPerPage),
                ),
                sourceCoverage: quality?.sourceCoverage ?? false,
              };
              const step = `knowledge:part:${part.index}`;
              const output = await cached(job.db, payload.runId, step, generatedKnowledgeSchema);
              let repairReason: string;
              let repairDetail: string | undefined;
              if (!output) {
                const marker = await cached(
                  job.db,
                  payload.runId,
                  `${step}:schema-invalid`,
                  knowledgeSchemaFailureSchema,
                );
                if (!marker) {
                  const generation = buildKnowledgeGenerationInput(
                    partData,
                    settings.provider.maxInputCharacters,
                    partOptions,
                  );
                  try {
                    await providerStep(
                      job,
                      ctx,
                      payload.runId,
                      step,
                      model,
                      provider,
                      generatedKnowledgeSchema,
                      (operationKey) =>
                        generateCanonicalKnowledge(provider, model, operationKey, generation),
                      { singleResponse: true },
                    );
                  } catch (error) {
                    if (
                      !(error instanceof ProviderError) ||
                      error.code !== "provider_schema_invalid" ||
                      error.uncertain ||
                      !error.accounting
                    )
                      throw error;
                    const detail = knowledgeRepairDetailSchema.safeParse(error.diagnostic);
                    await job.db.transaction().execute(async (tx) => {
                      await liveRun(tx, ctx, payload.runId);
                      const attempt = await tx
                        .selectFrom("proc.provider_attempt")
                        .select("id")
                        .where("run_id", "=", payload.runId)
                        .where("step", "=", step)
                        .orderBy("attempt", "desc")
                        .executeTakeFirstOrThrow();
                      await saveStep(
                        tx,
                        payload.runId,
                        `${step}:schema-invalid`,
                        knowledgeSchemaFailureSchema.parse({
                          reason: "provider_schema_invalid",
                          attemptId: attempt.id,
                          ...(detail.success ? { detail: detail.data } : {}),
                        }),
                        job.now(),
                      );
                    });
                  }
                  return "checkpoint";
                }
                repairReason = marker.reason;
                repairDetail = marker.detail;
              } else {
                try {
                  validateGeneratedKnowledge(
                    output,
                    part.sources,
                    part.missingSourceIds,
                    settings.explanationLanguage,
                  );
                  outputs.push(output);
                  continue;
                } catch (error) {
                  const reason = semanticRepairReason(error);
                  if (!reason) throw error;
                  repairReason = reason;
                }
              }
              const repairStep = `${step}:repair`;
              const repaired = await cached(
                job.db,
                payload.runId,
                repairStep,
                generatedKnowledgeSchema,
              );
              if (!repaired) {
                const generation = buildKnowledgeGenerationInput(
                  partData,
                  settings.provider.maxInputCharacters,
                  { ...partOptions, repairReason, ...(repairDetail ? { repairDetail } : {}) },
                );
                await providerStep(
                  job,
                  ctx,
                  payload.runId,
                  repairStep,
                  model,
                  provider,
                  generatedKnowledgeSchema,
                  (operationKey) =>
                    generateCanonicalKnowledge(
                      provider,
                      model,
                      operationKey,
                      generation,
                      "class_knowledge_content_repair",
                    ),
                  { singleResponse: true },
                );
                return "checkpoint";
              }
              // A part's single regeneration is final: a remaining problem fails the run.
              validateGeneratedKnowledge(
                repaired,
                part.sources,
                part.missingSourceIds,
                settings.explanationLanguage,
              );
              outputs.push(repaired);
            }
            // D78: the lesson keeps a card for each marked span, within its raised limit.
            return mergeLessonParts(
              outputs,
              lessonProductionLimit(
                measureLessonContent(extracted, settings.provider.charactersPerPage).markedSpans,
              ),
            );
          };
          let knowledgeDispatched = false;
          let validated: ReturnType<typeof validateGeneratedKnowledge>;
          // D63: a class longer than one part is taught part by part and merged by code.
          const partPlan =
            compactGeneration && quality?.classPartMinutes
              ? planLessonParts(extracted, quality.classPartMinutes, missing)
              : null;
          if (partPlan) {
            const merged = await generateLessonParts(partPlan);
            if (merged === "checkpoint") return "checkpoint";
            validated = validateGeneratedKnowledge(
              merged,
              extracted,
              missing,
              settings.explanationLanguage,
            );
          } else {
            const priorKnowledge = await cached(
              job.db,
              payload.runId,
              "knowledge",
              generatedKnowledgeSchema,
            );
            knowledgeDispatched = !priorKnowledge;
            let generated = priorKnowledge;
            if (!generated) {
              const compact = await cached(
                job.db,
                payload.runId,
                "knowledge:truncated",
                knowledgeTruncationSchema,
              );
              const schemaFailure = compactGeneration
                ? await cached(
                    job.db,
                    payload.runId,
                    "knowledge:schema-invalid",
                    knowledgeSchemaFailureSchema,
                  )
                : null;
              // Deterministic request validation runs before reserving a paid attempt.
              const generation = compactGeneration
                ? buildKnowledgeGenerationInput(
                    generationData,
                    settings.provider.maxInputCharacters,
                    {
                      maxOutputTokens: compact
                        ? compactKnowledgeBudget(settings.provider.maxOutputTokens)
                        : settings.provider.maxOutputTokens,
                      // The single compact recovery keeps its fixed small budget.
                      ...(compact ? {} : qualityOptions),
                      compact: Boolean(compact),
                      ...(schemaFailure
                        ? {
                            repairReason: schemaFailure.reason,
                            ...(schemaFailure.detail ? { repairDetail: schemaFailure.detail } : {}),
                          }
                        : {}),
                    },
                  )
                : undefined;
              try {
                generated = await providerStep(
                  job,
                  ctx,
                  payload.runId,
                  compact ? "knowledge:compact" : schemaFailure ? "knowledge:repair" : "knowledge",
                  settings.provider.llmModel,
                  provider,
                  generatedKnowledgeSchema,
                  (operationKey) =>
                    generation
                      ? generateCanonicalKnowledge(
                          provider,
                          settings.provider.llmModel,
                          operationKey,
                          generation,
                        )
                      : provider.structured({
                          operationKey,
                          model: settings.provider.llmModel,
                          // The checkpoint contract without study.ipaText: no provider writes it.
                          schema: legacyKnowledgeWireSchema,
                          schemaName: "class_knowledge",
                          system: [
                            knowledgePrompt(
                              settings.explanationLanguage,
                              settings.teachingPreferences.shorterExamples,
                              compact
                                ? compactKnowledgeBudget(settings.provider.maxOutputTokens)
                                : settings.provider.maxOutputTokens,
                              false,
                              teaching,
                            ),
                            knowledgeInput.sourceRefPrompt,
                            "Return one sourceClassifications entry per source, using the exact sourceId. " +
                              sourceClassificationPrompt +
                              " Audio always uses evidence audio; use class_material as its classification placeholder. Images already have an automatically detected role from vision: preserve that category. Use the detected category when choosing claim evidence, but never treat personal notes as proof of authorship or a speaker's identity.",
                            ...(compact
                              ? [compactKnowledgeInstruction(settings.explanationLanguage)]
                              : []),
                          ].join(" "),
                          input: knowledgeInput.input,
                        }),
                  {
                    onCommit: async (tx, output) => {
                      await saveStep(
                        tx,
                        payload.runId,
                        "knowledge:input-context",
                        knowledgeInputContextSchema.parse({ version: 1, ...lessonContext }),
                        job.now(),
                      );
                      if (compact || schemaFailure) {
                        await saveStep(tx, payload.runId, "knowledge", output, job.now());
                      }
                    },
                  },
                );
              } catch (error) {
                if (
                  !compact &&
                  !schemaFailure &&
                  error instanceof ProviderError &&
                  !error.uncertain &&
                  error.accounting &&
                  ((error.code === "provider_output_truncated" &&
                    (await cached(
                      job.db,
                      payload.runId,
                      "knowledge:truncated",
                      knowledgeTruncationSchema,
                    ))) ||
                    (compactGeneration &&
                      error.code === "provider_schema_invalid" &&
                      (await cached(
                        job.db,
                        payload.runId,
                        "knowledge:schema-invalid",
                        knowledgeSchemaFailureSchema,
                      ))))
                ) {
                  return "checkpoint";
                }
                throw error;
              }
            }
            try {
              validated = validateGeneratedKnowledge(
                generated,
                extracted,
                missing,
                settings.explanationLanguage,
              );
            } catch (error) {
              // Only a complete, saved response with a known semantic failure permits repair.
              // Provider uncertainty, changed settings and account/source failures never enter here.
              if (!semanticRepairReason(error)) throw error;
              // A known invalid response or truncation and its recovery consume both
              // content-contract attempts. Never buy a third generation after semantic validation.
              if (
                compactGeneration &&
                ((await cached(
                  job.db,
                  payload.runId,
                  "knowledge:truncated",
                  knowledgeTruncationSchema,
                )) ||
                  (await cached(
                    job.db,
                    payload.runId,
                    "knowledge:schema-invalid",
                    knowledgeSchemaFailureSchema,
                  )))
              )
                throw error;
              // Persist each paid result before the next provider call gets its own job budget.
              if (!priorKnowledge) {
                return "checkpoint";
              }
              if (semanticRepairReason(error) === "study_sentence_mismatch") {
                const studyRepair = buildKnowledgeStudyRepairInput(
                  generated,
                  settings.provider.maxInputCharacters,
                  declaredTeachingContext(teaching),
                );
                const priorStudyRepair = await cached(
                  job.db,
                  payload.runId,
                  "knowledge:study-repair",
                  studyRepair.schema,
                );
                const answerParts =
                  priorStudyRepair ??
                  (await providerStep(
                    job,
                    ctx,
                    payload.runId,
                    "knowledge:study-repair",
                    settings.provider.llmModel,
                    provider,
                    studyRepair.schema,
                    (operationKey) =>
                      provider.structured({
                        operationKey,
                        model: settings.provider.llmModel,
                        schema: studyRepair.schema,
                        schemaName: "class_study_sentence_repair",
                        system: studyRepair.system,
                        input: studyRepair.input,
                      }),
                  ));
                if (!priorStudyRepair) knowledgeDispatched = true;
                // Only gap fields change. A remaining semantic failure stops this attempt;
                // it never triggers a second repair or regenerates the saved lesson.
                validated = validateGeneratedKnowledge(
                  studyRepair.apply(answerParts),
                  extracted,
                  missing,
                  settings.explanationLanguage,
                );
              } else if (compactGeneration) {
                const repair = buildKnowledgeGenerationInput(
                  generationData,
                  settings.provider.maxInputCharacters,
                  {
                    maxOutputTokens: settings.provider.maxOutputTokens,
                    ...qualityOptions,
                    repairReason: semanticRepairReason(error) ?? undefined,
                  },
                );
                const priorRepair = await cached(
                  job.db,
                  payload.runId,
                  "knowledge:repair",
                  generatedKnowledgeSchema,
                );
                const repaired =
                  priorRepair ??
                  (await providerStep(
                    job,
                    ctx,
                    payload.runId,
                    "knowledge:repair",
                    settings.provider.llmModel,
                    provider,
                    generatedKnowledgeSchema,
                    (operationKey) =>
                      generateCanonicalKnowledge(
                        provider,
                        settings.provider.llmModel,
                        operationKey,
                        repair,
                        "class_knowledge_content_repair",
                      ),
                  ));
                if (!priorRepair) knowledgeDispatched = true;
                // A complete second response is final: no recursive regeneration or translation.
                validated = validateGeneratedKnowledge(
                  repaired,
                  extracted,
                  missing,
                  settings.explanationLanguage,
                );
              } else {
                const repair = buildKnowledgeRepairInput(
                  {
                    sources: extracted,
                    explanationLanguage: settings.explanationLanguage,
                    teachingPreferences: settings.teachingPreferences,
                    ...(teaching ? { learnerContext: teaching } : {}),
                    missingSourceIds: missing,
                    lessonContext,
                  },
                  settings.provider.maxInputCharacters,
                );
                const priorRepair = await cached(
                  job.db,
                  payload.runId,
                  "knowledge:repair",
                  repair.schema,
                );
                const corrected =
                  priorRepair ??
                  (await providerStep(
                    job,
                    ctx,
                    payload.runId,
                    "knowledge:repair",
                    settings.provider.llmModel,
                    provider,
                    repair.schema,
                    (operationKey) =>
                      provider.structured({
                        operationKey,
                        model: settings.provider.llmModel,
                        schema: repair.schema,
                        schemaName: "class_knowledge_repair",
                        system: [
                          knowledgePrompt(
                            settings.explanationLanguage,
                            settings.teachingPreferences.shorterExamples,
                            settings.provider.maxOutputTokens,
                            true,
                            teaching,
                          ),
                          repair.system,
                        ].join(" "),
                        input: repair.input,
                      }),
                  ));
                if (!priorRepair) knowledgeDispatched = true;
                const studyMismatch = (error: unknown) =>
                  semanticRepairReason(error) === "study_sentence_mismatch";
                // The repaired lesson as returned (or translated), kept for an answer-span repair.
                let candidate: unknown = corrected;
                let repaired: ReturnType<typeof repair.decode> | null = null;
                try {
                  repaired = repair.decode(corrected);
                } catch (error) {
                  if (!studyMismatch(error)) {
                    if (semanticRepairReason(error) !== "language_script_mismatch") throw error;
                    // A language correction is permitted only after the immutable canonical
                    // result has passed every earlier non-language evidence/attribution check.
                    repair.assertLanguageRepairEvidence(corrected);
                    if (!priorRepair) {
                      return "checkpoint";
                    }
                    const translation = buildKnowledgeTranslationInput(
                      corrected,
                      settings.explanationLanguage,
                      settings.provider.maxInputCharacters,
                      declaredTeachingContext(teaching),
                    );
                    const priorTranslation = await cached(
                      job.db,
                      payload.runId,
                      "knowledge:repair-language",
                      translation.schema,
                    );
                    const translated =
                      priorTranslation ??
                      (await providerStep(
                        job,
                        ctx,
                        payload.runId,
                        "knowledge:repair-language",
                        settings.provider.llmModel,
                        provider,
                        translation.schema,
                        (operationKey) =>
                          provider.structured({
                            operationKey,
                            model: settings.provider.llmModel,
                            schema: translation.schema,
                            schemaName: "class_knowledge_translation",
                            system: `${translation.system} The response has a hard limit of ${settings.provider.maxOutputTokens} output tokens. Aim for at most ${Math.floor(settings.provider.maxOutputTokens * 0.75)} output tokens and finish the entire valid JSON object.`,
                            input: translation.input,
                          }),
                      ));
                    if (!priorTranslation) knowledgeDispatched = true;
                    candidate = translation.apply(translated);
                    // No second translation: only the bounded answer-span repair below remains.
                    try {
                      repaired = repair.decode(candidate);
                    } catch (translatedError) {
                      if (!studyMismatch(translatedError)) throw translatedError;
                    }
                  }
                }
                let accepted: ReturnType<typeof validateGeneratedKnowledge> | null = null;
                if (repaired)
                  try {
                    accepted = validateGeneratedKnowledge(
                      repaired,
                      extracted,
                      missing,
                      settings.explanationLanguage,
                    );
                  } catch (error) {
                    if (!studyMismatch(error)) throw error;
                  }
                if (accepted) validated = accepted;
                else {
                  // A repaired lesson whose remaining problem is a gap that no longer matches its
                  // sentence gets the same single answer-span repair a first response would. Only
                  // gap fields change, and the full validation below runs again on the result.
                  if (knowledgeDispatched) {
                    return "checkpoint";
                  }
                  const studyRepair = buildKnowledgeStudyRepairInput(
                    repaired ?? repair.expanded(candidate),
                    settings.provider.maxInputCharacters,
                    declaredTeachingContext(teaching),
                  );
                  const priorStudyRepair = await cached(
                    job.db,
                    payload.runId,
                    "knowledge:study-repair",
                    studyRepair.schema,
                  );
                  const answerParts =
                    priorStudyRepair ??
                    (await providerStep(
                      job,
                      ctx,
                      payload.runId,
                      "knowledge:study-repair",
                      settings.provider.llmModel,
                      provider,
                      studyRepair.schema,
                      (operationKey) =>
                        provider.structured({
                          operationKey,
                          model: settings.provider.llmModel,
                          schema: studyRepair.schema,
                          schemaName: "class_study_sentence_repair",
                          system: studyRepair.system,
                          input: studyRepair.input,
                        }),
                    ));
                  if (!priorStudyRepair) knowledgeDispatched = true;
                  validated = validateGeneratedKnowledge(
                    studyRepair.apply(answerParts),
                    extracted,
                    missing,
                    settings.explanationLanguage,
                  );
                }
              }
            }
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
