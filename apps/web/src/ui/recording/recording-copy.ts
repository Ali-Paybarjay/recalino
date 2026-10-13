/**
 * In-app recording copy (workstream 2, docs/plans/RECORDING_CAPTURE_2026-10-12.md), approved word
 * for word by the product owner on 2026-10-13 (D65 review). The missing-audio texts are shown only
 * after Stop (PRD-REC-02) and name the intervals the learner meant to record but no audio reached
 * the device (PRD-REC-03, PRD-REC-05). `{minutes}` is rounded up; `{time}` is the local start time.
 */
export const recordingCopy = {
  // Recording page introduction; replaced the pre-D60 "After Stop, all recorded parts are saved…"
  // text on the owner's decision of 2026-10-13 (parts are sent while recording, D60).
  introduction:
    "Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.",
  missingSummary: "Part of this class was not recorded: about {minutes} min in total.",
  missingInterval: "About {minutes} min missing from {time}.",
  missingHint:
    "This usually happens when the screen locks or another app uses the microphone. Keep Recalino open and the screen on during class.",
  partMissing: "{minutes} min not recorded",
} as const;
