/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 *
 * The texts approved in the owner's review of 2026-10-13 (D65) live in workspace/upload-copy.ts,
 * workspace/session-navigation-copy.ts, workspace/lesson-quality-copy.ts,
 * recording/recording-copy.ts and voice/voice-copy.ts.
 */
export const pendingCopy = {
  // D72 layers 1 and 2 (feat/photo-readability, 2026-10-13): on-device photo readability, shown
  // only inside the photo row, never as a dialog, toast or sound (PRD-REC-02).
  photoQuality: {
    ok: "Looks sharp",
    blurry: "May be hard to read: blurry. Retake?",
    too_dark: "May be hard to read: too dark. Retake?",
    too_bright: "May be hard to read: washed out. Retake?",
    glare: "May be hard to read: glare on the board. Retake?",
    low_detail: "Hard to see writing in this photo. Move closer or retake?",
    retake: "Retake",
    zoomPrompt: "Can you read the smallest writing? If not, retake while the board is still there.",
  },
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
