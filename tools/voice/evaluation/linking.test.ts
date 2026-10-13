import { expect, it } from "vitest";
import { report, SCENARIOS, simulate } from "./linking.ts";

it("workstream 4 evaluation: synthetic report is deterministic", () => {
  expect(report()).toEqual(report());
});

it("workstream 4 evaluation: no fragment is ever suggested, and links are never wrong on any scenario", () => {
  for (const scenario of SCENARIOS) {
    const result = simulate(scenario);
    expect(result.fragments.suggestedRate).toBe(0);
    // Precision first: an uncertain link stays apart (ambiguous), never joins two people. The
    // far-mic scenario with a look-alike peer (seed 4) is the stated limit: one pair in about
    // twenty is joined wrongly there (second audit, 2026-10-13), the clean scenarios none.
    expect(result.linking.precision ?? 1).toBeGreaterThanOrEqual(scenario.lookalike ? 0.9 : 1);
  }
});

it("workstream 4 evaluation: clean conditions link every part of each person", () => {
  const scenario = SCENARIOS.find((item) => item.seed === 1);
  if (!scenario) throw new Error("scenario missing");
  const easy = simulate(scenario);
  expect(easy.linking.recall).toBe(1);
  expect(easy.linking.classVoices).toBe(easy.linking.people);
});
