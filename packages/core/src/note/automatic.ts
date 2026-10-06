import { lockAccount } from "../acc";
import type { Database } from "../db";
import { getLatestVersion, getVersion } from "../lkm";
import { assertSessionOwner } from "../org";
import {
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";
import { reconcileAutomaticEdits } from "./automatic-identity";
import { getNotebook, type Notebook } from "./notebooks";
import { applyNotebookEdits, notebookEditsSchema } from "./schema";

/** Publish the newest validated class result while retaining edits and immutable revision history. */
export async function automaticPublishNotebook(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  knowledgeVersionId: string,
  options: { key: string; now?: Date },
): Promise<Notebook> {
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const now = options.now ?? new Date();
  await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: options.key,
      route: "note.automatic_publish",
      requestHash: sha256Hex(canonicalJson({ sessionId, knowledgeVersionId })),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: async (tx) => {
        await lockAccount(tx, ctx.userId);
        await assertSessionOwner(tx, ctx, sessionId);
        const requested = await getVersion(tx, ctx, knowledgeVersionId);
        if (requested.sessionId !== sessionId) throw errors.notFound();
      },
    },
    async (tx) => {
      const latest = await getLatestVersion(tx, ctx, sessionId);
      if (!latest) throw errors.validationFailed({ knowledgeVersionId: ["processing_required"] });
      const current = await getNotebook(tx, ctx, sessionId);
      // Older callbacks can neither undo a newer publication nor add duplicate revisions.
      if (current?.current.knowledgeVersionId === latest.id)
        return { status: 200, body: { revisionId: current.current.id } };
      const previousKnowledge = current
        ? await getVersion(tx, ctx, current.current.knowledgeVersionId)
        : null;
      if (previousKnowledge && previousKnowledge.version >= latest.version)
        return { status: 200, body: { revisionId: current?.current.id } };
      const edits =
        current && previousKnowledge
          ? reconcileAutomaticEdits(previousKnowledge.model, latest.model, current.current.edits)
          : notebookEditsSchema.parse({});
      let notebook = await tx
        .selectFrom("note.notebook")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("user_id", "=", ctx.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!notebook)
        notebook = await tx
          .insertInto("note.notebook")
          .values({ user_id: ctx.userId, session_id: sessionId, created_at: now })
          .returningAll()
          .executeTakeFirstOrThrow();
      const last = await tx
        .selectFrom("note.revision")
        .select("revision_number")
        .where("notebook_id", "=", notebook.id)
        .orderBy("revision_number", "desc")
        .executeTakeFirst();
      const revision = await tx
        .insertInto("note.revision")
        .values({
          user_id: ctx.userId,
          notebook_id: notebook.id,
          knowledge_version_id: latest.id,
          revision_number: (last?.revision_number ?? 0) + 1,
          model: JSON.stringify(applyNotebookEdits(latest.model, edits)),
          edits: JSON.stringify(edits),
          created_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("note.notebook")
        .set({ current_revision_id: revision.id })
        .where("id", "=", notebook.id)
        .execute();
      await tx
        .insertInto("note.outbox")
        .values({
          user_id: ctx.userId,
          session_id: sessionId,
          revision_id: revision.id,
          created_at: now,
        })
        .execute();
      return { status: 201, body: { revisionId: revision.id } };
    },
  );
  // Cached callbacks return the current publication, never an older cached revision.
  const notebook = await getNotebook(db, ctx, sessionId);
  if (!notebook) throw errors.notFound();
  return notebook;
}
