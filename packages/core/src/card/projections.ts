import type { Database, Tx } from "../db";
import { filterLiveSessionIds } from "../org";
import type { LearnerContext } from "../plt";
/** Tombstones are included so deleting a card does not bypass the daily introduction cap. */
export async function learningItemIdsForOwnedCards(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<{ cardId: string; learningItemId: string }[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return db
    .selectFrom("card.card")
    .select(["id as cardId", "learning_item_id as learningItemId"])
    .where("user_id", "=", ctx.userId)
    .where("id", "in", unique)
    .execute();
}

/**
 * PERF-04: which of these cards getCard would return, in a constant number of reads: owned, not
 * deleted and linked to at least one live session. Export listings check whole snapshots with it.
 */
export async function liveCardIds(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const cards = await db
    .selectFrom("card.card")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("id", "in", unique)
    .where("deleted_at", "is", null)
    .execute();
  if (!cards.length) return new Set();
  const links = await db
    .selectFrom("card.session_link")
    .select(["card_id", "session_id"])
    .where("user_id", "=", ctx.userId)
    .where(
      "card_id",
      "in",
      cards.map((card) => card.id),
    )
    .execute();
  const live = new Set(
    await filterLiveSessionIds(
      db,
      ctx,
      links.map((link) => link.session_id),
    ),
  );
  return new Set(links.filter((link) => live.has(link.session_id)).map((link) => link.card_id));
}
