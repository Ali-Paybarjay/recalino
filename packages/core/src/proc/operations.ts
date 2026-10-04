import { sql } from "kysely";
import type { Database } from "../db";

export async function processingOperationalSummary(db: Database, since: Date) {
  if (!Number.isFinite(since.getTime())) throw new Error("Invalid operational window");
  const [runs, attempts] = await Promise.all([
    db
      .selectFrom("proc.processing_run")
      .select([
        "kind",
        "state",
        sql<string>`count(*)`.as("count"),
        sql<string | null>`avg(extract(epoch from (finished_at-created_at)))`.as(
          "averageTotalSeconds",
        ),
      ])
      .where("created_at", ">=", since)
      .groupBy(["kind", "state"])
      .execute(),
    db
      .selectFrom("proc.provider_attempt")
      .select(["provider", "model", "state", sql<string>`count(*)`.as("count")])
      .where("started_at", ">=", since)
      .groupBy(["provider", "model", "state"])
      .execute(),
  ]);
  return {
    since: since.toISOString(),
    runs: runs.map((row) => ({
      kind: row.kind,
      state: row.state,
      count: Number(row.count),
      averageTotalSeconds:
        row.averageTotalSeconds === null ? null : Number(row.averageTotalSeconds),
    })),
    providerAttempts: attempts.map((row) => ({
      provider: row.provider,
      model: row.model,
      state: row.state,
      count: Number(row.count),
    })),
  };
}
