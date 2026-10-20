import "server-only";

/**
 * Approved by the owner on 2026-10-12 and on by default; each has a kill switch:
 * - D60 `RECALINO_CAPTURE_EARLY_UPLOAD=off`: sealed parts wait for Stop again.
 * - D61 `RECALINO_CAPTURE_EARLY_TRANSCRIPTION=off`: staged parts wait for the class run.
 * PERF-01: its own module, so the learner layout reads the flags without the audio preparer.
 */
export function captureFlags() {
  const earlyUpload = process.env.RECALINO_CAPTURE_EARLY_UPLOAD !== "off";
  return {
    earlyUpload,
    earlyTranscription: earlyUpload && process.env.RECALINO_CAPTURE_EARLY_TRANSCRIPTION !== "off",
  };
}
