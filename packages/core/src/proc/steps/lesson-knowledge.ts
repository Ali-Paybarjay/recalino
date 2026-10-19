import { ProviderError } from "../../aip";
import { sourceClassificationPrompt } from "../../src";
import { generatedKnowledgeSchema, legacyKnowledgeWireSchema } from "../generated-knowledge";
import {
  compactKnowledgeBudget,
  compactKnowledgeInstruction,
  knowledgeTruncationSchema,
} from "../knowledge-compact";
import { buildKnowledgeGenerationInput } from "../knowledge-generation";
import {
  generateCanonicalKnowledge,
  knowledgeSchemaFailureSchema,
} from "../knowledge-generation-step";
import { knowledgeInputContextSchema } from "../knowledge-input-context";
import { buildKnowledgeStudyRepairInput } from "../knowledge-study-repair";
import { declaredTeachingContext } from "../learner-context";
import type { ProcessingStage } from "./context";
import {
  knowledgePrompt,
  semanticRepairReason,
  validateGeneratedKnowledge,
} from "./knowledge-checks";
import {
  type KnowledgeDispatch,
  repairLegacyKnowledge,
  type ValidatedKnowledge,
} from "./legacy-knowledge-repair";
import type { LessonInput } from "./lesson-input";
import { cached, providerStep, saveStep } from "./runtime";

/**
 * A lesson taught in one call (audit QUA-01, moved from processingJob): the saved or newly paid
 * generation, its single compact or schema recovery, and one bounded repair after a known
 * semantic failure. Every paid result is saved before the next call gets its own job.
 */
export const generateLessonKnowledge: ProcessingStage<
  { lesson: LessonInput; dispatch: KnowledgeDispatch },
  "checkpoint" | ValidatedKnowledge
> = async (run, { lesson, dispatch }) => {
  const { job, ctx, payload, provider, settings } = run;
  const {
    extracted,
    missing,
    lessonContext,
    teaching,
    generationData,
    compactGeneration,
    qualityOptions,
    knowledgeInput,
  } = lesson;
  const priorKnowledge = await cached(job.db, payload.runId, "knowledge", generatedKnowledgeSchema);
  dispatch.knowledgeDispatched = !priorKnowledge;
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
      ? buildKnowledgeGenerationInput(generationData, settings.provider.maxInputCharacters, {
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
        })
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
                  ...(compact ? [compactKnowledgeInstruction(settings.explanationLanguage)] : []),
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
    return validateGeneratedKnowledge(generated, extracted, missing, settings.explanationLanguage);
  } catch (error) {
    // Only a complete, saved response with a known semantic failure permits repair.
    // Provider uncertainty, changed settings and account/source failures never enter here.
    if (!semanticRepairReason(error)) throw error;
    // A known invalid response or truncation and its recovery consume both
    // content-contract attempts. Never buy a third generation after semantic validation.
    if (
      compactGeneration &&
      ((await cached(job.db, payload.runId, "knowledge:truncated", knowledgeTruncationSchema)) ||
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
      if (!priorStudyRepair) dispatch.knowledgeDispatched = true;
      // Only gap fields change. A remaining semantic failure stops this attempt;
      // it never triggers a second repair or regenerates the saved lesson.
      return validateGeneratedKnowledge(
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
      if (!priorRepair) dispatch.knowledgeDispatched = true;
      // A complete second response is final: no recursive regeneration or translation.
      return validateGeneratedKnowledge(repaired, extracted, missing, settings.explanationLanguage);
    } else {
      return repairLegacyKnowledge(run, { lesson, dispatch });
    }
  }
};
