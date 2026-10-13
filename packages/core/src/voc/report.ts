import type { Database, Tx } from "../db";

/**
 * Operator report (NFR-07): creation and last update of the voice analyses of the given classes.
 * Times and identifiers only; no utterances, embeddings or class content.
 */
export async function voiceAnalysisTimes(
  db: Database | Tx,
  sessionIds: readonly string[],
): Promise<{ sessionId: string; userId: string; createdAt: Date; updatedAt: Date }[]> {
  if (!sessionIds.length) return [];
  return db
    .selectFrom("voc.analysis")
    .select([
      "session_id as sessionId",
      "user_id as userId",
      "created_at as createdAt",
      "updated_at as updatedAt",
    ])
    .where("session_id", "in", [...sessionIds])
    .execute();
}
