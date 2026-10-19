import { describe, expect, it } from "vitest";
import { type EstimateRate, estimatedUsageCost, estimateRatesSchema } from "./pricing";

const rate = (
  unit: EstimateRate["unit"],
  rateMicros: number,
  stage: EstimateRate["stage"] = "generation",
): EstimateRate => ({ id: unit, stage, model: "synthetic/model", unit, rateMicros });
describe("owner estimate rates (ADM-I06)", () => {
  it("prices matched usage and stage only, retaining zero and unknown distinctly", () => {
    const rates = [
      rate("input_million_tokens", 1_000_000),
      rate("output_million_tokens", 2_000_000),
      rate("page", 400, "vision"),
    ];
    expect(
      estimatedUsageCost(
        rates,
        "synthetic/model",
        { inputTokens: 10, outputTokens: 5, pages: 2 },
        "generation",
      ),
    ).toBe(20);
    expect(estimatedUsageCost(rates, "synthetic/model", { pages: 2 }, "vision")).toBe(800);
    expect(estimatedUsageCost(rates, "other", { pages: 2 }, "vision")).toBeNull();
    expect(
      estimatedUsageCost([rate("page", 0, "vision")], "synthetic/model", { pages: 1 }, "vision"),
    ).toBe(0);
    expect(estimatedUsageCost(rates, "synthetic/model", {}, "generation")).toBeNull();
  });
  it("converts minutes/characters, rounds fractional micros up, and rejects overflow", () => {
    expect(
      estimatedUsageCost(
        [rate("audio_minute", 120, "transcription")],
        "synthetic/model",
        { audioSeconds: 30 },
        "transcription",
      ),
    ).toBe(60);
    expect(
      estimatedUsageCost(
        [rate("tts_thousand_characters", 1, "tts")],
        "synthetic/model",
        { characters: 1 },
        "tts",
      ),
    ).toBe(1);
    expect(() =>
      estimatedUsageCost(
        [rate("page", Number.MAX_SAFE_INTEGER, "vision")],
        "synthetic/model",
        { pages: 2 },
        "vision",
      ),
    ).toThrow();
  });
  it("QUA-09 multiplies before dividing and rounds each rate up to whole micros", () => {
    const tokens = [
      rate("input_million_tokens", 300_000),
      rate("output_million_tokens", 1),
    ] as const;
    // count=1, divisor=1e6: one token at 1 micro per million is still a whole micro.
    expect(
      estimatedUsageCost([tokens[1]], "synthetic/model", { outputTokens: 1 }, "generation"),
    ).toBe(1);
    // 10 × 300000 / 1e6 is exactly 3; dividing first drifted to 3.0000000000000004 → 4.
    expect(
      estimatedUsageCost([tokens[0]], "synthetic/model", { inputTokens: 10 }, "generation"),
    ).toBe(3);
    // Each rate rounds up on its own: ceil(1/1e6) + ceil(1/1e6) = 2 (dividing first gave 1).
    expect(
      estimatedUsageCost(
        [rate("input_million_tokens", 1), rate("output_million_tokens", 1)],
        "synthetic/model",
        { inputTokens: 1, outputTokens: 1 },
        "generation",
      ),
    ).toBe(2);
    // Whole usage stays exact past 2^53: 10000001 × 1000000001 / 1e6 = 10000001010.000001 → …011.
    expect(
      estimatedUsageCost(
        [rate("input_million_tokens", 1_000_000_001)],
        "synthetic/model",
        { inputTokens: 10_000_001 },
        "generation",
      ),
    ).toBe(10_000_001_011);
    // Fractional audio seconds keep rounding up.
    expect(
      estimatedUsageCost(
        [rate("audio_minute", 120, "transcription")],
        "synthetic/model",
        { audioSeconds: 30.25 },
        "transcription",
      ),
    ).toBe(61);
  });
  it("accepts independent stages but rejects duplicate or ambiguous billing bases", () => {
    expect(
      estimateRatesSchema.safeParse([rate("page", 1, "vision"), rate("page", 2, "generation")])
        .success,
    ).toBe(true);
    expect(estimateRatesSchema.safeParse([rate("page", 1), rate("page", 2)]).success).toBe(false);
    expect(
      estimateRatesSchema.safeParse([rate("page", 1), rate("input_million_tokens", 2)]).success,
    ).toBe(false);
    expect(
      estimateRatesSchema.safeParse([
        rate("input_million_tokens", 1),
        rate("output_million_tokens", 2),
      ]).success,
    ).toBe(true);
  });
});
