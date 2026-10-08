import { randomUUID } from "node:crypto";
import { ownsBrowserPushSubscription, saveBrowserPushSubscription } from "@recalino/core/plt";
import { expect, it } from "vitest";
import { defineRoute } from "../api";
import { notificationPushHandler } from "../notification-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgFixture, orgTestDatabase } from "./org-support";

const db = orgTestDatabase();
it("reveals no other account's subscription and cannot remove it using a guessed endpoint", async () => {
  const owner = await orgFixture(db),
    other = await orgFixture(db);
  const input = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
  };
  await saveBrowserPushSubscription(db, owner.actor, input);
  const route = defineRoute(ROUTES.notificationPush, notificationPushHandler(), routeDeps(db));
  expect((await route(requestAs(null, "/api/notifications/push", "GET"))).status).toBe(401);
  const response = await route(
    requestAs(
      other.owner,
      `/api/notifications/push?endpoint=${encodeURIComponent(input.endpoint)}`,
      "GET",
    ),
  );
  expect((await response.json()).subscribed).toBe(false);
  expect(
    (
      await route(
        requestAs(other.owner, "/api/notifications/push", "DELETE", { endpoint: input.endpoint }),
      )
    ).status,
  ).toBe(200);
  expect(await ownsBrowserPushSubscription(db, owner.actor, input.endpoint)).toBe(true);
  expect(
    (
      await route(
        requestAs(other.owner, "/api/notifications/push", "DELETE", {
          endpoint: input.endpoint,
          userId: owner.owner,
        }),
      )
    ).status,
  ).toBe(400);
  await expect(
    saveBrowserPushSubscription(db, other.actor, {
      ...input,
      keys: { ...input.keys, auth: "c".repeat(22) },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await ownsBrowserPushSubscription(db, owner.actor, input.endpoint)).toBe(true);
});
