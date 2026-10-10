import { z } from "zod";
import { type Amounts, amountsSchema, DIMENSIONS, emptyAmounts } from "./amounts";

export interface AllowanceAccounting {
  allocated: Amounts;
  used: Amounts;
  reserved: Amounts;
  available: Amounts;
  /** Signed accounting balance, which can be below zero after an allocation reduction. */
  balance: Amounts;
  deficit: Amounts;
}

interface LedgerEntry {
  dimension: string;
  kind: string;
  amount: string | number | bigint;
  balance_delta: string | number | bigint;
  operation_key: string;
}

/** Adjustments that hand used units back; any other adjustment changes the allocation. */
export const USAGE_RETURN_PREFIXES = ["storage-return:", "charge-return:"] as const;
export function isUsageReturn(operationKey: string): boolean {
  return USAGE_RETURN_PREFIXES.some((prefix) => operationKey.startsWith(prefix));
}

/**
 * ADM-I15: storage returns reduce occupancy; they never increase the owner's allocation.
 * D59: a returned duplicate charge reduces usage in the same way.
 */
export function summarizeAllowanceLedger(
  rows: readonly LedgerEntry[],
  active = true,
): AllowanceAccounting {
  const totals = Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension,
      { allocated: 0n, used: 0n, reserved: 0n, balance: 0n },
    ]),
  ) as Record<
    (typeof DIMENSIONS)[number],
    {
      allocated: bigint;
      used: bigint;
      reserved: bigint;
      balance: bigint;
    }
  >;
  for (const row of rows) {
    const dimension = z.enum(DIMENSIONS).parse(row.dimension);
    const total = totals[dimension];
    const amount = BigInt(row.amount);
    const delta = BigInt(row.balance_delta);
    total.balance += delta;
    if (row.kind === "grant") total.allocated += delta;
    if (row.kind === "reserve") total.reserved += amount;
    if (row.kind === "settle") {
      total.used += amount;
      total.reserved -= amount;
    }
    if (row.kind === "release") total.reserved -= amount;
    if (row.kind === "adjust") {
      if (isUsageReturn(row.operation_key)) total.used -= amount;
      else total.allocated += delta;
    }
  }
  const result: AllowanceAccounting = {
    allocated: emptyAmounts(),
    used: emptyAmounts(),
    reserved: emptyAmounts(),
    available: emptyAmounts(),
    balance: emptyAmounts(),
    deficit: emptyAmounts(),
  };
  const signedUnits = z.number().int().safe();
  for (const dimension of DIMENSIONS) {
    const total = totals[dimension];
    result.allocated[dimension] = Number(total.allocated);
    result.used[dimension] = Number(total.used);
    result.reserved[dimension] = Number(total.reserved);
    const balance = signedUnits.parse(Number(total.balance));
    result.balance[dimension] = balance;
    result.available[dimension] = active ? Math.max(0, balance) : 0;
    result.deficit[dimension] = Math.max(0, -balance);
  }
  amountsSchema.parse(result.allocated);
  amountsSchema.parse(result.used);
  amountsSchema.parse(result.reserved);
  amountsSchema.parse(result.available);
  amountsSchema.parse(result.deficit);
  return result;
}
