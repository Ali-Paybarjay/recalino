import type { Database, Tx } from "../db";
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
