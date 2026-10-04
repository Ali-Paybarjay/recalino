import type { Database, Tx } from "../db";
import { getVersion } from "../lkm";
import { listSessions } from "../org";
import type { LearnerContext } from "../plt";
import { getNotebook } from "./notebooks";
export async function noteEditActivity(
  db: Database | Tx,
  ctx: LearnerContext,
): Promise<{ shorterItems: number; classesWithShorterEdits: number }> {
  let offset = 0,
    remaining = true;
  let shorterItems = 0,
    classesWithShorterEdits = 0;
  do {
    const page = await listSessions(db, ctx, { limit: 100, offset });
    for (const session of page.items) {
      const notebook = await getNotebook(db, ctx, session.id);
      if (!notebook) continue;
      const original = await getVersion(db, ctx, notebook.current.knowledgeVersionId);
      const shorter = original.model.learningItems.filter((item) => {
        const edited = notebook.current.edits.items[item.id]?.back;
        return edited && edited.length < item.back.length * 0.7;
      }).length;
      shorterItems += shorter;
      if (shorter) classesWithShorterEdits++;
    }
    offset += page.items.length;
    remaining = page.items.length > 0 && offset < page.total;
  } while (remaining);
  return { shorterItems, classesWithShorterEdits };
}
