import { sql } from "kysely";
import type { Database, Tx } from "../db";
import { redactVersionGenerations } from "../lkm";
import type { LearnerContext } from "../plt";
import {
  adaptationWithoutSources,
  learnerTeachingContextSchema,
  withoutPracticeSources,
} from "./learner-context";

/**
 * D49 PRIV (PRD-DEL-02/03): a memory point names another class's goal and its review evidence.
 * When that class, or a source it was built from, is deleted, the point leaves every other
 * run snapshot and every saved lesson adaptation. Idempotent; tombstone and cleanup both run it.
 */
export async function forgetPracticeSources(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionIds: readonly string[],
): Promise<void> {
  const deleted = new Set(sessionIds);
  if (!deleted.size) return;
  const runs = await db
    .selectFrom("proc.processing_run")
    .select(["id", "settings"])
    .where("user_id", "=", ctx.userId)
    .where((eb) =>
      eb.or(
        [...deleted].map(
          (sessionId) =>
            sql<boolean>`settings @> ${JSON.stringify({
              learnerContext: { practiceCandidates: [{ sourceSessionId: sessionId }] },
            })}::jsonb`,
        ),
      ),
    )
    .execute();
  for (const run of runs) {
    const settings = run.settings as Record<string, unknown>;
    // Only the learner context is read, so an older shape elsewhere never blocks the deletion.
    const parsed = learnerTeachingContextSchema.safeParse(settings.learnerContext);
    if (!parsed.success) continue;
    const learnerContext = withoutPracticeSources(parsed.data, deleted);
    if (!learnerContext) continue;
    // Only the learner context changes; the rest of the stored settings stays byte-for-byte.
    await db
      .updateTable("proc.processing_run")
      .set({
        settings: JSON.stringify({ ...settings, learnerContext }),
      })
      .where("user_id", "=", ctx.userId)
      .where("id", "=", run.id)
      .execute();
  }
  await redactVersionGenerations(
    db,
    ctx,
    [...deleted].map((sessionId) => ({
      teachingAdaptation: { focus: [{ sourceSessionId: sessionId }] },
    })),
    (generation, items) => adaptationWithoutSources(generation, deleted, items),
  );
}
