import type { z } from "zod";
import { effectiveStructuredMaxOutputTokens, ProviderError } from "../../aip";
import { generatedKnowledgeSchema } from "../generated-knowledge";
import {
  type AssemblyTolerance,
  buildKnowledgeGenerationInput,
  knowledgeRepairDetailSchema,
} from "../knowledge-generation";
import {
  generateCanonicalKnowledge,
  knowledgeSchemaFailureSchema,
} from "../knowledge-generation-step";
import { type LessonPart, mergeLessonParts } from "../knowledge-parts";
import { lessonBudget, lessonProductionLimit, measureLessonContent } from "../lesson-budget";
import { combineStudyOutputAudits, type StudyOutputAudit } from "../study-output-guard";
import type { ProcessingStage } from "./context";
import { semanticRepairReason, validateGeneratedKnowledge } from "./knowledge-checks";
import type { ValidatedKnowledge } from "./legacy-knowledge-repair";
import type { LessonInput } from "./lesson-input";
import { cached, liveRun, providerStep, saveStep } from "./runtime";
import { assemblyOmissions, preferRepaired, saveAssemblyOmissions } from "./study-output";

/**
 * D63: each part has one paid generation and at most one bounded regeneration, each
 * saved before the next call; a job returns after any paid call. Parts are merged by
 * code, so no further provider call and no extra quota charge follows.
 * D110: each part response is checked with its own limit and allowance; invalid cards within
 * the allowance are dropped without the part's regeneration, and the pruned part is merged, so
 * a dropped card never takes a merged slot. Only the merged lesson keeps the production floor.
 */
export const generateLessonParts: ProcessingStage<
  { lesson: LessonInput; plan: LessonPart[] },
  "checkpoint" | { knowledge: z.infer<typeof generatedKnowledgeSchema>; audit: StudyOutputAudit }
> = async (run, { lesson, plan }) => {
  const { job, ctx, payload, provider, settings } = run;
  const { generationData, quality } = lesson;
  const outputs: z.infer<typeof generatedKnowledgeSchema>[] = [];
  const audits: StudyOutputAudit[] = [];
  const model = settings.provider.llmModel;
  const outputTokens = effectiveStructuredMaxOutputTokens(settings.provider, model);
  for (const part of plan) {
    const partData = {
      ...generationData,
      sources: part.sources,
      missingSourceIds: part.missingSourceIds,
    };
    const budget = lessonBudget(
      outputTokens,
      measureLessonContent(part.sources, settings.provider.charactersPerPage),
    );
    const partOptions = {
      maxOutputTokens: outputTokens,
      budget,
      sourceCoverage: quality?.sourceCoverage ?? false,
    };
    const step = `knowledge:part:${part.index}`;
    const repairStep = `${step}:repair`;
    // D78: a part is checked against its own marked spans.
    const check = async (checkpoint: string, value: z.infer<typeof generatedKnowledgeSchema>) => {
      const checks = {
        productionLimit: lessonProductionLimit(budget.content.markedSpans),
        salvage: true,
        floor: false,
        assemblyOmitted: await assemblyOmissions(job.db, payload.runId, checkpoint),
      };
      return () =>
        validateGeneratedKnowledge(
          value,
          part.sources,
          part.missingSourceIds,
          settings.explanationLanguage,
          checks,
        );
    };
    const keep = (validated: ValidatedKnowledge) => {
      outputs.push({ ...validated.model, sourceClassifications: validated.sourceClassifications });
      audits.push(validated.audit);
    };
    const output = await cached(job.db, payload.runId, step, generatedKnowledgeSchema);
    const original = output ? await check(step, output) : null;
    const repaired = await cached(job.db, payload.runId, repairStep, generatedKnowledgeSchema);
    if (repaired) {
      // A part's single regeneration is final: the bounded repair, or the bounded original
      // when it keeps more cards; a remaining problem fails the run.
      const validate = await check(repairStep, repaired);
      const chosen = await preferRepaired(original, async () => validate());
      if (chosen === "checkpoint") return chosen;
      keep(chosen);
      continue;
    }
    let repairReason: string;
    let repairDetail: string | undefined;
    if (!original) {
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
        const tolerance: AssemblyTolerance = {};
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
              generateCanonicalKnowledge(
                provider,
                model,
                operationKey,
                generation,
                undefined,
                tolerance,
              ),
            {
              singleResponse: true,
              onCommit: (tx) =>
                saveAssemblyOmissions(tx, payload.runId, step, tolerance, job.now()),
            },
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
        // D110 drop first: invalid cards within the part's allowance need no regeneration.
        keep(original());
        continue;
      } catch (error) {
        const reason = semanticRepairReason(error);
        if (!reason) throw error;
        repairReason = reason;
      }
    }
    const generation = buildKnowledgeGenerationInput(
      partData,
      settings.provider.maxInputCharacters,
      { ...partOptions, repairReason, ...(repairDetail ? { repairDetail } : {}) },
    );
    const tolerance: AssemblyTolerance = {};
    const bought = await preferRepaired(original, async () => {
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
            tolerance,
          ),
        {
          singleResponse: true,
          onCommit: (tx) =>
            saveAssemblyOmissions(tx, payload.runId, repairStep, tolerance, job.now()),
        },
      );
      return "checkpoint";
    });
    if (bought === "checkpoint") return bought;
    keep(bought);
  }
  // D78: the lesson keeps a card for each marked span, within its raised limit.
  return {
    knowledge: mergeLessonParts(outputs, lesson.productionLimit),
    audit: combineStudyOutputAudits(lesson.productionLimit, audits),
  };
};
