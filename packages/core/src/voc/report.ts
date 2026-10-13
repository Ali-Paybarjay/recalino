import type { Database, Tx } from "../db";

/**
 * Operator report (NFR-07): start and finish of the voice analyses saved for the given runs
 * (D71). Times and identifiers only; no utterances, embeddings or class content.
 */
export async function voiceAnalysisTimes(
  db: Database | Tx,
  runIds: readonly string[],
): Promise<{ runId: string; startedAt: Date | null; finishedAt: Date | null }[]> {
  if (!runIds.length) return [];
  return db
    .selectFrom("voc.analysis")
    .select([
      "run_id as runId",
      "analysis_started_at as startedAt",
      "analysis_finished_at as finishedAt",
    ])
    .where("run_id", "in", [...runIds])
    .execute();
}
