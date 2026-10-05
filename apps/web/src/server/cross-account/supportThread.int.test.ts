import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { submitFeedback } from "@recalino/core/support";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { supportThreadHandler } from "../support-routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl());
afterAll(() => db.destroy());
it("AC-FBK-001 cannot read or reply to another learner's private conversation", async () => {
  const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
  const thread = await submitFeedback(
    db,
    { userId: alice, requestId: randomUUID() },
    {
      operationKey: randomUUID(),
      category: "question",
      subject: "Private synthetic",
      body: "Owner text",
      emailNotification: false,
    },
  );
  const route = defineRoute(ROUTES.supportThread, supportThreadHandler(thread.id), routeDeps(db));
  expect((await route(requestAs(bob, `/api/support/${thread.id}`, "GET"))).status).toBe(404);
  const intrusion = requestAs(bob, `/api/support/${thread.id}`, "POST", {
    body: "Unapproved intrusion",
  });
  intrusion.headers.set("idempotency-key", randomUUID());
  expect((await route(intrusion)).status).toBe(404);
  expect((await route(requestAs(null, `/api/support/${thread.id}`, "GET"))).status).toBe(401);
  const own = await route(requestAs(alice, `/api/support/${thread.id}`, "GET"));
  expect(own.status).toBe(200);
  expect((await own.json()).messages).toHaveLength(1);
});
