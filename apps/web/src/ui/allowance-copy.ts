/**
 * Learner-allowance stop messages live in `shared` so the server can use them too (RR-30, R-29).
 * Each pairs with its recovery actions in workspace/automatic-learning-recovery.ts.
 */
export { allowanceCopy } from "../shared/allowance-copy";

/**
 * The Allowance page's help paragraphs (UX-12), approved word for word by the product owner on
 * 2026-10-19 (audit batch 5, docs/design/UI_COPY_PENDING.md). `need` was corrected on 2026-10-20
 * (D107): processing starts only when the learner processes a session (D105).
 */
export const allowanceHelp = {
  need: "The pilot operator sets your allowance. Processing starts when you process a session, as long as your allowance covers it.",
  reserved:
    "Reserved allowance is held while your material is processed. Only usable published output is charged.",
} as const;
