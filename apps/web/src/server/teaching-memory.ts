import "server-only";
import type { Database } from "@recalino/core/db";
import { getVersion, type KnowledgeVersion } from "@recalino/core/lkm";
import { practiceCandidatesForRun } from "@recalino/core/pers";
import { AppError, createLogger, type LearnerContext } from "@recalino/core/plt";
import {
  type LessonAdaptationView,
  lessonAdaptationView,
  type PracticeCandidate,
} from "@recalino/core/proc";

/**
 * D48: memory is optional teaching context. It is read before the run transaction, so a
 * failure here degrades to a version 1 snapshot instead of blocking class processing or
 * aborting the reservation transaction. The log carries no class text or labels.
 */
export async function practiceCandidatesBeforeRun(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  now: Date,
): Promise<readonly PracticeCandidate[]> {
  try {
    return await db
      .transaction()
      .execute((tx) => practiceCandidatesForRun(tx, ctx, { sessionId, now }));
  } catch (error) {
    createLogger()("error", "practice_memory_unavailable", {
      request_id: ctx.requestId,
      user_id: ctx.userId,
      code: error instanceof AppError ? error.code : "practice_memory_unavailable",
    });
    return [];
  }
}

/** The adaptation of a shown lesson version; an unavailable version shows none, never an error. */
export async function lessonAdaptationFor(
  db: Database,
  ctx: LearnerContext,
  version: KnowledgeVersion | string | null | undefined,
  shown: readonly { id: string; study?: { en: string } }[],
): Promise<LessonAdaptationView | null> {
  if (!version) return null;
  try {
    const record = typeof version === "string" ? await getVersion(db, ctx, version) : version;
    return lessonAdaptationView(record.generation, shown);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return null;
    throw error;
  }
}
