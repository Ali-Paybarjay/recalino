import { describe, expect, it } from "vitest";
import { amounts, equivalentPages, selectedSeconds } from "./amounts";

describe("deterministic consumption (FR-QUOTA-004, 006)", () => {
  it("counts each selected second once, including nested and touching intervals", () => {
    expect(
      selectedSeconds([
        { start: 30, end: 90 },
        { start: 0, end: 60 },
        { start: 10, end: 20 },
        { start: 90, end: 120 },
      ]),
    ).toBe(120);
    expect(
      selectedSeconds([
        { start: 0, end: 1.3 },
        { start: 5, end: 5.4 },
      ]),
    ).toBe(2);
    expect(selectedSeconds([])).toBe(0);
  });
  it("rejects invalid durations and allowance values", () => {
    expect(() => selectedSeconds([{ start: 30, end: 10 }])).toThrow();
    expect(() => amounts({ storage: -1 })).toThrow();
    expect(() => amounts({ audio: 1.5 })).toThrow();
  });
  it("uses the configured text page size and counts Unicode characters", () => {
    expect(equivalentPages("😀".repeat(3000), 3000)).toBe(1);
    expect(equivalentPages("a".repeat(3001), 3000)).toBe(2);
    expect(() => equivalentPages("text", 0)).toThrow();
  });
});
