import { randomUUID } from "node:crypto";
import type { CompiledQuery } from "kysely";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { statementLogDatabase } from "../../test/statement-log";
import type { Tx } from "../db";
import { finishProviderStep, spendTotals } from "./costs";

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

// P12-01 (AC-7, AC-13, F-10): a reconciliation closes an open hold at its maximum with one cost
// row dated at the hold's own time, so each cost limit counts it once, in the period the hold
// was counted in: never the hold and the row together, and never once in the hold's month or day
// and again in the month or day of the close.
describe("conservative close and the cost limits (P12-01)", () => {
  const HOLD_TIME = new Date("2026-09-30T23:30:00Z");
  const CLOSE_TIME = new Date("2026-10-01T00:30:00Z");
  const MAXIMUM = 9000;
  const OPERATION = `${randomUUID()}:knowledge:1`;
  const attemptId = randomUUID();
  type Spend = { user_id: string; session_id: string; created_at: Date; amount: number | null };

  /**
   * One hold and its cost rows in memory. finishProviderStep's statements change them; the
   * spendTotals aggregate is answered by applying its own parameters (session, month, user, day,
   * currency) to the union of cost rows and open holds, as its SQL reads them.
   */
  function ledger() {
    const hold = {
      id: "hold",
      user_id: ctx.userId,
      session_id: sessionId,
      reservation_id: "reservation",
      operation_key: OPERATION,
      maximum_micros: String(MAXIMUM),
      currency: "USD",
      created_at: HOLD_TIME,
      closed_at: null as Date | null,
    };
    const costs: Record<string, unknown>[] = [];
    const spendTotalsAnswer = (query: CompiledQuery) => {
      const [session, month, user, day, , currency] = query.parameters as [
        string,
        Date,
        string,
        Date,
        Date,
        string,
      ];
      const spend: Spend[] = [
        ...costs
          .filter(
            (row) =>
              row.currency === currency &&
              ((row.created_at as Date) >= month || row.session_id === session),
          )
          .map((row) => ({
            user_id: row.user_id as string,
            session_id: row.session_id as string,
            created_at: row.created_at as Date,
            amount: (row.amount_micros ?? row.estimated_micros) as number | null,
          })),
        ...(hold.currency === currency && hold.closed_at === null
          ? [{ ...hold, amount: Number(hold.maximum_micros) }]
          : []),
      ];
      const sum = (rows: Spend[]) =>
        String(rows.reduce((total, row) => total + (row.amount ?? 0), 0));
      return [
        {
          unknown: String(spend.filter((row) => row.amount === null).length),
          session: sum(spend.filter((row) => row.session_id === session)),
          user_month: sum(spend.filter((row) => row.created_at >= month && row.user_id === user)),
          system_day: sum(spend.filter((row) => row.created_at >= day)),
          system_month: sum(spend.filter((row) => row.created_at >= month)),
        },
      ];
    };
    const { db, statements } = statementLogDatabase((query) => {
      if (query.sql.includes("union all")) return spendTotalsAnswer(query);
      if (query.sql.startsWith('select * from "quota"."cost_hold"')) return [{ ...hold }];
      if (query.sql.startsWith('select * from "quota"."provider_cost"'))
        return costs.filter((row) => row.operation_key === query.parameters[0]);
      if (query.sql.startsWith('update "quota"."cost_hold"')) {
        if (hold.closed_at === null) hold.closed_at = query.parameters[0] as Date;
        return [];
      }
      if (query.sql.startsWith('insert into "quota"."provider_cost"')) {
        const columns = [
          ...(query.sql.match(/\(([^)]*)\) values/)?.[1] ?? "").matchAll(/"(\w+)"/g),
        ].map(([, column]) => column as string);
        costs.push(Object.fromEntries(columns.map((column, i) => [column, query.parameters[i]])));
      }
      return [];
    });
    const totals = (at: Date) =>
      db.transaction().execute((tx) => spendTotals(tx, ctx, sessionId, "USD", at));
    const close = (recordAtHoldTime: boolean) =>
      db.transaction().execute((tx) =>
        finishProviderStep(
          tx,
          ctx,
          "hold",
          {
            operationKey: OPERATION,
            provider: "synthetic",
            model: "synthetic/llm",
            currency: "USD",
            actualMicros: null,
            estimatedMicros: "hold_maximum",
            priceVersion: null,
            usage: {},
            runId: randomUUID(),
            attemptId,
            ...(recordAtHoldTime ? { recordAtHoldTime: true } : {}),
          },
          CLOSE_TIME,
        ),
      );
    return { hold, costs, statements, totals, close };
  }

  it("counts a hold closed at its maximum once, in the hold's own day and month, before and after the close", async () => {
    const x = ledger();
    const before = { hold: await x.totals(HOLD_TIME), close: await x.totals(CLOSE_TIME) };
    // While open, the hold counts in its own day and month, and for its session.
    expect(before.hold).toEqual({
      session: MAXIMUM,
      userMonth: MAXIMUM,
      systemDay: MAXIMUM,
      systemMonth: MAXIMUM,
    });
    expect(before.close).toEqual({ session: MAXIMUM, userMonth: 0, systemDay: 0, systemMonth: 0 });

    expect(await x.close(true)).toBe("recorded");
    // One row, dated at the hold's own time; the hold's closed_at is the real time of the close.
    expect(x.costs).toHaveLength(1);
    expect(x.costs[0]).toMatchObject({
      created_at: HOLD_TIME,
      amount_micros: null,
      estimated_micros: MAXIMUM,
      attempt_id: attemptId,
    });
    expect(x.hold.closed_at).toEqual(CLOSE_TIME);
    // The hold no longer counts; its row counts in the same periods: every limit unchanged.
    expect(await x.totals(HOLD_TIME)).toEqual(before.hold);
    expect(await x.totals(CLOSE_TIME)).toEqual(before.close);

    // A second close changes nothing (AC-5).
    expect(await x.close(true)).toBe("already_recorded");
    expect(x.costs).toHaveLength(1);
    expect(await x.totals(CLOSE_TIME)).toEqual(before.close);
  });

  it("shows the difference: a row dated at the close would move the hold into the close's day and month", async () => {
    const x = ledger();
    const before = await x.totals(CLOSE_TIME);
    expect(await x.close(false)).toBe("recorded");
    expect(x.costs[0]?.created_at).toEqual(CLOSE_TIME);
    // The dispatch path's own date (unchanged there): counted in September while open, and again
    // in October's day and month after the close.
    expect(await x.totals(CLOSE_TIME)).toEqual({
      ...before,
      userMonth: MAXIMUM,
      systemDay: MAXIMUM,
      systemMonth: MAXIMUM,
    });
  });

  it("dates a row at the hold's time only for a close at the hold's maximum", async () => {
    const { db, statements } = statementLogDatabase();
    await expect(
      db.transaction().execute((tx) =>
        finishProviderStep(
          tx,
          ctx,
          "hold",
          {
            operationKey: OPERATION,
            provider: "synthetic",
            model: "synthetic/llm",
            currency: "USD",
            actualMicros: 700,
            estimatedMicros: null,
            priceVersion: null,
            usage: {},
            recordAtHoldTime: true,
          },
          CLOSE_TIME,
        ),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    // Refused before any statement.
    expect(statements).toEqual([]);
  });
});
