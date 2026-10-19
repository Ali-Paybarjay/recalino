/**
 * Request error copy approved word for word by the product owner on 2026-10-19 (audit batch 5;
 * UX-12, docs/design/UI_COPY_PENDING.md). A D-number is assigned later.
 */
export const workspaceErrors = {
  // The server asks for a new confirmation only in the old manual flow; today the learner retries.
  sourcesChanged: "The selected sources have changed. Check your session material, then try again.",
} as const;
