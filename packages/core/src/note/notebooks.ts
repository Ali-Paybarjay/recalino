import type { Selectable } from "kysely";
import { lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import {
  getLatestVersion,
  getVersion,
  type KnowledgeModel,
  knowledgeModelSchema,
  listAvailableKnowledgeReferences,
  listVersions,
  liveKnowledgeVersionIds,
  ownedKnowledgeVersionSessions,
} from "../lkm";
import { assertSessionOwner, filterLiveSessionIds, getSession } from "../org";
import {
  assertOwner,
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";
import { projectVerifiedSpeech } from "../voc";
import {
  applyNotebookEdits,
  type NotebookEdits,
  notebookEditsSchema,
  type PublishNotebookInput,
  publishNotebookSchema,
  validateNewEdits,
} from "./schema";

export interface NotebookRevision {
  id: string;
  notebookId: string;
  sessionId: string;
  number: number;
  knowledgeVersionId: string;
  model: KnowledgeModel;
  edits: NotebookEdits;
  createdAt: string;
}
export interface Notebook {
  id: string;
  sessionId: string;
  current: NotebookRevision;
  proposedKnowledgeVersionId: string | null;
}
function revision(row: Selectable<DB["note.revision"]>, sessionId: string): NotebookRevision {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    sessionId,
    number: row.revision_number,
    knowledgeVersionId: row.knowledge_version_id,
    model: knowledgeModelSchema.parse(row.model),
    edits: notebookEditsSchema.parse(row.edits),
    createdAt: row.created_at.toISOString(),
  };
}

/** Internal bulk reader: publication models remain immutable, with learner edits and provenance. */
export async function listPublishedNotebooks(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<Map<string, Notebook>> {
  const published = new Map<string, Notebook>();
  if (!sessionIds.length) return published;
  const [notebooks, references] = await Promise.all([
    db
      .selectFrom("note.notebook")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("session_id", "in", [...sessionIds])
      .where("current_revision_id", "is not", null)
      .execute(),
    listAvailableKnowledgeReferences(db, ctx, sessionIds),
  ]);
  const currentIds = notebooks.flatMap((item) =>
    item.current_revision_id ? [item.current_revision_id] : [],
  );
  if (!currentIds.length) return published;
  const rows = await db
    .selectFrom("note.revision")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("id", "in", currentIds)
    .execute();
  const revisions = new Map(rows.map((row) => [row.id, row]));
  const available = new Map(references.map((item) => [item.id, item.sessionId]));
  const latest = new Map<string, string>();
  // LKM supplies descending version order, so the first available version is the proposal.
  for (const item of references)
    if (!latest.has(item.sessionId)) latest.set(item.sessionId, item.id);
  for (const notebook of notebooks) {
    const row = notebook.current_revision_id ? revisions.get(notebook.current_revision_id) : null;
    if (
      !row ||
      row.notebook_id !== notebook.id ||
      available.get(row.knowledge_version_id) !== notebook.session_id
    )
      continue;
    const proposed = latest.get(notebook.session_id);
    published.set(notebook.session_id, {
      id: notebook.id,
      sessionId: notebook.session_id,
      current: revision(row, notebook.session_id),
      proposedKnowledgeVersionId:
        proposed && proposed !== row.knowledge_version_id ? proposed : null,
    });
  }
  return published;
}
/**
 * PERF-04: hasPublishedNotebook for many classes the caller has just found live (getSessionsByIds),
 * in at most two reads: the classes whose current revision is an owned, not tombstoned version
 * of that same class. Their liveness is not read again.
 */
export async function publishedNotebookSessionIds(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(sessionIds)];
  if (!ids.length) return new Set();
  const rows = await db
    .selectFrom("note.notebook as notebook")
    .innerJoin("note.revision as revision", "revision.id", "notebook.current_revision_id")
    .select(["notebook.session_id", "revision.knowledge_version_id"])
    .where("notebook.session_id", "in", ids)
    .where("notebook.user_id", "=", ctx.userId)
    .where("revision.user_id", "=", ctx.userId)
    .whereRef("revision.notebook_id", "=", "notebook.id")
    .execute();
  const versions = await ownedKnowledgeVersionSessions(
    db,
    ctx,
    rows.map((row) => row.knowledge_version_id),
  );
  return new Set(
    rows
      .filter((row) => versions.get(row.knowledge_version_id) === row.session_id)
      .map((row) => row.session_id),
  );
}
/** PRD-CORE-05: a readiness check needs live publication references, not the lesson model. */
export async function hasPublishedNotebook(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<boolean> {
  await getSession(db, ctx, sessionId);
  const row = await db
    .selectFrom("note.notebook as notebook")
    .innerJoin("note.revision as revision", "revision.id", "notebook.current_revision_id")
    .select("revision.knowledge_version_id")
    .where("notebook.session_id", "=", sessionId)
    .where("notebook.user_id", "=", ctx.userId)
    .where("revision.user_id", "=", ctx.userId)
    .whereRef("revision.notebook_id", "=", "notebook.id")
    .executeTakeFirst();
  if (!row) return false;
  const available = await listAvailableKnowledgeReferences(db, ctx, [sessionId]);
  return available.some(
    (reference) => reference.id === row.knowledge_version_id && reference.sessionId === sessionId,
  );
}

export async function getNotebook(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<Notebook | null> {
  await getSession(db, ctx, sessionId);
  const notebook = await db
    .selectFrom("note.notebook")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (!notebook?.current_revision_id) return null;
  const [row, latest] = await Promise.all([
    db
      .selectFrom("note.revision")
      .selectAll()
      .where("id", "=", notebook.current_revision_id)
      .where("user_id", "=", ctx.userId)
      .executeTakeFirstOrThrow(),
    getLatestVersion(db, ctx, sessionId),
  ]);
  await getVersion(db, ctx, row.knowledge_version_id);
  return {
    id: notebook.id,
    sessionId,
    current: {
      ...revision(row, sessionId),
      model: await projectVerifiedSpeech(db, ctx, sessionId, revision(row, sessionId).model),
    },
    proposedKnowledgeVersionId: latest && latest.id !== row.knowledge_version_id ? latest.id : null,
  };
}
export async function getNotebookRevision(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<NotebookRevision> {
  const row = await db
    .selectFrom("note.revision")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  await getVersion(db, ctx, row.knowledge_version_id);
  const notebook = await db
    .selectFrom("note.notebook")
    .selectAll()
    .where("id", "=", row.notebook_id)
    .executeTakeFirstOrThrow();
  await getSession(db, ctx, notebook.session_id);
  return {
    ...revision(row, notebook.session_id),
    model: await projectVerifiedSpeech(
      db,
      ctx,
      notebook.session_id,
      revision(row, notebook.session_id).model,
    ),
  };
}
/**
 * PERF-04: which of these revisions getNotebookRevision would return, in a constant number of
 * reads: owned, of a live knowledge version and of a notebook whose session is live.
 */
export async function liveNotebookRevisionIds(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const rows = await db
    .selectFrom("note.revision as revision")
    .innerJoin("note.notebook as notebook", "notebook.id", "revision.notebook_id")
    .select([
      "revision.id as id",
      "revision.knowledge_version_id as versionId",
      "notebook.session_id as sessionId",
    ])
    .where("revision.user_id", "=", ctx.userId)
    .where("revision.id", "in", unique)
    .execute();
  if (!rows.length) return new Set();
  const versions = await liveKnowledgeVersionIds(
    db,
    ctx,
    rows.map((row) => row.versionId),
  );
  const sessions = new Set(
    await filterLiveSessionIds(
      db,
      ctx,
      rows.map((row) => row.sessionId),
    ),
  );
  return new Set(
    rows
      .filter((row) => versions.has(row.versionId) && sessions.has(row.sessionId))
      .map((row) => row.id),
  );
}
export async function listNotebookRevisions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<NotebookRevision[]> {
  await getSession(db, ctx, sessionId);
  const rows = await db
    .selectFrom("note.revision")
    .innerJoin("note.notebook", "note.notebook.id", "note.revision.notebook_id")
    .selectAll("note.revision")
    .where("note.notebook.session_id", "=", sessionId)
    .where("note.revision.user_id", "=", ctx.userId)
    .orderBy("revision_number", "desc")
    .execute();
  const available = new Set((await listVersions(db, ctx, sessionId)).map((item) => item.id));
  return rows
    .filter((row) => available.has(row.knowledge_version_id))
    .map((row) => revision(row, sessionId));
}
/** A late worker cannot overwrite this layer. New versions need an explicit learner action. */
export async function publishNotebook(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  input: PublishNotebookInput,
  options: { key: string; now?: Date },
): Promise<Notebook> {
  const parsed = publishNotebookSchema.parse(input);
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const now = options.now ?? new Date();
  const result = await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: options.key,
      route: "note.publish",
      requestHash: sha256Hex(canonicalJson({ sessionId, ...parsed })),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: (tx) => lockAccount(tx, ctx.userId),
    },
    async (tx) => {
      await assertSessionOwner(tx, ctx, sessionId);
      let notebook = await tx
        .selectFrom("note.notebook")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("user_id", "=", ctx.userId)
        .forUpdate()
        .executeTakeFirst();
      const previous = notebook?.current_revision_id
        ? await tx
            .selectFrom("note.revision")
            .selectAll()
            .where("id", "=", notebook.current_revision_id)
            .executeTakeFirstOrThrow()
        : null;
      if ((previous?.id ?? null) !== parsed.expectedRevisionId) throw errors.conflict();
      const knowledge = parsed.knowledgeVersionId
        ? await getVersion(tx, ctx, parsed.knowledgeVersionId)
        : previous
          ? await getVersion(tx, ctx, previous.knowledge_version_id)
          : await getLatestVersion(tx, ctx, sessionId);
      if (!knowledge)
        throw errors.validationFailed({ knowledgeVersionId: ["processing_required"] });
      if (knowledge.sessionId !== sessionId) throw errors.notFound();
      if (parsed.edits) validateNewEdits(knowledge.model, parsed.edits);
      const priorEdits = notebookEditsSchema.parse(previous?.edits ?? {});
      const items = { ...priorEdits.items };
      for (const [id, fields] of Object.entries(parsed.edits?.items ?? {}))
        items[id] = { ...items[id], ...fields };
      const edits = notebookEditsSchema.parse({
        ...priorEdits,
        ...parsed.edits,
        claims: { ...priorEdits.claims, ...parsed.edits?.claims },
        items,
      });
      if (!notebook)
        notebook = await tx
          .insertInto("note.notebook")
          .values({ user_id: ctx.userId, session_id: sessionId, created_at: now })
          .returningAll()
          .executeTakeFirstOrThrow();
      // Source deletion clears the publication pointer before old revisions are purged.
      // A replacement publication must keep the existing notebook's sequence unique.
      const lastRevision = await tx
        .selectFrom("note.revision")
        .select("revision_number")
        .where("notebook_id", "=", notebook.id)
        .orderBy("revision_number", "desc")
        .executeTakeFirst();
      const row = await tx
        .insertInto("note.revision")
        .values({
          user_id: ctx.userId,
          notebook_id: notebook.id,
          knowledge_version_id: knowledge.id,
          revision_number: (lastRevision?.revision_number ?? 0) + 1,
          model: JSON.stringify(applyNotebookEdits(knowledge.model, edits)),
          edits: JSON.stringify(edits),
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("note.notebook")
        .set({ current_revision_id: row.id })
        .where("id", "=", notebook.id)
        .execute();
      await tx
        .insertInto("note.outbox")
        .values({
          user_id: ctx.userId,
          session_id: sessionId,
          revision_id: row.id,
          created_at: now,
        })
        .execute();
      return {
        status: 201,
        body: {
          id: notebook.id,
          sessionId,
          current: revision(row, sessionId),
          proposedKnowledgeVersionId: null,
        },
      };
    },
  );
  const published = result.body as Notebook;
  if (result.replayed) await getNotebookRevision(db, ctx, published.current.id);
  return published;
}
/** PRIV clears the publication pointer atomically; immutable revisions remain until cleanup. */
export async function tombstoneSessionNotes(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await tx
    .updateTable("note.notebook")
    .set({ current_revision_id: null })
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .execute();
}
