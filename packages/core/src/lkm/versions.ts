import { type Selectable, sql } from "kysely";
import type { Database, DB, Tx } from "../db";
import { assertSessionOwner, filterLiveSessionIds, getSession } from "../org";
import { assertOwner, errors, type LearnerContext } from "../plt";
import {
  type EvidenceSource,
  type KnowledgeModel,
  knowledgeModelSchema,
  validateKnowledgeModel,
} from "./schema";

export interface KnowledgeVersion {
  id: string;
  sessionId: string;
  runId: string;
  version: number;
  sourcesVersion: number;
  sourceFingerprint: string;
  model: KnowledgeModel;
  generation: unknown;
  createdAt: string;
}

export interface KnowledgeVersionReference {
  id: string;
  sessionId: string;
  version: number;
}

/** A bounded read projection for publication checks; no generated or source text is copied. */
export async function listAvailableKnowledgeReferences(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<KnowledgeVersionReference[]> {
  const live = await filterLiveSessionIds(db, ctx, sessionIds);
  if (!live.length) return [];
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .select(["id", "session_id", "version"])
    .where("user_id", "=", ctx.userId)
    .where("session_id", "in", live)
    .where("tombstoned_at", "is", null)
    .orderBy("version", "desc")
    .execute();
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id, version: row.version }));
}

/**
 * PERF-04: which of these versions getVersion would return, in a constant number of reads:
 * owned, not tombstoned and of a live session.
 */
export async function liveKnowledgeVersionIds(
  db: Database | Tx,
  ctx: LearnerContext,
  ids: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .select(["id", "session_id"])
    .where("user_id", "=", ctx.userId)
    .where("id", "in", unique)
    .where("tombstoned_at", "is", null)
    .execute();
  const live = new Set(
    await filterLiveSessionIds(
      db,
      ctx,
      rows.map((row) => row.session_id),
    ),
  );
  return new Set(rows.filter((row) => live.has(row.session_id)).map((row) => row.id));
}

/** Latest validated model per live owned session, for learning overviews before publication. */
export async function listLatestAvailableKnowledgeVersions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<KnowledgeVersion[]> {
  const live = await filterLiveSessionIds(db, ctx, sessionIds);
  if (!live.length) return [];
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .distinctOn("session_id")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "in", live)
    .where("tombstoned_at", "is", null)
    .orderBy("session_id", "asc")
    .orderBy("version", "desc")
    .execute();
  return rows.map(view);
}
function view(row: Selectable<DB["lkm.knowledge_version"]>): KnowledgeVersion {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    version: row.version,
    sourcesVersion: row.sources_version,
    sourceFingerprint: row.source_fingerprint,
    model: knowledgeModelSchema.parse(row.model),
    generation: row.generation,
    createdAt: row.created_at.toISOString(),
  };
}
export async function getVersion(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<KnowledgeVersion> {
  const row = await db
    .selectFrom("lkm.knowledge_version")
    .selectAll()
    .where("id", "=", id)
    .where("tombstoned_at", "is", null)
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  await getSession(db, ctx, row.session_id);
  return view(row);
}
export async function listVersions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<KnowledgeVersion[]> {
  await getSession(db, ctx, sessionId);
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .orderBy("version", "desc")
    .execute();
  return rows.map(view);
}
export async function getLatestVersion(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<KnowledgeVersion | null> {
  await getSession(db, ctx, sessionId);
  const row = await db
    .selectFrom("lkm.knowledge_version")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? view(row) : null;
}

/** Identifiers only for cleanup coordination; tombstoned account/classes remain cleanable. */
export async function liveKnowledgeVersionIdsForCleanup(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .execute();
  return rows.map((row) => row.id);
}

/** AC-11, AC-17: immutable proposed versions never overwrite NOTE/CARD user edits. */
export async function publishKnowledgeVersion(
  tx: Tx,
  ctx: LearnerContext,
  input: {
    runId: string;
    sessionId: string;
    sourcesVersion: number;
    sourceFingerprint: string;
    model: unknown;
    sources: readonly EvidenceSource[];
    explanationLanguage: string;
    generation: unknown;
  },
  now = new Date(),
): Promise<KnowledgeVersion> {
  await assertSessionOwner(tx, ctx, input.sessionId);
  const model = validateKnowledgeModel(input.model, input.sources, input.explanationLanguage);
  const previous = await tx
    .selectFrom("lkm.knowledge_version")
    .selectAll()
    .where("run_id", "=", input.runId)
    .executeTakeFirst();
  if (previous) {
    assertOwner({ ownerId: previous.user_id }, ctx);
    if (previous.tombstoned_at !== null) throw errors.notFound();
    return view(previous);
  }
  const latest = await tx
    .selectFrom("lkm.knowledge_version")
    .select("version")
    .where("session_id", "=", input.sessionId)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  const row = await tx
    .insertInto("lkm.knowledge_version")
    .values({
      user_id: ctx.userId,
      session_id: input.sessionId,
      run_id: input.runId,
      version: (latest?.version ?? 0) + 1,
      schema_version: model.schemaVersion,
      sources_version: input.sourcesVersion,
      source_fingerprint: input.sourceFingerprint,
      model: JSON.stringify(model),
      generation: JSON.stringify(input.generation),
      created_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return view(row);
}
export async function tombstoneKnowledge(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await tx
    .updateTable("lkm.knowledge_version")
    .set({ tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is", null)
    .execute();
}

/**
 * PRIV redaction of derived generation metadata when its source data is deleted. Only rows whose
 * `generation` contains one of `containsAny` are read; the knowledge model is never rewritten.
 * `redact` returns the replacement generation, or undefined to keep a row unchanged.
 */
export async function redactVersionGenerations(
  db: Database | Tx,
  ctx: LearnerContext,
  containsAny: readonly unknown[],
  redact: (
    generation: unknown,
    items: readonly { id: string; study?: { en: string } }[],
  ) => unknown,
): Promise<number> {
  if (!containsAny.length) return 0;
  const rows = await db
    .selectFrom("lkm.knowledge_version")
    .select(["id", "generation", "model"])
    .where("user_id", "=", ctx.userId)
    .where((eb) =>
      eb.or(
        containsAny.map((value) => sql<boolean>`generation @> ${JSON.stringify(value)}::jsonb`),
      ),
    )
    .execute();
  let changed = 0;
  for (const row of rows) {
    // Read leniently: a redaction must never be blocked by an older model shape.
    const model = row.model as { learningItems?: unknown } | null;
    const items = (Array.isArray(model?.learningItems) ? model.learningItems : []).flatMap(
      (item: { id?: unknown; study?: { en?: unknown } }) =>
        typeof item?.id === "string"
          ? [
              typeof item.study?.en === "string"
                ? { id: item.id, study: { en: item.study.en } }
                : { id: item.id },
            ]
          : [],
    );
    const next = redact(row.generation, items);
    if (next === undefined) continue;
    await db
      .updateTable("lkm.knowledge_version")
      .set({ generation: JSON.stringify(next) })
      .where("user_id", "=", ctx.userId)
      .where("id", "=", row.id)
      .execute();
    changed++;
  }
  return changed;
}

export async function cleanupSessionKnowledge(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db
    .deleteFrom("lkm.knowledge_version")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("tombstoned_at", "is not", null)
    .execute();
}
export async function cleanupAccountKnowledge(db: Database, ctx: LearnerContext): Promise<void> {
  await db
    .deleteFrom("lkm.knowledge_version")
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is not", null)
    .execute();
}
export async function tombstoneAccountKnowledge(
  tx: Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await tx
    .updateTable("lkm.knowledge_version")
    .set({ tombstoned_at: now })
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is", null)
    .execute();
}
