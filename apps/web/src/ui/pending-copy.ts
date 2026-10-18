/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 *
 * The texts approved by the owner on 2026-10-13 (D65, then D72) and 2026-10-14 (D76) live in
 * workspace/upload-copy.ts, workspace/session-navigation-copy.ts, workspace/lesson-quality-copy.ts,
 * recording/recording-copy.ts and voice/voice-copy.ts.
 */
export const pendingCopy = {
  // Audit batch 4 (2026-10-18). Each text below replaces a wrong or missing one on the learner's
  // path and is registered for the owner's approval in docs/design/UI_COPY_PENDING.md.
  cardActions: {
    // UX-03: the Undo snackbar after Reject (frame E3 shows the same pattern for "Card suspended").
    rejected: "Card rejected",
  },
  termsAcceptance: {
    // UX-09: a processing stop caused by Terms that changed; the action is the "Read and accept" button.
    guidance: "Read and accept the updated Terms to continue.",
  },
  allowanceHelp: {
    // UX-12: processing is automatic, so the allowance page no longer speaks of confirming an estimate.
    need: "The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.",
    reserved:
      "Reserved allowance is held while your material is processed. Only usable published output is charged.",
  },
  workspaceErrors: {
    // UX-12: the server asks for a new "confirmation" only in the old manual flow; today the learner just retries.
    sourcesChanged:
      "The selected sources have changed. Check your session material, then try again.",
  },
  yourData: {
    // UX-14: the download is easy to miss on the session page, so the data page points to it.
    downloadFirst:
      "To keep a copy first, open a session, choose More session tools, then Download notes and cards.",
  },
  accountDeletion: {
    // UX-10: the request is saved but the server could not finish cleanup without the operator.
    needsOperator:
      "Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.",
  },
} as const;

/** Fills `{name}` placeholders of a pending text. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
