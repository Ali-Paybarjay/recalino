import { expect, it } from "vitest";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { learningHandler } from "../pers-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgTestDatabase } from "./org-support";

const db = orgTestDatabase();
it("requires sign-in and ignores a forged owner filter", async () => {
  const owner = await studyFixture(db, { autoAdd: true });
  const other = await studyFixture(db);
  const route = defineRoute(ROUTES.learning, learningHandler(), routeDeps(db));
  expect((await route(requestAs(null, "/api/learning", "GET"))).status).toBe(401);
  const response = await route(
    requestAs(other.ctx.userId, `/api/learning?userId=${owner.ctx.userId}`, "GET"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.acceptedCards).toBe(0);
});
