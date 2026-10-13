/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 *
 * Empty since the owner's review of 2026-10-13 (D65): the approved texts live in
 * workspace/upload-copy.ts, workspace/session-navigation-copy.ts, workspace/lesson-quality-copy.ts,
 * recording/recording-copy.ts and voice/voice-copy.ts.
 */
export const pendingCopy = {} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
