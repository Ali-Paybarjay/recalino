import type { CaptureState } from "./controller";

type Phase = CaptureState["phase"];

/**
 * Before the learner has pressed Stop: audio is being captured, paused, recovered or started.
 * PRD-REC-02 and HANDOFF §5 rule 1: nothing but a real capture failure may interrupt the learner
 * here, so every other message, toast and alert waits for the phases after this one.
 */
export function captureIsQuiet(phase: Phase): boolean {
  return (
    phase === "starting" || phase === "recording" || phase === "recovering" || phase === "paused"
  );
}

/** Capture still owns the microphone or the final audio parts, including the last save. */
export function captureIsActive(phase: Phase): boolean {
  return captureIsQuiet(phase) || phase === "saving";
}
