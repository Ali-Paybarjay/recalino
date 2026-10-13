/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 *
 * The texts approved by the owner on 2026-10-13 (D65, then D72) live in workspace/upload-copy.ts,
 * workspace/session-navigation-copy.ts, workspace/lesson-quality-copy.ts,
 * recording/recording-copy.ts and voice/voice-copy.ts.
 */
export const pendingCopy = {
  // Owner decision 2026-10-13 (D72 follow-up): remove a board photo that exists only on this
  // device, from its row or the zoom sheet, after a confirmation.
  photoRemove: {
    action: "Remove this photo",
    confirm: "Remove this photo from this device?",
    notUploaded: "It has not been uploaded.",
    keep: "Keep",
  },
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
