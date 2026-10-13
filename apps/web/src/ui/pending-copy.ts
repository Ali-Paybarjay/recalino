/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
import { lessonQualityCopy } from "./workspace/lesson-quality-copy";

export const pendingCopy = {
  /** Workstream 1, upload reliability (2026-10-12). */
  uploadReliability: {
    audio: {
      uploadClosed:
        "This audio upload has ended, so retrying it here cannot work. Your original is still saved on this device. Open processing to see the next step.",
      notStarted:
        "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
      incomplete:
        "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
    },
    automatic: {
      notStarted:
        "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
      incomplete:
        "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
    },
  },
  // Workstream 4 (voice detection, 2026-10-12): one confirmation per class (D64) and line-level
  // choices from target-speaker turns (D64). Reviewed by the owner once at the end (D65).
  voiceDetection: {
    classHeading: "Your voice in this class",
    classIntro:
      "Recalino matched the same voices across this class's recordings. Confirm your voice once for the whole class.",
    heardIn: "Heard in {count} of {total} recordings",
    ambiguous:
      "This voice sounded like more than one voice in another recording, so those recordings were not joined. Check them separately below.",
    classConfirmed: "Your voice is confirmed for this whole class.",
    coveredByClass: "Your choice for the whole class above covers this recording.",
    shortVoices: "Short voices ({count})",
    shortVoicesDetail:
      "These voices have too little clear speech to suggest. Choose one only if you recognise it.",
    linesHeading: "Lines that may be yours",
    linesIntro:
      "These short lines sound like your voice sample. Mark the lines you said. Only lines you mark can add spoken mistakes.",
    lineMine: "This is me",
    lineNotMine: "Not me",
    lineUndo: "Undo",
    lineMarkedMine: "Marked as yours",
    lineMarkedNotMine: "Marked as not yours",
  },
  lessonQuality: lessonQualityCopy,
  /** Workstream 5, session navigation and next step (2026-10-12). */
  sessionNavigation: {
    nextStep: "Next step",
    uploadCount: "{sent} of {total} files sent.",
    audioNotReceived:
      "Your saved audio did not reach Recalino. Retry to send it again from this device; your material is still saved.",
    savedOnDevice: {
      heading: "Saved on this device",
      online: "Your recording uploads automatically while this app is open.",
      offline: "Your recording uploads when this device is back online. Keep this app open.",
    },
    capture: {
      background: "Finished parts upload in the background. Keep recording; nothing interrupts it.",
      lastPart: "Sending the last part",
      lastPartDetail: "The other parts are already sent. Keep this app open until it finishes.",
    },
    voiceCheck: {
      heading: "Finishing your notes",
      detail:
        "Your lesson is written. Recalino is checking the voices in your recording before it shows the notes. This can take a few minutes; you can leave this page.",
    },
    voice: {
      action: "Confirm your voice",
      ready: "Your notes are ready. Confirming your voice in this session is optional.",
      cardBody:
        "Optional: listen to a few excerpts and confirm which voice is yours, so spoken mistakes can be included. Your notes are already available.",
    },
  },
  // Workstream 2, in-app recording (feat/recording-capture): shown only after Stop (PRD-REC-02).
  recordingCapture: {
    missingSummary: "Part of this class was not recorded: about {minutes} min in total.",
    missingInterval: "About {minutes} min missing from {time}.",
    missingHint:
      "This usually happens when the screen locks or another app uses the microphone. Keep Recalino open and the screen on during class.",
    partMissing: "{minutes} min not recorded",
  },
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
