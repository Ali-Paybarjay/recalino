import { sql } from "kysely";
import type { Database } from "../db";

/** Internal operator metadata only. Job payloads, audit reasons and private object keys are excluded. */
export async function platformOperationalSummary(db: Database, since: Date, now = new Date()) {
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(now.getTime()) || since > now)
    throw new Error("Invalid operational window");
  const results = await Promise.all([
    db
      .selectFrom("plt.job")
      .select([
        "kind",
        "state",
        sql<string>`count(*)`.as("count"),
        sql<Date | null>`min(created_at)`.as("oldest"),
      ])
      .where("created_at", ">=", since)
      .groupBy(["kind", "state"])
      .execute(),
    db
      .selectFrom("plt.security_event")
      .select(["kind", sql<string>`count(*)`.as("count")])
      .where("occurred_at", ">=", since)
      .groupBy("kind")
      .execute(),
    db
      .selectFrom("plt.storage_object")
      .select([
        "owner_module",
        "state",
        "retention",
        sql<string>`count(*)`.as("count"),
        sql<string>`coalesce(sum(size_bytes),0)`.as("bytes"),
      ])
      .groupBy(["owner_module", "state", "retention"])
      .execute(),
  ]);
  return {
    since: since.toISOString(),
    now: now.toISOString(),
    jobs: results[0].map((row) => ({
      kind: row.kind,
      state: row.state,
      count: Number(row.count),
      oldest: row.oldest?.toISOString() ?? null,
    })),
    security: results[1].map((row) => ({ kind: row.kind, count: Number(row.count) })),
    storage: results[2].map((row) => ({
      module: row.owner_module,
      state: row.state,
      retention: row.retention,
      count: Number(row.count),
      bytes: Number(row.bytes),
    })),
  };
}
