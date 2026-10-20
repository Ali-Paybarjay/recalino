// The acoustic check run beside lesson generation (audit QUA-01). Moved verbatim from worker.ts.
import { readVoiceSettings } from "../../voc";
import type { RunSource } from "../contracts";
import {
  analyzeVoiceSources,
  voiceAnalysisPending,
  voiceDiarizationOptions,
} from "../voice-processing";
import { type ProcessingStage, YIELDED, type Yielded } from "./context";
import {
  checkpointAndContinue,
  hasTime,
  VOICE_ANALYSIS_TIME_MS,
  YIELD_DELAY_SECONDS,
} from "./runtime";

/**
 * The acoustic check of a run's audio, started while the lesson is generated. The native engine
 * runs in a worker thread, so the check and the provider calls do not wait for each other.
 */
export function startVoiceCheck(run: () => Promise<boolean>) {
  let running = true;
  const result = run().then(
    (analyzed) => ({ analyzed }),
    (error: unknown) => ({ error }),
  );
  void result.finally(() => {
    running = false;
  });
  return {
    running: () => running,
    /** True when the check saved an analysis in this job; rethrows the check's failure. */
    async wait(): Promise<boolean> {
      const outcome = await result;
      if ("error" in outcome) throw outcome.error;
      return outcome.analyzed;
    },
    /** Waits without rethrowing, when the job already fails for another reason. */
    async settle(): Promise<void> {
      await result;
    },
  };
}

/** The acoustic check of a run, as startVoiceCheck returns it. */
export type VoiceCheck = ReturnType<typeof startVoiceCheck>;

/**
 * Starts the run's acoustic check beside lesson generation when its audio still needs one (audit
 * QUA-01, moved from processingJob). Null when there is nothing to check; YIELDED when the check
 * cannot finish in this job and a fresh runner was queued.
 */
export const beginVoiceCheck: ProcessingStage<RunSource[], VoiceCheck | null | Yielded> = async (
  run,
  extracted,
) => {
  const { job, ctx, payload, definition, dependencies, initial, settings } = run;
  // A separate private projection; no identity or hidden correction enters knowledge input.
  // Its acoustic check runs while the lesson is generated rather than before it; it is
  // saved before the paid correction, which still keeps a job of its own.
  let voiceCheck: ReturnType<typeof startVoiceCheck> | null = null;
  const voiceSettings = readVoiceSettings();
  const diarize = dependencies.diarizeVoice;
  if (
    diarize &&
    (await voiceAnalysisPending(job.db, ctx, {
      sessionId: initial.session_id,
      runId: payload.runId,
      sources: extracted,
    }))
  ) {
    // A check this function could not finish is left to a fresh runner.
    if (!hasTime(job, VOICE_ANALYSIS_TIME_MS)) {
      await checkpointAndContinue(job, ctx, payload.runId, definition, YIELD_DELAY_SECONDS);
      return YIELDED;
    }
    // Recording parts are checked side by side; no paid correction runs here, so required
    // lesson generation gets cost headroom before this optional paid analysis.
    const options = voiceDiarizationOptions(voiceSettings, false);
    voiceCheck = startVoiceCheck(() =>
      analyzeVoiceSources({
        db: job.db,
        ctx,
        sessionId: initial.session_id,
        runId: payload.runId,
        sources: extracted,
        diarize,
        ...(options ? { options } : {}),
        explanationLanguage: settings.explanationLanguage,
        concurrency: voiceSettings.diarizationConcurrency,
        canStart: () => hasTime(job, VOICE_ANALYSIS_TIME_MS),
        now: job.now,
      }),
    );
  }
  return voiceCheck;
};
