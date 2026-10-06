import { describe, expect, it } from "vitest";
import { audioSelectionMatchesCache } from "./selection-cache";

describe("source extraction cache selection", () => {
  it("reuses the same whole-file or partial audio extent", () => {
    expect(audioSelectionMatchesCache([], [])).toBe(true);
    expect(audioSelectionMatchesCache([{ start: 10, end: 20 }], [{ start: 10, end: 20 }])).toBe(
      true,
    );
  });
  it("requires fresh extraction when a partial cache does not cover the requested extent", () => {
    const cache = [{ start: 10, end: 20 }];
    expect(audioSelectionMatchesCache([], cache)).toBe(false);
    expect(audioSelectionMatchesCache([{ start: 1, end: 20 }], cache)).toBe(false);
    expect(audioSelectionMatchesCache([{ start: 12, end: 18 }], cache)).toBe(false);
    expect(
      audioSelectionMatchesCache(
        [
          { start: 10, end: 20 },
          { start: 30, end: 40 },
        ],
        cache,
      ),
    ).toBe(false);
  });
});
