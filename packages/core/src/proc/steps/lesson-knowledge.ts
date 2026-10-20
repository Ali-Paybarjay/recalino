import { z } from "zod";
import { ProviderError } from "../../aip";
import { sourceClassificationPrompt } from "../../src";
import { generatedKnowledgeSchema, legacyKnowledgeWireSchema } from "../generated-knowledge";
import {
  compactKnowledgeBudget,
  compactKnowledgeInstruction,
  knowledgeTruncationSchema,
} from "../knowledge-compact";
import { type AssemblyTolerance, buildKnowledgeGenerationInput } from "../knowledge-generation";
import {
  generateCanonicalKnowledge,
  knowledgeSchemaFailureSchema,
} from "../knowledge-generation-step";
import { knowledgeInputContextSchema } from "../knowledge-input-context";
import { buildKnowledgeStudyRepairInput } from "../knowledge-study-repair";
import { declaredTeachingContext } from "../learner-context";
import type { AssemblyOmissions } from "../study-output-guard";
import type { ProcessingRun, ProcessingStage } from "./context";
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
import { assemblyOmissions, preferRepaired, saveAssemblyOmissions } from "./study-output";

type GeneratedKnowledge = z.output<typeof generatedKnowledgeSchema>;
type LessonKnowledgeInput = { lesson: LessonInput; dispatch: KnowledgeDispatch };

/** QUA-01: the legacy-contract lesson, asked in one structured call. */
function legacyKnowledgeRequest(
  run: ProcessingRun,
  lesson: LessonInput,
  compact: unknown,
  operationKey: string,
) {
  const { provider, settings } = run;
  const { teaching, knowledgeInput } = lesson;
  return provider.structured({
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
  });
}

/**
 * QUA-01: the newly paid first response, or its single compact or schema recovery. After a
 * known truncated or invalid paid response the job ends, so the recovery gets its own job.
 */
async function buyLessonKnowledge(
  run: ProcessingRun,
  lesson: LessonInput,
): Promise<"checkpoint" | GeneratedKnowledge> {
  const { job, ctx, payload, provider, settings } = run;
  const { lessonContext, generationData, compactGeneration, qualityOptions } = lesson;
  const compact = await cached(
    job.db,
    payload.runId,
    "knowledge:truncated",
    knowledgeTruncationSchema,
  );
  const schemaFailure = compactGeneration
    ? await cached(job.db, payload.runId, "knowledge:schema-invalid", knowledgeSchemaFailureSchema)
    : null;
  // D110: items the assembly cannot expand are omitted within the response's allowance.
  const tolerance: AssemblyTolerance = {};
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
    return await providerStep(
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
              undefined,
              tolerance,
            )
          : legacyKnowledgeRequest(run, lesson, compact, operationKey),
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
          // Whichever step bought it, the lesson is validated as the "knowledge" checkpoint.
          await saveAssemblyOmissions(tx, payload.runId, "knowledge", tolerance, job.now());
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
        (await cached(job.db, payload.runId, "knowledge:truncated", knowledgeTruncationSchema))) ||
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

/** D110: the saved lesson's own bounded check, used first and as the repair's fallback. */
function originalCheck(
  run: ProcessingRun,
  lesson: LessonInput,
  generated: GeneratedKnowledge,
  assemblyOmitted: AssemblyOmissions | null,
) {
  return () =>
    validateGeneratedKnowledge(
      generated,
      lesson.extracted,
      lesson.missing,
      run.settings.explanationLanguage,
      { productionLimit: lesson.productionLimit, salvage: true, assemblyOmitted },
    );
}

/** QUA-01: one bounded repair of a saved lesson's answer spans; only gap fields change. */
async function repairStudySentences(
  run: ProcessingRun,
  { lesson, dispatch }: LessonKnowledgeInput,
  generated: GeneratedKnowledge,
) {
  const { job, ctx, payload, provider, settings } = run;
  const { extracted, missing, teaching } = lesson;
  // The answer-span targets come from the saved response as it was paid for, unchanged by the
  // D110 guard, so a saved repair keeps parsing across deploys.
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
    {
      productionLimit: lesson.productionLimit,
      salvage: true,
      assemblyOmitted: await assemblyOmissions(job.db, payload.runId, "knowledge"),
    },
  );
}

/** QUA-01: the single content-contract regeneration after a known semantic failure. */
async function regenerateLessonKnowledge(
  run: ProcessingRun,
  { lesson, dispatch }: LessonKnowledgeInput,
  error: unknown,
) {
  const { job, ctx, payload, provider, settings } = run;
  const { extracted, missing, generationData, qualityOptions } = lesson;
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
  const tolerance: AssemblyTolerance = {};
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
          tolerance,
        ),
      {
        onCommit: (tx) =>
          saveAssemblyOmissions(tx, payload.runId, "knowledge:repair", tolerance, job.now()),
      },
    ));
  if (!priorRepair) dispatch.knowledgeDispatched = true;
  // A complete second response is final: no recursive regeneration or translation.
  return validateGeneratedKnowledge(repaired, extracted, missing, settings.explanationLanguage, {
    productionLimit: lesson.productionLimit,
    salvage: true,
    assemblyOmitted: await assemblyOmissions(job.db, payload.runId, "knowledge:repair"),
  });
}

type RepairRoute = "study" | "regenerate" | "legacy";

/** Whether a known truncated or invalid first response already used both content attempts. */
async function bothAttemptsUsed(run: ProcessingRun, lesson: LessonInput) {
  const { job, payload } = run;
  return (
    lesson.compactGeneration &&
    Boolean(
      (await cached(job.db, payload.runId, "knowledge:truncated", knowledgeTruncationSchema)) ||
        (await cached(
          job.db,
          payload.runId,
          "knowledge:schema-invalid",
          knowledgeSchemaFailureSchema,
        )),
    )
  );
}

/**
 * D110: a repair this run already paid for keeps its route, whatever the guard now finds first,
 * so a deploy never turns a saved repair into a refused second dispatch.
 */
async function savedRepairRoute(
  run: ProcessingRun,
  lesson: LessonInput,
): Promise<RepairRoute | null> {
  const { job, payload } = run;
  const saved = async (step: string) =>
    (await cached(job.db, payload.runId, step, z.unknown())) !== null;
  // The legacy chain may end with its own answer-span repair of the corrected lesson.
  if (!lesson.compactGeneration && (await saved("knowledge:repair"))) return "legacy";
  if (await bothAttemptsUsed(run, lesson)) return null;
  if (await saved("knowledge:study-repair")) return "study";
  if (await saved("knowledge:repair")) return "regenerate";
  return null;
}

/** The one bounded repair on its route; its result is final (D110: or the bounded original). */
function runRepair(
  run: ProcessingRun,
  input: LessonKnowledgeInput,
  route: RepairRoute,
  failure: { error: unknown; generated: GeneratedKnowledge },
  original: () => ValidatedKnowledge,
) {
  return preferRepaired(original, async () =>
    route === "study"
      ? repairStudySentences(run, input, failure.generated)
      : route === "regenerate"
        ? regenerateLessonKnowledge(run, input, failure.error)
        : repairLegacyKnowledge(run, input),
  );
}

/** QUA-01: the one bounded repair of a complete, saved lesson after a known semantic failure. */
async function repairLessonKnowledge(
  run: ProcessingRun,
  input: LessonKnowledgeInput,
  failure: { error: unknown; generated: GeneratedKnowledge; priorKnowledge: unknown },
  original: () => ValidatedKnowledge,
): Promise<"checkpoint" | ValidatedKnowledge> {
  const { compactGeneration } = input.lesson;
  const { error, priorKnowledge } = failure;
  // Only a complete, saved response with a known semantic failure permits repair.
  // Provider uncertainty, changed settings and account/source failures never enter here.
  if (!semanticRepairReason(error)) throw error;
  // A known invalid response or truncation and its recovery consume both
  // content-contract attempts. Never buy a third generation after semantic validation.
  if (await bothAttemptsUsed(run, input.lesson)) throw error;
  // Persist each paid result before the next provider call gets its own job budget.
  if (!priorKnowledge) {
    return "checkpoint";
  }
  const route: RepairRoute =
    semanticRepairReason(error) === "study_sentence_mismatch"
      ? "study"
      : compactGeneration
        ? "regenerate"
        : "legacy";
  return runRepair(run, input, route, failure, original);
}

/**
 * A lesson taught in one call (audit QUA-01, moved from processingJob): the saved or newly paid
 * generation, its single compact or schema recovery, and one bounded repair after a known
 * semantic failure. Every paid result is saved before the next call gets its own job.
 */
export const generateLessonKnowledge: ProcessingStage<
  LessonKnowledgeInput,
  "checkpoint" | ValidatedKnowledge
> = async (run, { lesson, dispatch }) => {
  const { job, payload } = run;
  const priorKnowledge = await cached(job.db, payload.runId, "knowledge", generatedKnowledgeSchema);
  dispatch.knowledgeDispatched = !priorKnowledge;
  let generated = priorKnowledge;
  if (!generated) {
    const bought = await buyLessonKnowledge(run, lesson);
    if (bought === "checkpoint") return "checkpoint";
    generated = bought;
  }
  const input = { lesson, dispatch };
  const original = originalCheck(
    run,
    lesson,
    generated,
    await assemblyOmissions(job.db, payload.runId, "knowledge"),
  );
  // D110: a repair already paid for this run is used, compared with the bounded original.
  const route = priorKnowledge ? await savedRepairRoute(run, lesson) : null;
  if (route) {
    let error: unknown = null;
    try {
      original();
    } catch (failure) {
      // Kept for the route's request; a saved repair is used as it was paid for.
      error = failure;
    }
    return runRepair(run, input, route, { error, generated }, original);
  }
  try {
    // D110 drop first: invalid cards within the allowance are dropped without a paid repair.
    return original();
  } catch (error) {
    return await repairLessonKnowledge(run, input, { error, generated, priorKnowledge }, original);
  }
};
