import { buildKnowledgeRepairInput } from "../knowledge-repair";
import { buildKnowledgeStudyRepairInput } from "../knowledge-study-repair";
import { buildKnowledgeTranslationInput } from "../knowledge-translation";
import { declaredTeachingContext } from "../learner-context";
import type { ProcessingStage } from "./context";
import {
  knowledgePrompt,
  semanticRepairReason,
  validateGeneratedKnowledge,
} from "./knowledge-checks";
import type { LessonInput } from "./lesson-input";
import { cached, providerStep } from "./runtime";

/** The lesson's validated knowledge, as validateGeneratedKnowledge returns it. */
export type ValidatedKnowledge = ReturnType<typeof validateGeneratedKnowledge>;
/** Whether this job already paid for a lesson call; the voice correction then waits for the next. */
export interface KnowledgeDispatch {
  knowledgeDispatched: boolean;
}

/**
 * The bounded repair of a lesson generated with the legacy wire contract (audit QUA-01, moved
 * from processingJob): one paid corrected response, one translation when only the explanation
 * language was wrong, and one answer-span repair; each paid result is saved before the next call.
 */
export const repairLegacyKnowledge: ProcessingStage<
  { lesson: LessonInput; dispatch: KnowledgeDispatch },
  "checkpoint" | ValidatedKnowledge
> = async (run, { lesson, dispatch }) => {
  const { job, ctx, payload, provider, settings } = run;
  const { extracted, missing, lessonContext, teaching } = lesson;
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
  const priorRepair = await cached(job.db, payload.runId, "knowledge:repair", repair.schema);
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
  if (!priorRepair) dispatch.knowledgeDispatched = true;
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
      if (!priorTranslation) dispatch.knowledgeDispatched = true;
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
  if (accepted) return accepted;
  else {
    // A repaired lesson whose remaining problem is a gap that no longer matches its
    // sentence gets the same single answer-span repair a first response would. Only
    // gap fields change, and the full validation below runs again on the result.
    if (dispatch.knowledgeDispatched) {
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
    if (!priorStudyRepair) dispatch.knowledgeDispatched = true;
    return validateGeneratedKnowledge(
      studyRepair.apply(answerParts),
      extracted,
      missing,
      settings.explanationLanguage,
    );
  }
};
