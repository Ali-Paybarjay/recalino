import { randomUUID } from "node:crypto";
import type { Database } from "../src/db";
import { getNotebook, publishNotebook } from "../src/note";
import type { LearnerContext } from "../src/plt";

/** Cross-module integration fixture for verifying source recovery preserves published edits. */
export async function publishSourceRecoveryNotebook(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  expectedRevisionId: string,
  knowledgeVersionId: string,
) {
  return publishNotebook(
    db,
    ctx,
    sessionId,
    { expectedRevisionId, knowledgeVersionId, edits: { title: "My saved title" } },
    { key: randomUUID() },
  );
}

export async function readSourceRecoveryNotebook(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
) {
  return getNotebook(db, ctx, sessionId);
}
