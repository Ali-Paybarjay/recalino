import { normalizeGeneratedStudyModel } from "../../lkm";
import type { RunSource } from "../contracts";
import { finalizeGeneratedStudyPractice } from "../generated-study-practice";
import { planLessonParts } from "../knowledge-parts";
import type { ProcessingStage } from "./context";
import { validateGeneratedKnowledge } from "./knowledge-checks";
import type { ValidatedKnowledge } from "./legacy-knowledge-repair";
import { prepareLesson } from "./lesson-input";
import { generateLessonKnowledge } from "./lesson-knowledge";
import { generateLessonParts } from "./lesson-parts";
import { publishLesson } from "./publish";
import type { VoiceCheck } from "./voice-check";
import { correctSpokenMistakes } from "./voice-correction";

/**
 * One lesson stage (audit QUA-01, moved from processingJob): the lesson is taught part by part
 * (D63) or in one call, finalized, its spoken mistakes optionally corrected, then published.
 * "checkpoint" means a paid call or voice progress was saved and the next stage needs its own
 * call budget.
 */
export const teachLesson: ProcessingStage<
  { extracted: RunSource[]; voiceCheck: VoiceCheck | null },
  "checkpoint" | "published"
> = async (run, { extracted, voiceCheck }) => {
  const { settings } = run;
  const prepared = await prepareLesson(run, extracted);
  const { missing, lessonContext, compactGeneration, quality } = prepared;
  let knowledgeDispatched = false;
  let validated: ValidatedKnowledge;
  // D63: a class longer than one part is taught part by part and merged by code.
  const partPlan =
    compactGeneration && quality?.classPartMinutes
      ? planLessonParts(extracted, quality.classPartMinutes, missing)
      : null;
  if (partPlan) {
    const merged = await generateLessonParts(run, { lesson: prepared, plan: partPlan });
    if (merged === "checkpoint") return "checkpoint";
    validated = validateGeneratedKnowledge(
      merged,
      extracted,
      missing,
      settings.explanationLanguage,
    );
  } else {
    const dispatch = { knowledgeDispatched };
    const knowledge = await generateLessonKnowledge(run, { lesson: prepared, dispatch });
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
    (await correctSpokenMistakes(run, {
      extracted,
      classified,
      knowledgeDispatched,
      voiceCheck,
    })) === "checkpoint"
  )
    return "checkpoint";
  return publishLesson(run, { lesson: prepared, classified, model, practiceAudit });
};
