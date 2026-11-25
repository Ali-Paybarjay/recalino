import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import type { Tx } from "../db";
import { spendTotals } from "./costs";

// PERF-04 (FR-QUOTA-009): every cost limit's spend comes from one aggregate query, not from the
// month's provider-cost rows summed in memory.
const ctx = { userId: randomUUID(), requestId: "spend-totals" };
const sessionId = randomUUID();
const now = new Date("2026-10-19T15:30:00Z");

describe("provider spend totals (PERF-04, FR-QUOTA-009)", () => {
  it("reads every scope's spend in one aggregate over recorded costs and open holds", async () => {
    const { db, queries } = queryBudgetDatabase([
      [{ unknown: "0", session: "120", user_month: "300", system_day: "450", system_month: "900" }],
    ]);
    await expect(spendTotals(db as unknown as Tx, ctx, sessionId, "GBP", now)).resolves.toEqual({
      session: 120,
      userMonth: 300,
      systemDay: 450,
      systemMonth: 900,
    });
    expect(queries).toHaveLength(1);
    const [query] = queries;
    const text = query?.sql.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("from quota.provider_cost");
    expect(text).toContain("union all");
    expect(text).toContain("from quota.cost_hold");
    expect(text).toContain("closed_at is null");
    expect(text).toContain("coalesce(amount_micros, estimated_micros)");
    expect(query?.parameters).toEqual(
      expect.arrayContaining([
        sessionId,
        ctx.userId,
        "GBP",
        new Date("2026-10-01T00:00:00Z"),
        new Date("2026-10-19T00:00:00Z"),
      ]),
    );
  });

  it("stops when a recorded cost has neither an actual nor an estimated amount", async () => {
    const { db } = queryBudgetDatabase([
      [{ unknown: "1", session: "0", user_month: "0", system_day: "0", system_month: "0" }],
    ]);
    await expect(
      spendTotals(db as unknown as Tx, ctx, sessionId, "GBP", now),
    ).rejects.toMatchObject({
      code: "quota_insufficient",
      details: { reason: "provider_cost_unknown" },
    });
  });

  it("counts nothing spent when there are no costs or holds", async () => {
    const { db } = queryBudgetDatabase([
      [{ unknown: "0", session: "0", user_month: "0", system_day: "0", system_month: "0" }],
    ]);
    await expect(spendTotals(db as unknown as Tx, ctx, sessionId, "GBP", now)).resolves.toEqual({
      session: 0,
      userMonth: 0,
      systemDay: 0,
      systemMonth: 0,
    });
  });
});
