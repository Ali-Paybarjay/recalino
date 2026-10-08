import { lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import { emptyPayload, type LearnerContext, type ObjectStore, type PeriodicJob } from "../plt";
import { invalidateAutomaticVoice } from "./automatic";
import {
  cleanupVoiceSampleObjects,
  enrollmentEmbeddingsSchema,
  revokeVoiceData,
  voiceTransaction,
} from "./profile";

export async function removeSessionVoice(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
) {
  return removeVoiceScope(db, ctx, "session_id", sessionId);
}
export async function removeSourceVoice(db: Database | Tx, ctx: LearnerContext, sourceId: string) {
  return removeVoiceScope(db, ctx, "source_id", sourceId);
}
async function removeVoiceScope(
  db: Database | Tx,
  ctx: LearnerContext,
  column: "session_id" | "source_id",
  id: string,
) {
  await voiceTransaction(db, async (tx) => {
    if (!(await lockAccountForCleanup(tx, ctx.userId))) return;
    const rows = await tx
      .selectFrom("voc.analysis")
      .select("id")
      .where("user_id", "=", ctx.userId)
      .where(column, "=", id)
      .execute();
    const ids = new Set(rows.map((row) => row.id));
    const profile = await tx
      .selectFrom("voc.profile")
      .select("embeddings")
      .where("user_id", "=", ctx.userId)
      .executeTakeFirst();
    if (profile) {
      const current = enrollmentEmbeddingsSchema.parse(profile.embeddings);
      const retained = current.filter((entry) => !entry.analysisId || !ids.has(entry.analysisId));
      // Automatic matches elsewhere may rest on the reference this deletion removes.
      if (retained.length !== current.length)
        await invalidateAutomaticVoice(tx, ctx.userId, new Date());
      await tx
        .updateTable("voc.profile")
        .set({
          embeddings: JSON.stringify(retained),
          model_version: retained[0]?.modelVersion ?? null,
        })
        .where("user_id", "=", ctx.userId)
        .execute();
    }
    await tx
      .deleteFrom("voc.analysis")
      .where("user_id", "=", ctx.userId)
      .where(column, "=", id)
      .execute();
  });
}
export async function cleanupAccountVoice(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  now = new Date(),
) {
  await revokeVoiceData(db, ctx, now);
  await cleanupVoiceSampleObjects(db, store, ctx, now);
}
export async function expireVoiceEmbeddings(db: Database, now = new Date()) {
  await db
    .updateTable("voc.analysis")
    .set({ private_embeddings: "[]" })
    .where("embeddings_expire_at", "<=", now)
    .execute();
}
export function voicePeriodicJobs(store: ObjectStore): PeriodicJob[] {
  return [
    {
      everySeconds: 300,
      definition: {
        kind: "voc.cleanup",
        version: 1,
        payload: emptyPayload,
        run: async (_, job) => {
          await expireVoiceEmbeddings(job.db, job.now());
          const users = await job.db
            .selectFrom("voc.sample_object")
            .select("user_id")
            .distinct()
            .execute();
          for (const user of users)
            await cleanupVoiceSampleObjects(
              job.db,
              store,
              { userId: user.user_id, requestId: job.job.id },
              job.now(),
            );
        },
      },
    },
  ];
}
