/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  allowance: {
    // FR-QUOTA-007, D59: a learner-allowance block names each short allowance and its amounts.
    shortage:
      "Your material is saved, but this class needs more allowance than is left. {items}. Ask the pilot operator for more allowance or select less material, then retry. You do not need to upload the same files again.",
    // One short allowance, e.g. "Class audio: 127 min 56 sec needed, 69 min 22 sec left".
    shortageItem: "{allowance}: {needed} needed, {left} left",
    // FR-QUOTA-003: no active allowance period at all.
    none: "Your material is saved. You have no active processing allowance. Ask the pilot operator for an allowance, then retry. You do not need to upload the same files again.",
    // The allowance now covers the class, for example after an operator change or D59.
    covered:
      "Your material is saved. Your allowance now covers this class. Retry to create the notes and flashcards. You do not need to upload the same files again.",
  },
} as const;
