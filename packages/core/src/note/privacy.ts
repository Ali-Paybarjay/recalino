import { lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import { liveKnowledgeVersionIdsForCleanup } from "../lkm";
import { errors, type LearnerContext } from "../plt";
import { tombstoneSessionNotes } from "./notebooks";
export async function tombstoneSourceNotes(
  tx: Tx,
  ctx: LearnerContext,
  _sourceId: string,
  sessionIds: string[],
): Promise<void> {
  for (const id of sessionIds) await tombstoneSessionNotes(tx, ctx, id);
}
export async function tombstoneAccountNotes(tx: Tx, ctx: LearnerContext): Promise<void> {
  await tx
    .updateTable("note.notebook")
    .set({ current_revision_id: null })
    .where("user_id", "=", ctx.userId)
    .execute();
}
export async function cleanupSessionNotes(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const notebook = await tx
      .selectFrom("note.notebook")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!notebook) return;
    if (notebook.current_revision_id) throw errors.conflict();
    await tx.deleteFrom("note.notebook").where("id", "=", notebook.id).execute();
  });
}
/** Purge invalidated revisions while preserving an explicitly published replacement. */
export async function cleanupSourceNotes(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const notebook = await tx
      .selectFrom("note.notebook")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("user_id", "=", ctx.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!notebook) return;
    const live = new Set(await liveKnowledgeVersionIdsForCleanup(tx, ctx, sessionId));
    const revisions = await tx
      .selectFrom("note.revision")
      .select(["id", "knowledge_version_id"])
      .where("notebook_id", "=", notebook.id)
      .where("user_id", "=", ctx.userId)
      .execute();
    const removed = revisions.filter((row) => !live.has(row.knowledge_version_id));
    if (removed.some((row) => row.id === notebook.current_revision_id))
      await tx
        .updateTable("note.notebook")
        .set({ current_revision_id: null })
        .where("id", "=", notebook.id)
        .execute();
    if (removed.length)
      await tx
        .deleteFrom("note.revision")
        .where(
          "id",
          "in",
          removed.map((row) => row.id),
        )
        .where("user_id", "=", ctx.userId)
        .execute();
    if (removed.length === revisions.length)
      await tx.deleteFrom("note.notebook").where("id", "=", notebook.id).execute();
  });
}
export async function cleanupAccountNotes(db: Database, ctx: LearnerContext): Promise<void> {
  await db
    .deleteFrom("note.notebook")
    .where("user_id", "=", ctx.userId)
    .where("current_revision_id", "is", null)
    .execute();
}
