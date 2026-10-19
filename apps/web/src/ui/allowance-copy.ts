/**
 * Learner-allowance stop messages (FR-QUOTA-003, FR-QUOTA-007, D59), approved word for word by the
 * product owner on 2026-10-11; "class" became "session" under the owner's vocabulary decision A
 * of 2026-10-19 (docs/design/UI_COPY_PENDING.md). Each pairs with its recovery actions in
 * workspace/automatic-learning-recovery.ts.
 */
export const allowanceCopy = {
  // A learner-allowance block names each short allowance and its amounts.
  shortage:
    "Your material is saved, but this session needs more allowance than is left. {items}. Ask the pilot operator for more allowance or select less material, then retry. You do not need to upload the same files again.",
  // One short allowance, e.g. "Class audio: 127 min 56 sec needed, 69 min 22 sec left".
  shortageItem: "{allowance}: {needed} needed, {left} left",
  // No active allowance period at all.
  none: "Your material is saved. You have no active processing allowance. Ask the pilot operator for an allowance, then retry. You do not need to upload the same files again.",
  // The allowance now covers the class, for example after an operator change or D59.
  covered:
    "Your material is saved. Your allowance now covers this session. Retry to create the notes and flashcards. You do not need to upload the same files again.",
} as const;

/**
 * The Allowance page's help paragraphs (UX-12), approved word for word by the product owner on
 * 2026-10-19 (audit batch 5, docs/design/UI_COPY_PENDING.md). Processing is automatic, so neither
 * speaks of confirming an estimate.
 */
export const allowanceHelp = {
  need: "The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.",
  reserved:
    "Reserved allowance is held while your material is processed. Only usable published output is charged.",
} as const;
