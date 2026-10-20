import { GENERATED_IDENTITY_VERSION, publishKnowledgeVersion } from "../../lkm";
import { amountsSchema } from "../../quota";
import { assertSourcesLive, updateAutomaticSourceRoles } from "../../src";
import { settleClassMaterial } from "../charged-material";
import type { finalizeGeneratedStudyPractice } from "../generated-study-practice";
import { teachingAdaptation } from "../learner-context";
import type { StudyOutputAudit } from "../study-output-guard";
import type { ProcessingStage } from "./context";
import type { ValidatedKnowledge } from "./legacy-knowledge-repair";
import type { LessonInput } from "./lesson-input";
import { liveRun } from "./runtime";

type FinalizedPractice = ReturnType<typeof finalizeGeneratedStudyPractice>;

/**
 * The last lesson stage (audit QUA-01, moved from processingJob): in one transaction, with the
 * sources still live, it records the sources' roles, publishes the knowledge version, charges
 * only material no earlier publication paid for (D59) and marks the run ready.
 */
export const publishLesson: ProcessingStage<
  {
    lesson: LessonInput;
    classified: ValidatedKnowledge["classified"];
    model: FinalizedPractice["model"];
    practiceAudit: FinalizedPractice["audit"];
    /** D110: the study output guard's code-owned counts; recorded whenever the guard ran. */
    studyOutput: StudyOutputAudit;
  },
  "published"
> = async (run, { lesson, classified, model, practiceAudit, studyOutput }) => {
  const { job, ctx, payload, provider, settings, snapshot } = run;
  const { extracted, missing, practiceFocus } = lesson;
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
          studyOutput,
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
