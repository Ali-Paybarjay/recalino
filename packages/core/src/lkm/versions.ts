import type { Selectable } from "kysely";
import type { Database, DB, Tx } from "../db";
import { assertSessionOwner, getSession } from "../org";
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
