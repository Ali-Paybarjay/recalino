/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 *
 * The texts approved by the owner on 2026-10-13 (D65, then D72) and 2026-10-14 (D76) live in
 * workspace/upload-copy.ts, workspace/session-navigation-copy.ts, workspace/lesson-quality-copy.ts,
 * recording/recording-copy.ts and voice/voice-copy.ts. The ten texts approved on 2026-10-19 (audit
 * batch 5, recorded in the register and checked by approved-copy.test.ts) live in
 * workspace/card-actions-copy.ts, learning-progress-copy.ts, privacy-copy.ts and error-copy.ts,
 * allowance-copy.ts and experience-copy.ts.
 */
export const pendingCopy = {} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
