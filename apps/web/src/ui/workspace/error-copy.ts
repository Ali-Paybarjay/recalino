/**
 * Request error copy approved word for word by the product owner on 2026-10-19 (audit batch 5,
 * UX-12, D86; audit batch 9, UX-05, D89; docs/design/UI_COPY_PENDING.md).
 */
export const workspaceErrors = {
  // The server asks for a new confirmation only in the old manual flow; today the learner retries.
  sourcesChanged: "The selected sources have changed. Check your session material, then try again.",
  // D89 (owner decision 2026-10-19; UX-05): a provider result the operator still has to check.
  // The learner should not retry until the operator has looked, so this is not "Try again".
  outcomeUnresolved:
    "A result is still being checked. Contact the pilot operator before trying again.",
} as const;
