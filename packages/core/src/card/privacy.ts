import { sql } from "kysely";
import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
import { tombstoneSessionCards } from "./cards";
export async function tombstoneAccountCards(
  tx: Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await tx
    .updateTable("card.card")
    .set({ deleted_at: now, status: "deleted", updated_at: now })
    .where("user_id", "=", ctx.userId)
    .execute();
  await tx.deleteFrom("card.session_link").where("user_id", "=", ctx.userId).execute();
}
export async function tombstoneSourceCards(
  tx: Tx,
  ctx: LearnerContext,
  sourceId: string,
  sessionIds: string[],
  now = new Date(),
): Promise<void> {
  for (const id of sessionIds) await tombstoneSessionCards(tx, ctx, id, now);
  await tx
    .deleteFrom("card.proposal")
    .where("user_id", "=", ctx.userId)
    .where(sql<boolean>`provenance @> ${JSON.stringify({ sourceRefs: [{ sourceId }] })}::jsonb`)
    .execute();
  const current = await tx
    .selectFrom("card.card")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where(sql<boolean>`provenance @> ${JSON.stringify({ sourceRefs: [{ sourceId }] })}::jsonb`)
    .execute();
  const history = await tx
    .selectFrom("card.revision")
    .select("card_id")
    .where("user_id", "=", ctx.userId)
    .where(
      sql<boolean>`snapshot @> ${JSON.stringify({ provenance: { sourceRefs: [{ sourceId }] } })}::jsonb`,
    )
    .execute();
  // Undo must never restore content from a fully deleted source, including on a
  // shared card whose current provenance was replaced by a later class.
  for (const id of new Set([
    ...current.map((row) => row.id),
    ...history.map((row) => row.card_id),
  ])) {
    await tx
      .updateTable("card.card")
      .set({ status: "deleted", deleted_at: now, updated_at: now })
      .where("id", "=", id)
      .execute();
    await tx.deleteFrom("card.session_link").where("card_id", "=", id).execute();
  }
}
export async function cleanupSessionCards(
  db: Database,
  ctx: LearnerContext,
  _sessionId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx
      .deleteFrom("card.card")
      .where("user_id", "=", ctx.userId)
      .where("deleted_at", "is not", null)
      .execute();
    await tx
      .deleteFrom("card.learning_item")
      .where("user_id", "=", ctx.userId)
      .where(
        "id",
        "not in",
        tx.selectFrom("card.card").select("learning_item_id").where("user_id", "=", ctx.userId),
      )
      .execute();
  });
}
export const cleanupAccountCards = (db: Database, ctx: LearnerContext) =>
  cleanupSessionCards(db, ctx, "");
