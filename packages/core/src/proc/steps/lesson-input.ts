import { effectiveStructuredMaxOutputTokens } from "../../aip";
import { getCourse, getSession } from "../../org";
import type { RunSource } from "../contracts";
import { usesContentKnowledgeContract } from "../knowledge-contract";
import { buildKnowledgeInput } from "../knowledge-input";
import { modelTeachingContext, selectPracticeFocus } from "../learner-context";
import { lessonBudget, measureLessonContent } from "../lesson-budget";
import type { ProcessingRun } from "./context";

/**
 * What every lesson stage reads (audit QUA-01, moved from processingJob): the extracted sources,
 * the lesson's date and course, the learner's frozen teaching context, and the input and limits
 * derived from the run's settings snapshot. Read again at each lesson stage, as before.
 */
export async function prepareLesson(run: ProcessingRun, extracted: RunSource[]) {
  const { job, ctx, initial, settings } = run;
  const missing = extracted
    .filter(
      (source) => !source.blocks.length || source.units.some((unit) => unit.status !== "extracted"),
    )
    .map((source) => source.sourceId);
  const lesson = await getSession(job.db, ctx, initial.session_id);
  const course = await getCourse(job.db, ctx, lesson.courseId);
  const lessonContext = {
    date: lesson.classDate,
    ...(course.isDefault ? {} : { course: course.name }),
  };
  // D49: memory points were frozen at run start; only those this class's extracted text
  // supports reach the model, without counts or dates.
  const practiceFocus = selectPracticeFocus(settings.learnerContext, extracted);
  const teaching = modelTeachingContext(settings.learnerContext, practiceFocus);
  const generationData = {
    explanationLanguage: settings.explanationLanguage,
    teachingPreferences: settings.teachingPreferences,
    ...(teaching ? { learnerContext: teaching } : {}),
    sources: extracted,
    missingSourceIds: missing,
    lessonContext,
  };
  // Selected from the run's settings snapshot; legacy snapshots keep their original
  // wire contract and rollback behavior.
  const compactGeneration = usesContentKnowledgeContract(settings.provider);
  // lesson-quality-1: limits from the lesson model's own output limit and the measured
  // material. Snapshots without it keep the fixed planning budget unchanged.
  const quality = settings.provider.lessonQuality;
  const qualityOptions = quality
    ? (() => {
        const outputTokens = effectiveStructuredMaxOutputTokens(
          settings.provider,
          settings.provider.llmModel,
        );
        return {
          maxOutputTokens: outputTokens,
          budget: lessonBudget(
            outputTokens,
            measureLessonContent(extracted, settings.provider.charactersPerPage),
          ),
          sourceCoverage: quality.sourceCoverage,
        };
      })()
    : {};
  const knowledgeInput = buildKnowledgeInput(generationData, settings.provider.maxInputCharacters);
  return {
    extracted,
    missing,
    lessonContext,
    practiceFocus,
    teaching,
    generationData,
    compactGeneration,
    quality,
    qualityOptions,
    knowledgeInput,
  };
}

/** Matches the shared ProcessingStage signature: (run, extracted sources) to this input. */
export type LessonInput = Awaited<ReturnType<typeof prepareLesson>>;
