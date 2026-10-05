import { z } from "zod";
import type { Database, Tx } from "../db";
import { listSessions } from "../org";
import type { LearnerContext } from "../plt";
import { type LearningSession, readLearningSessions } from "./learning-sessions";
import { listPublishedNotebooks, type Notebook } from "./notebooks";

export const courseMaterialsSchema = z.strictObject({
  limit: z.int().min(1).max(100).optional(),
  offset: z.int().nonnegative().optional(),
});
export type CourseMaterialsInput = z.infer<typeof courseMaterialsSchema>;
export interface CourseMaterials {
  items: { session: LearningSession; notebook: Notebook | null }[];
  total: number;
}

/** D39: chronological course reading uses published revisions, never a new merged generation. */
export async function listCourseMaterials(
  db: Database | Tx,
  ctx: LearnerContext,
  courseId: string,
  input: CourseMaterialsInput = {},
): Promise<CourseMaterials> {
  const id = z.uuid().parse(courseId);
  const parsed = courseMaterialsSchema.parse(input);
  const read = async (tx: Database | Tx): Promise<CourseMaterials> => {
    const sessions = await listSessions(tx, ctx, {
      courseId: id,
      order: "oldest",
      limit: parsed.limit ?? 20,
      offset: parsed.offset ?? 0,
    });
    const notebooks = await listPublishedNotebooks(
      tx,
      ctx,
      sessions.items.map((item) => item.id),
    );
    const learning = await readLearningSessions(tx, ctx, sessions.items, notebooks);
    return {
      items: learning.map((session) => ({
        session,
        notebook: notebooks.get(session.id) ?? null,
      })),
      total: sessions.total,
    };
  };
  // Count, course membership, availability and publication pointers share a single snapshot.
  if (db.isTransaction) return read(db);
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(read);
}
