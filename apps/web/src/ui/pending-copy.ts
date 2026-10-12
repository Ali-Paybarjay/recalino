/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy: Record<string, unknown> = {
  // Workstream 2, in-app recording (feat/recording-capture): shown only after Stop (PRD-REC-02).
  recordingCapture: {
    missingSummary: "Part of this class was not recorded: about {minutes} min in total.",
    missingInterval: "About {minutes} min missing from {time}.",
    missingHint:
      "This usually happens when the screen locks or another app uses the microphone. Keep Recalino open and the screen on during class.",
    partMissing: "{minutes} min not recorded",
  },
};
