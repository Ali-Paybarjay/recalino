import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
/** Identifiers only: modules can filter their links without reading ORG's private rows. */
export async function filterLiveSessionIds(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db
    .selectFrom("org.class_session")
    .select("id")
    .where("owner_id", "=", ctx.userId)
    .where("id", "in", unique)
    .where("deleted_at", "is", null)
    .execute();
  return rows.map((row) => row.id);
}
