import { describe, expect, it } from "vitest";
import { reviewFocusTarget } from "./review-focus";

describe("review focus (A11Y-03)", () => {
  it("moves to the answer once it is shown", () => {
    expect(reviewFocusTarget("answer", { shown: true, hasCard: true })).toBe("answer");
    expect(reviewFocusTarget("answer", { shown: false, hasCard: true })).toBeNull();
  });

  it("moves to the next card's Show answer only after the old answer has gone", () => {
    expect(reviewFocusTarget("next", { shown: true, hasCard: true })).toBeNull();
    expect(reviewFocusTarget("next", { shown: false, hasCard: true })).toBe("show-answer");
  });

  it("moves to the end-of-session panel when no card is left", () => {
    expect(reviewFocusTarget("next", { shown: false, hasCard: false })).toBe("done");
  });

  it("leaves the focus alone when nothing asked to move it", () => {
    expect(reviewFocusTarget(null, { shown: true, hasCard: true })).toBeNull();
    expect(reviewFocusTarget(null, { shown: false, hasCard: false })).toBeNull();
  });
});
