import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import type { JobContext } from "./jobs";
import {
  browserPushDeliveryJob,
  clearAccountNotifications,
  clearSessionNotifications,
  learnerNotifications,
  recordLearnerNotification,
  saveBrowserPushSubscription,
} from "./notifications";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
function subscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
  };
}
function job(): JobContext {
  return {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => {
      throw new Error("unexpected checkpoint");
    },
  };
}
it("commits inbox, snapshotted recipients and queue atomically, then deduplicates replays", async () => {
  const x = await studyFixture(db);
  const one = subscription();
  await saveBrowserPushSubscription(db, x.ctx, one);
  const create = () =>
    db.transaction().execute((tx) =>
      recordLearnerNotification(
        tx,
        x.ctx,
        {
          deduplicationKey: "processing:test",
          kind: "processing_ready",
          href: `/classes/${x.session.id}/notes`,
        },
        new Date(),
      ),
    );
  const id = await create();
  expect(id).toBeTypeOf("string");
  expect(await create()).toBeNull();
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(1);
  expect(
    await db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "plt.deliver_push")
      .where("singleton_key", "=", id)
      .execute(),
  ).toHaveLength(1);
  await saveBrowserPushSubscription(db, x.ctx, subscription());
  const deliveries = await db
    .selectFrom("plt.push_delivery")
    .selectAll()
    .where("notification_id", "=", id as string)
    .execute();
  expect(deliveries).toHaveLength(1);
});
it("retries only the failed device, removes expired recipients and tolerates replay after deletion", async () => {
  const x = await studyFixture(db);
  const good = subscription(),
    retry = subscription(),
    expired = subscription();
  for (const item of [good, retry, expired]) await saveBrowserPushSubscription(db, x.ctx, item);
  const id = (await db.transaction().execute((tx) =>
    recordLearnerNotification(
      tx,
      x.ctx,
      {
        deduplicationKey: "processing:retry",
        kind: "processing_partial",
        href: `/classes/${x.session.id}/notes`,
      },
      new Date(),
    ),
  )) as string;
  let fail = true;
  const calls: string[] = [];
  const definition = browserPushDeliveryJob(async (target) => {
    calls.push(target.endpoint);
    if (target.endpoint === retry.endpoint && fail) throw new Error("synthetic network outage");
    return target.endpoint === expired.endpoint ? "expired" : "sent";
  });
  const payload = { notificationId: id, userId: x.ctx.userId };
  await expect(definition.run(payload, job())).rejects.toThrow("push_delivery_failed");
  fail = false;
  await definition.run(payload, job());
  expect(calls.filter((endpoint) => endpoint === good.endpoint)).toHaveLength(1);
  expect(calls.filter((endpoint) => endpoint === retry.endpoint)).toHaveLength(2);
  expect(calls.filter((endpoint) => endpoint === expired.endpoint)).toHaveLength(1);
  expect(
    await db
      .selectFrom("plt.push_subscription")
      .select("id")
      .where("endpoint", "=", expired.endpoint)
      .execute(),
  ).toHaveLength(0);
  await clearSessionNotifications(db, x.ctx, x.session.id);
  await definition.run(payload, job());
  expect(calls).toHaveLength(4);
  await clearAccountNotifications(db, x.ctx);
  expect(
    await db
      .selectFrom("plt.push_subscription")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  ).toHaveLength(0);
});
