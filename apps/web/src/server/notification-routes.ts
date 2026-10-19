import "server-only";
import { lockAccount } from "@recalino/core/acc";
import { getSessionsByIds } from "@recalino/core/org";
import {
  browserPushSubscriptionSchema,
  learnerNotifications,
  markNotificationsRead,
  ownsBrowserPushSubscription,
  removeBrowserPushSubscription,
  saveBrowserPushSubscription,
} from "@recalino/core/plt";
import { z } from "zod";
import { type Handler, learnerActor } from "./api";
import { readWebPushConfiguration } from "./processing-notifications";

export function notificationsHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    const actor = learnerActor(ctx);
    if (request.method === "PATCH") {
      const { ids } = z.strictObject({ ids: z.array(z.uuid()).max(50) }).parse(input);
      await markNotificationsRead(db, actor, ids);
    }
    const inbox = await learnerNotifications(db, actor);
    const sessions = await getSessionsByIds(
      db,
      actor,
      inbox.items.map((item) => item.href.split("/")[2] as string),
    );
    const titles = new Map(sessions.map((session) => [session.id, session.displayTitle]));
    return {
      body: {
        ...inbox,
        items: inbox.items.map((item) => ({
          ...item,
          classTitle: titles.get(item.href.split("/")[2] as string) ?? null,
        })),
      },
    };
  };
}
export function notificationPushHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    const actor = learnerActor(ctx);
    if (request.method === "POST") {
      if (!readWebPushConfiguration()) return { status: 503, body: { available: false } };
      const subscription = browserPushSubscriptionSchema.strict().parse(input);
      await db.transaction().execute(async (tx) => {
        await lockAccount(tx, actor.userId);
        await saveBrowserPushSubscription(tx, actor, subscription);
      });
      return { body: { subscribed: true } };
    }
    if (request.method === "DELETE") {
      const { endpoint } = z.strictObject({ endpoint: z.string().max(4096) }).parse(input);
      await removeBrowserPushSubscription(db, actor, endpoint);
      return { body: { subscribed: false } };
    }
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    return {
      body: {
        publicKey: readWebPushConfiguration()?.publicKey ?? null,
        subscribed: endpoint ? await ownsBrowserPushSubscription(db, actor, endpoint) : false,
      },
    };
  };
}
