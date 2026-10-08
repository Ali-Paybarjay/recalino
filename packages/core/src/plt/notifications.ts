import type { Selectable } from "kysely";
import { z } from "zod";
import type { Database, DB, Tx } from "../db";
import { errors } from "./errors";
import { enqueueJob, type JobDefinition } from "./jobs";
import type { LearnerContext } from "./ownership";
import { readPltSettings } from "./settings";

export type NotificationKind = "processing_ready" | "processing_partial" | "processing_failed";
export interface LearnerNotification {
  id: string;
  kind: NotificationKind;
  href: string;
  createdAt: string;
  readAt: string | null;
}
function notificationView(row: Selectable<DB["plt.notification"]>): LearnerNotification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    href: row.href,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  };
}

export const webPushQueue = {
  kind: "plt.deliver_push",
  version: 1,
  payload: z.strictObject({ notificationId: z.uuid(), userId: z.uuid() }),
  options: { maxAttempts: 12, leaseSeconds: 180, retryBaseSeconds: 30, retryMaxSeconds: 3600 },
} as const;

/** The caller writes the terminal run marker in the same transaction as this inbox/outbox. */
export async function recordLearnerNotification(
  tx: Tx,
  ctx: LearnerContext,
  input: { deduplicationKey: string; kind: NotificationKind; href: string },
  now: Date,
): Promise<string | null> {
  const row = await tx
    .insertInto("plt.notification")
    .values({
      user_id: ctx.userId,
      deduplication_key: input.deduplicationKey,
      kind: input.kind,
      href: input.href,
      created_at: now,
    })
    .onConflict((oc) => oc.columns(["user_id", "deduplication_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!row) return null;
  const subscriptions = await tx
    .selectFrom("plt.push_subscription")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .execute();
  if (subscriptions.length) {
    await tx
      .insertInto("plt.push_delivery")
      .values(
        subscriptions.map((subscription) => ({
          notification_id: row.id,
          subscription_id: subscription.id,
        })),
      )
      .execute();
    await enqueueJob(tx, webPushQueue, {
      payload: { notificationId: row.id, userId: ctx.userId },
      singletonKey: row.id,
      now,
      defaults: readPltSettings().jobs,
    });
  }
  return row.id;
}

export async function learnerNotifications(db: Database, ctx: LearnerContext) {
  const [rows, count] = await Promise.all([
    db
      .selectFrom("plt.notification")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute(),
    db
      .selectFrom("plt.notification")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("user_id", "=", ctx.userId)
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow(),
  ]);
  return { items: rows.map(notificationView), unreadCount: Number(count.count) };
}

export async function markNotificationsRead(
  db: Database,
  ctx: LearnerContext,
  ids: readonly string[],
  now = new Date(),
): Promise<void> {
  if (!ids.length) return;
  await db
    .updateTable("plt.notification")
    .set({ read_at: now })
    .where("user_id", "=", ctx.userId)
    .where("id", "in", ids)
    .where("read_at", "is", null)
    .execute();
}

/** An endpoint is a delivery URL, so accept only the browser vendors' public push services. */
export function isBrowserPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
      return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "fcm.googleapis.com" ||
      host === "web.push.apple.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}
export const browserPushSubscriptionSchema = z.object({
  endpoint: z.string().max(4096).refine(isBrowserPushEndpoint),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
export type BrowserPushSubscription = z.infer<typeof browserPushSubscriptionSchema>;

export async function saveBrowserPushSubscription(
  db: Database | Tx,
  ctx: LearnerContext,
  input: BrowserPushSubscription,
  now = new Date(),
): Promise<void> {
  const parsed = browserPushSubscriptionSchema.parse(input);
  const save = async (tx: Tx) => {
    const prior = await tx
      .selectFrom("plt.push_subscription")
      .selectAll()
      .where("endpoint", "=", parsed.endpoint)
      .forUpdate()
      .executeTakeFirst();
    // A shared browser can explicitly opt the device into its new account only with both keys.
    if (prior && (prior.p256dh !== parsed.keys.p256dh || prior.auth !== parsed.keys.auth))
      throw errors.conflict();
    if (prior && prior.user_id !== ctx.userId) {
      await tx.deleteFrom("plt.push_subscription").where("id", "=", prior.id).execute();
    }
    if (!prior || prior.user_id !== ctx.userId) {
      const devices = await tx
        .selectFrom("plt.push_subscription")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("user_id", "=", ctx.userId)
        .executeTakeFirstOrThrow();
      // Keep a delivery below its lease and bound account-controlled storage/work fan-out.
      if (Number(devices.count) >= 8)
        throw errors.validationFailed({ devices: ["push_device_limit"] });
    }
    await tx
      .insertInto("plt.push_subscription")
      .values({
        user_id: ctx.userId,
        endpoint: parsed.endpoint,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.column("endpoint").doUpdateSet({ updated_at: now }))
      .execute();
  };
  if (db.isTransaction) await save(db as Tx);
  else await db.transaction().execute(save);
}
export async function removeBrowserPushSubscription(
  db: Database,
  ctx: LearnerContext,
  endpoint: string,
): Promise<void> {
  await db
    .deleteFrom("plt.push_subscription")
    .where("user_id", "=", ctx.userId)
    .where("endpoint", "=", endpoint)
    .execute();
}
export async function ownsBrowserPushSubscription(
  db: Database,
  ctx: LearnerContext,
  endpoint: string,
) {
  return !!(await db
    .selectFrom("plt.push_subscription")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("endpoint", "=", endpoint)
    .executeTakeFirst());
}

export async function clearAccountNotifications(
  db: Database | Tx,
  ctx: LearnerContext,
): Promise<void> {
  await db.deleteFrom("plt.push_subscription").where("user_id", "=", ctx.userId).execute();
  await db.deleteFrom("plt.notification").where("user_id", "=", ctx.userId).execute();
}
export async function clearSessionNotifications(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<void> {
  await db
    .deleteFrom("plt.notification")
    .where("user_id", "=", ctx.userId)
    .where("href", "in", [`/classes/${sessionId}/notes`, `/classes/${sessionId}/processing`])
    .execute();
}

export type BrowserPushSender = (
  subscription: BrowserPushSubscription,
  notification: LearnerNotification,
) => Promise<"sent" | "expired">;

/** One delivery checkpoint per device; transient errors retry through the durable job queue. */
export function browserPushDeliveryJob(
  send: BrowserPushSender,
): JobDefinition<z.infer<typeof webPushQueue.payload>> {
  return {
    ...webPushQueue,
    async run(payload, job) {
      const row = await job.db
        .selectFrom("plt.notification")
        .selectAll()
        .where("id", "=", payload.notificationId)
        .where("user_id", "=", payload.userId)
        .executeTakeFirst();
      if (!row) return;
      const deliveries = await job.db
        .selectFrom("plt.push_delivery as d")
        .innerJoin("plt.push_subscription as s", "s.id", "d.subscription_id")
        .select(["s.id", "s.endpoint", "s.p256dh", "s.auth"])
        .where("d.notification_id", "=", row.id)
        .where("d.delivered_at", "is", null)
        .where("s.user_id", "=", row.user_id)
        .execute();
      let failed = false;
      for (const subscription of deliveries) {
        try {
          const outcome = await send(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            notificationView(row),
          );
          if (outcome === "expired") {
            await job.db
              .deleteFrom("plt.push_subscription")
              .where("id", "=", subscription.id)
              .where("user_id", "=", row.user_id)
              .execute();
          } else {
            await job.db
              .updateTable("plt.push_delivery")
              .set({ delivered_at: job.now() })
              .where("notification_id", "=", row.id)
              .where("subscription_id", "=", subscription.id)
              .execute();
          }
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error("push_delivery_failed");
    },
  };
}
