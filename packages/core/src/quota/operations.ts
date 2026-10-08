import { sql } from "kysely";
import { z } from "zod";
import type { Database } from "../db";
import { costPolicySchema } from "./costs";

/** Minimal operational costs: estimates remain distinct, unresolved holds never count as zero. */
export async function providerCostSummary(db: Database, since: Date) {
  if (!Number.isFinite(since.getTime())) throw new Error("Invalid operational window");
  const [costs, holds, policy] = await Promise.all([
    db
      .selectFrom("quota.provider_cost")
      .select([
        "provider",
        "model",
        "currency",
        "price_version",
        sql<string>`count(*)`.as("count"),
        sql<string>`coalesce(sum(amount_micros),0)`.as("actual"),
        sql<string>`coalesce(sum(estimated_micros),0)`.as("estimated"),
        sql<string>`count(*) filter(where amount_micros is null and estimated_micros is null)`.as(
          "unknown",
        ),
      ])
      .where("created_at", ">=", since)
      .groupBy(["provider", "model", "currency", "price_version"])
      .execute(),
    db
      .selectFrom("quota.cost_hold")
      .select([
        "currency",
        sql<string>`count(*)`.as("count"),
        sql<string>`coalesce(sum(maximum_micros),0)`.as("maximum"),
      ])
      .where("closed_at", "is", null)
      .groupBy("currency")
      .execute(),
    db.selectFrom("quota.cost_policy").selectAll().where("singleton", "=", true).executeTakeFirst(),
  ]);
  return {
    since: since.toISOString(),
    policy: policy
      ? costPolicySchema.parse({
          version: policy.version,
          currency: policy.currency,
          killSwitch: policy.kill_switch,
          limits: policy.limits,
        })
      : null,
    costs: costs.map((row) => ({
      provider: row.provider,
      model: row.model,
      currency: row.currency,
      priceVersion: row.price_version,
      attempts: Number(row.count),
      actualMicros: Number(row.actual),
      estimatedMicros: Number(row.estimated),
      unknownAttempts: Number(row.unknown),
    })),
    unresolvedHolds: holds.map((row) => ({
      currency: row.currency,
      count: Number(row.count),
      maximumMicros: Number(row.maximum),
    })),
  };
}

/** Trusted operational metadata only: the caller must verify the class's owner. */
export async function providerSessionCostSummary(db: Database, sessionId: string, userId: string) {
  z.uuid().parse(sessionId);
  z.uuid().parse(userId);
  const [cost, hold, policy] = await Promise.all([
    db
      .selectFrom("quota.provider_cost")
      .select([
        sql<string>`coalesce(sum(amount_micros),0)`.as("actual"),
        sql<string>`coalesce(sum(estimated_micros) filter(where amount_micros is null),0)`.as(
          "estimated",
        ),
        sql<string>`count(*) filter(where amount_micros is null and estimated_micros is null)`.as(
          "unknown",
        ),
      ])
      .where("session_id", "=", sessionId)
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("quota.cost_hold")
      .select(sql<string>`coalesce(sum(maximum_micros),0)`.as("reserved"))
      .where("session_id", "=", sessionId)
      .where("user_id", "=", userId)
      .where("closed_at", "is", null)
      .executeTakeFirstOrThrow(),
    db.selectFrom("quota.cost_policy").selectAll().where("singleton", "=", true).executeTakeFirst(),
  ]);
  const parsed = policy
    ? costPolicySchema.parse({
        version: policy.version,
        currency: policy.currency,
        killSwitch: policy.kill_switch,
        limits: policy.limits,
      })
    : null;
  return {
    actualMicros: Number(cost.actual),
    estimatedMicros: Number(cost.estimated),
    reservedMicros: Number(hold.reserved),
    unknownCount: Number(cost.unknown),
    limitMicros: parsed?.limits.session ?? null,
    currency: parsed?.currency ?? null,
  };
}
