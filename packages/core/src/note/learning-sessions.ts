import type { Database, Tx } from "../db";
import { type KnowledgeModel, listLatestAvailableKnowledgeVersions } from "../lkm";
import {
  type ClassSession,
  getSession,
  getSessionsByIds,
  listSessions,
  type SessionListInput,
} from "../org";
import { assertOwner, errors, type LearnerContext } from "../plt";
import { listPublishedNotebooks, type Notebook } from "./notebooks";

export interface LearningSession extends ClassSession {
  titleSource: "manual" | "material" | "date";
  topics: string[];
}

function overview(session: ClassSession, model: KnowledgeModel | undefined): LearningSession {
  const topics: string[] = [];
  const seen = new Set<string>();
  for (const topic of model?.topics ?? []) {
    const title = topic.title.trim();
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      topics.push(title);
      seen.add(key);
    }
  }
  const manual = session.title?.trim();
  const material = model?.title.trim();
  return {
    ...session,
    displayTitle: manual || material || session.displayTitle,
    titleSource: manual ? "manual" : material ? "material" : "date",
    topics,
  };
}

/** Internal batch reader; a course feed may reuse its already verified publication map. */
export async function readLearningSessions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessions: readonly ClassSession[],
  published?: Map<string, Notebook>,
): Promise<LearningSession[]> {
  if (!sessions.length) return [];
  for (const session of sessions) assertOwner(session, ctx);
  const ids = sessions.map((session) => session.id);
  const notebooks = published ?? (await listPublishedNotebooks(db, ctx, ids));
  const fallbackIds = ids.filter((id) => !notebooks.has(id));
  const latest = new Map(
    (await listLatestAvailableKnowledgeVersions(db, ctx, fallbackIds)).map((version) => [
      version.sessionId,
      version,
    ]),
  );
  return sessions.map((session) => {
    const proposal = latest.get(session.id);
    const model =
      notebooks.get(session.id)?.current.model ??
      (proposal?.sourcesVersion === session.sourcesVersion ? proposal.model : undefined);
    return overview(session, model);
  });
}

async function snapshot<T>(db: Database | Tx, read: (tx: Database | Tx) => Promise<T>): Promise<T> {
  if (db.isTransaction) return read(db);
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(read);
}

/** D40: material-based labels are a read projection; the learner's title/date/course stay intact. */
export async function enrichLearningSessions(
  db: Database | Tx,
  ctx: LearnerContext,
  sessions: readonly ClassSession[],
): Promise<LearningSession[]> {
  return snapshot(db, async (tx) => {
    for (const session of sessions) assertOwner(session, ctx);
    const rows = await getSessionsByIds(
      tx,
      ctx,
      sessions.map((session) => session.id),
    );
    const fresh = new Map(rows.map((session) => [session.id, session]));
    const ordered = sessions.map((session) => {
      const current = fresh.get(session.id);
      if (!current) throw errors.notFound();
      return current;
    });
    return readLearningSessions(tx, ctx, ordered);
  });
}

export async function getLearningSession(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<LearningSession> {
  return snapshot(db, async (tx) => {
    const session = await getSession(tx, ctx, id);
    const [learning] = await readLearningSessions(tx, ctx, [session]);
    if (!learning) throw errors.notFound();
    return learning;
  });
}

export async function listLearningSessions(
  db: Database | Tx,
  ctx: LearnerContext,
  input: SessionListInput = {},
): Promise<{ items: LearningSession[]; total: number }> {
  return snapshot(db, async (tx) => {
    const sessions = await listSessions(tx, ctx, input);
    return {
      items: await readLearningSessions(tx, ctx, sessions.items),
      total: sessions.total,
    };
  });
}
