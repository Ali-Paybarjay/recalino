/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
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
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
