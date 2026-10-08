import { learnerNotifications, recordLearnerNotification } from "@recalino/core/plt";
import { expect, it } from "vitest";
import { defineRoute } from "../api";
import { notificationsHandler } from "../notification-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgFixture, orgTestDatabase } from "./org-support";

const db = orgTestDatabase();
it("lists and marks only the authenticated learner's notifications", async () => {
  const owner = await orgFixture(db),
    other = await orgFixture(db);
  const id = await db.transaction().execute((tx) =>
    recordLearnerNotification(
      tx,
      owner.actor,
      {
        deduplicationKey: "processing:private",
        kind: "processing_failed",
        href: `/classes/${owner.session.id}/processing`,
      },
      new Date(),
    ),
  );
  const route = defineRoute(ROUTES.notifications, notificationsHandler(), routeDeps(db));
  expect((await route(requestAs(null, "/api/notifications", "GET"))).status).toBe(401);
  expect(await (await route(requestAs(other.owner, "/api/notifications", "GET"))).json()).toEqual({
    items: [],
    unreadCount: 0,
  });
  expect(
    (await route(requestAs(other.owner, "/api/notifications", "PATCH", { ids: [id] }))).status,
  ).toBe(200);
  expect((await learnerNotifications(db, owner.actor)).unreadCount).toBe(1);
  expect(
    (
      await route(
        requestAs(other.owner, "/api/notifications", "PATCH", { ids: [id], userId: owner.owner }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await route(requestAs(owner.owner, "/api/notifications", "PATCH", { ids: [id] }))).status,
  ).toBe(200);
  expect((await learnerNotifications(db, owner.actor)).unreadCount).toBe(0);
});
