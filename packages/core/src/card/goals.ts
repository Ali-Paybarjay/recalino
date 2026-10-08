import { z } from "zod";
import type { Database, Tx } from "../db";
import { errors, type LearnerContext } from "../plt";

export interface OwnedLearningGoal {
  learningItemId: string;
  /** Present only for lesson items: the class and the knowledge item id it was synchronised from. */
  sessionId: string | null;
  itemId: string | null;
}

function goal(row: { id: string; logical_key: string }): OwnedLearningGoal {
  // Lesson items use `${sessionId}:${itemId}` (automatic.ts); user and proposal goals do not.
  const separator = row.logical_key.indexOf(":");
  const session = separator > 0 ? row.logical_key.slice(0, separator) : "";
  const item = separator > 0 ? row.logical_key.slice(separator + 1) : "";
  const lesson = z.uuid().safeParse(session).success && item.length > 0;
  return {
    learningItemId: row.id,
    sessionId: lesson ? session : null,
    itemId: lesson ? item : null,
  };
}

/** The class scope of owned learning goals; no goal is merged across classes (D48). */
export async function ownedLearningGoals(
  db: Database | Tx,
  ctx: LearnerContext,
  learningItemIds: readonly string[],
): Promise<OwnedLearningGoal[]> {
  const unique = [...new Set(learningItemIds)];
  if (!unique.length) return [];
  const rows = await db
    .selectFrom("card.learning_item")
    .select(["id", "logical_key"])
    .where("user_id", "=", ctx.userId)
    .where("id", "in", unique)
    .execute();
  return rows.map(goal);
}

/** Ownership check for feedback about a learning goal; a foreign or unknown id is not found. */
export async function assertOwnedLearningGoal(
  db: Database | Tx,
  ctx: LearnerContext,
  learningItemId: string,
): Promise<OwnedLearningGoal> {
  if (!z.uuid().safeParse(learningItemId).success) throw errors.notFound();
  const [owned] = await ownedLearningGoals(db, ctx, [learningItemId]);
  if (!owned) throw errors.notFound();
  return owned;
}
