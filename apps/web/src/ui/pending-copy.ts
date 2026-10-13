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
      rejected:
        "The audio could not be verified, so sending the same file again would stop at the same point. Open Review material to replace the audio or remove it from the selection.",
      notStarted:
        "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
      incomplete:
        "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
    },
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
  // Workstream 4, second round (2026-10-13): the voice sample recorded in class conditions
  // (owner's answer to question 8). Reviewed by the owner once at the end (D65).
  voiceSample: {
    classConditions:
      "Record this sample the way your classes are recorded: the same phone, placed where it is during class, in a room like your classroom. A sample recorded close to your mouth is harder to match with the recording of a class.",
    recordAgain: "Record a new sample",
    replaces:
      "A new sample replaces the saved one. Sessions matched with the old sample will ask you again.",
  },
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
