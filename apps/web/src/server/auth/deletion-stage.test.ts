import { describe, expect, it } from "vitest";
import { deletionStage } from "./deletion-stage";

// UX-10: three states of an unfinished account deletion, three different messages.
describe("deletionStage", () => {
  it("asks the learner to finish only when the receipt is not saved", () => {
    expect(deletionStage("pending", false)).toBe("journal_unsaved");
  });

  it("treats a saved receipt with cleanup still running as in progress", () => {
    expect(deletionStage("pending", true)).toBe("in_progress");
  });

  it("sends a stopped cleanup to the operator, saved receipt or not", () => {
    expect(deletionStage("needs_operator", true)).toBe("needs_operator");
    expect(deletionStage("needs_operator", false)).toBe("needs_operator");
  });
});
