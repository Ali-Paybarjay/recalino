import type { z } from "zod";
import { effectiveStructuredMaxOutputTokens, ProviderError } from "../../aip";
import { generatedKnowledgeSchema } from "../generated-knowledge";
import {
  buildKnowledgeGenerationInput,
  knowledgeRepairDetailSchema,
} from "../knowledge-generation";
import {
  generateCanonicalKnowledge,
  knowledgeSchemaFailureSchema,
} from "../knowledge-generation-step";
import { type LessonPart, mergeLessonParts } from "../knowledge-parts";
import { lessonBudget, lessonProductionLimit, measureLessonContent } from "../lesson-budget";
import type { ProcessingStage } from "./context";
import { semanticRepairReason, validateGeneratedKnowledge } from "./knowledge-checks";
import type { LessonInput } from "./lesson-input";
import { cached, liveRun, providerStep, saveStep } from "./runtime";

/**
 * D63: each part has one paid generation and at most one bounded regeneration, each
 * saved before the next call; a job returns after any paid call. Parts are merged by
 * code, so no further provider call and no extra quota charge follows.
 */
export const generateLessonParts: ProcessingStage<
  { lesson: LessonInput; plan: LessonPart[] },
  "checkpoint" | z.infer<typeof generatedKnowledgeSchema>
> = async (run, { lesson, plan }) => {
  const { job, ctx, payload, provider, settings } = run;
  const { extracted, generationData, quality } = lesson;
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
            (operationKey) => generateCanonicalKnowledge(provider, model, operationKey, generation),
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
    const repaired = await cached(job.db, payload.runId, repairStep, generatedKnowledgeSchema);
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
