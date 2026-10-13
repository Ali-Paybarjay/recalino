/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  // Workstream 4, second round (2026-10-13): the voice sample recorded in class conditions
  // (owner's answer to question 8). Reviewed by the owner once at the end (D65).
  voiceSample: {
    classConditions:
      "Record this sample the way your classes are recorded: the same phone, placed where it is during class, in a room like your classroom. A sample recorded close to your mouth is harder to match with the recording of a class.",
    recordAgain: "Record a new sample",
    replaces:
      "A new sample replaces the saved one. Sessions matched with the old sample will ask you again.",
  },
};
