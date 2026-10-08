import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { supportFeedbackHandler } from "../support-routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl());
afterAll(() => db.destroy());
const route = defineRoute(ROUTES.supportFeedback, supportFeedbackHandler(), routeDeps(db));
it("AC-FBK-001 rejects forged owner and lists only the session's feedback", async () => {
  const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
  const request = requestAs(alice, "/api/support", "POST", {
    category: "question",
    subject: "Synthetic",
    body: "Hello",
    emailNotification: false,
  });
  request.headers.set("idempotency-key", randomUUID());
  expect((await route(request)).status).toBe(201);
  expect(await (await route(requestAs(bob, `/api/support?userId=${alice}`, "GET"))).json()).toEqual(
    [],
  );
  const forged = requestAs(bob, "/api/support", "POST", {
    userId: alice,
    category: "question",
    subject: "Synthetic",
    body: "Hello",
    emailNotification: false,
  });
  forged.headers.set("idempotency-key", randomUUID());
  expect((await route(forged)).status).toBe(400);
  expect((await route(requestAs(null, "/api/support", "GET"))).status).toBe(401);
});
