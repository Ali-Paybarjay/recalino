import { describe, expect, it } from "vitest";
import { summarizeAllowanceLedger } from "./accounting";
import { amounts } from "./amounts";
import { pilotConfigurationSchema } from "./pilot";

function entry(
  kind: string,
  amount: number,
  balanceDelta: number,
  key = kind,
  dimension = "audio",
) {
  return { kind, amount, balance_delta: balanceDelta, operation_key: key, dimension };
}

describe("allocation accounting (ADM-I15/I16)", () => {
  it("keeps a deficit signed, clamps only availability and preserves consumption and holds", () => {
    const rows = [
      entry("grant", 600, 600),
      entry("reserve", 150, -150),
      entry("settle", 120, 0),
      entry("adjust", 500, -500),
    ];
    expect(summarizeAllowanceLedger(rows)).toMatchObject({
      allocated: { audio: 100 },
      used: { audio: 120 },
      reserved: { audio: 30 },
      balance: { audio: -50 },
      available: { audio: 0 },
      deficit: { audio: 50 },
    });
    expect(summarizeAllowanceLedger([...rows, entry("release", 30, 30)])).toMatchObject({
      allocated: { audio: 100 },
      used: { audio: 120 },
      reserved: { audio: 0 },
      balance: { audio: -20 },
      available: { audio: 0 },
      deficit: { audio: 20 },
    });
    expect(summarizeAllowanceLedger([...rows, entry("adjust", 700, 700)])).toMatchObject({
      allocated: { audio: 800 },
      used: { audio: 120 },
      reserved: { audio: 30 },
      available: { audio: 650 },
      deficit: { audio: 0 },
    });
  });

  it("returns storage occupancy without inflating allocation or refunding AI consumption", () => {
    const rows = [
      entry("grant", 1000, 1000, "initial", "storage"),
      entry("reserve", 400, -400, "hold", "storage"),
      entry("settle", 400, 0, "settled", "storage"),
      entry("adjust", 400, 400, "storage-return:reservation", "storage"),
      entry("grant", 300, 300),
      entry("reserve", 60, -60),
      entry("settle", 60, 0),
    ];
    expect(summarizeAllowanceLedger(rows)).toMatchObject({
      allocated: { storage: 1000, audio: 300 },
      used: { storage: 0, audio: 60 },
      available: { storage: 1000, audio: 240 },
    });
    expect(summarizeAllowanceLedger(rows, false).available).toEqual(amounts({}));
  });

  it("accepts independent safe allocations and rejects precision loss, not commercial limits", () => {
    expect(
      pilotConfigurationSchema.parse({
        version: "zero",
        pilotId: "synthetic-pilot",
        maximumParticipants: 0,
        periodDays: 30,
        amounts: amounts({ audio: Number.MAX_SAFE_INTEGER }),
      }).maximumParticipants,
    ).toBe(0);
    expect(
      pilotConfigurationSchema.parse({
        version: "large",
        pilotId: "synthetic-pilot",
        maximumParticipants: 10001,
        periodDays: 30,
        amounts: amounts({ storage: 0 }),
      }).maximumParticipants,
    ).toBe(10001);
    expect(() =>
      pilotConfigurationSchema.parse({
        version: "unsafe",
        pilotId: "synthetic-pilot",
        maximumParticipants: Number.MAX_SAFE_INTEGER + 1,
        periodDays: 30,
        amounts: amounts({}),
      }),
    ).toThrow();
    expect(() =>
      summarizeAllowanceLedger([
        entry("grant", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        entry("adjust", 1, 1),
      ]),
    ).toThrow();
  });
});
