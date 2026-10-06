import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { beginAutomaticLearningBatch, getAutomaticLearningSession } from "@recalino/core/proc";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { notifyAutomaticLearning } from "./automatic-learning-notifications";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 2 });
afterAll(() => db.destroy());

it("does not turn an old verification notification into automatic paid-processing intent", async () => {
  const x = await studyFixture(db);
  await notifyAutomaticLearning(db, x.ctx, x.session.id, false);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  expect(
    await db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "proc.automatic_learning")
      .where("payload", "@>", JSON.stringify({ userId: x.ctx.userId }))
      .execute(),
  ).toEqual([]);
});

it("persists one learner mutation, keeps verification pokes stable and respects an open batch", async () => {
  const x = await studyFixture(db);
  await notifyAutomaticLearning(db, x.ctx, x.session.id);
  const started = await getAutomaticLearningSession(db, x.ctx, x.session.id);
  expect(started?.requestVersion).toBe(1);
  await notifyAutomaticLearning(db, x.ctx, x.session.id, false);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(started);
  const queued = await db
    .selectFrom("plt.job")
    .selectAll()
    .where("kind", "=", "proc.automatic_learning")
    .where("payload", "@>", JSON.stringify({ userId: x.ctx.userId }))
    .execute();
  expect(queued).toHaveLength(1);
  const batch = await beginAutomaticLearningBatch(db, x.ctx, x.session.id, randomUUID());
  await notifyAutomaticLearning(db, x.ctx, x.session.id);
  const changed = await getAutomaticLearningSession(db, x.ctx, x.session.id);
  expect(changed).toMatchObject({
    requestVersion: batch.requestVersion + 1,
    batchId: batch.batchId,
  });
  await notifyAutomaticLearning(db, x.ctx, x.session.id, false);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(changed);
  expect(
    await db
      .selectFrom("plt.job")
      .selectAll()
      .where("kind", "=", "proc.automatic_learning")
      .where("payload", "@>", JSON.stringify({ userId: x.ctx.userId }))
      .execute(),
  ).toEqual(queued);
});
