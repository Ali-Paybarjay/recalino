import { expect, it } from "vitest";
import { report, SCENARIOS, simulate } from "./linking.ts";

it("workstream 4 evaluation: synthetic report is deterministic", () => {
  expect(report()).toEqual(report());
});

it("workstream 4 evaluation: no fragment is ever suggested, and links are never wrong on any scenario", () => {
  for (const scenario of SCENARIOS) {
    const result = simulate(scenario);
    expect(result.fragments.suggestedRate).toBe(0);
    // Precision first: an uncertain link stays apart (ambiguous), never joins two people.
    expect(result.linking.precision ?? 1).toBe(1);
  }
});

it("workstream 4 evaluation: clean conditions link every part of each person", () => {
  const scenario = SCENARIOS.find((item) => item.seed === 1);
  if (!scenario) throw new Error("scenario missing");
  const easy = simulate(scenario);
  expect(easy.linking.recall).toBe(1);
  expect(easy.linking.classVoices).toBe(easy.linking.people);
});
