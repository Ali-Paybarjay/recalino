import { describe, expect, it } from "vitest";
import { retryAllowanceCopy } from "./retry-allowance-copy";

describe("D59 retry allowance guidance", () => {
  it.each([
    { notesReady: true, cardsReady: true },
    { notesReady: true, cardsReady: false },
    { notesReady: false, cardsReady: true },
  ])("names the new-version cost when published output is available: %j", (readiness) => {
    const copy = retryAllowanceCopy(readiness);
    expect(copy).toContain("Publishing updated notes uses 1 New versions unit");
    expect(copy).toContain("plus allowance for any material not already charged");
    expect(copy).toContain("already charged for this session are not charged again");
  });

  it.each([{}, { notesReady: false, cardsReady: false }])(
    "does not assume missing ready flags prove that a retry has no new-version cost: %j",
    (readiness) => {
      const copy = retryAllowanceCopy(readiness);
      expect(copy).toContain("Publishing a result uses allowance for material not already charged");
      expect(copy).toContain("A new version of existing notes also uses 1 New versions unit");
      expect(copy).not.toMatch(/free|won.t use|does not use more|no extra allowance/i);
    },
  );
});
