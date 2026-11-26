import type { RunSource } from "../contracts";
import { correctVoiceCandidates, processVoiceSource } from "../voice-processing";
import type { ProcessingStage } from "./context";
import type { ValidatedKnowledge } from "./legacy-knowledge-repair";
import { providerStep, reportStandAside } from "./runtime";
import type { VoiceCheck } from "./voice-check";

/**
 * The optional correction of the learner's own spoken mistakes (audit QUA-01, moved from
 * processingJob). It never shares a job with a newly paid lesson call or with an acoustic check
 * that saved its analysis in this job; any voice progress ends the job, so the lesson is
 * published by a later one. "unchanged" lets the lesson be published now.
 */
export const correctSpokenMistakes: ProcessingStage<
  {
    extracted: RunSource[];
    classified: ValidatedKnowledge["classified"];
    knowledgeDispatched: boolean;
    voiceCheck: VoiceCheck | null;
  },
  "checkpoint" | "unchanged"
> = async (run, { extracted, classified, knowledgeDispatched, voiceCheck }) => {
  const { job, ctx, payload, dependencies, provider, initial, settings } = run;
  if (dependencies.diarizeVoice) {
    // Optional correction must not share a job with a newly paid knowledge stage.
    if (knowledgeDispatched) {
      return "checkpoint";
    }
    // Nor with the acoustic check that ran in this job: the check is saved first.
    if (voiceCheck && (await voiceCheck.wait())) return "checkpoint";
    for (const source of extracted) {
      let voiceProgress: Awaited<ReturnType<typeof processVoiceSource>>;
      try {
        voiceProgress = await processVoiceSource({
          db: job.db,
          ctx,
          // P12-01 (AC-31, AC-35): each voice write only as the run's owner.
          job,
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
      } catch (error) {
        // A refused voice write ends the job here with its one stand-aside line (AC-31).
        reportStandAside(error);
        throw error;
      }
      if (voiceProgress !== "unchanged") {
        return "checkpoint";
      }
    }
  }
  return "unchanged";
};
