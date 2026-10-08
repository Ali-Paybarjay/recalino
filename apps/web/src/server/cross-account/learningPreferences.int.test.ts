import { learningOverview } from "@recalino/core/pers";
import { expect, it } from "vitest";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { learningPreferencesHandler } from "../pers-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgTestDatabase } from "./org-support";

const db = orgTestDatabase();
it("writes only caller preferences and rejects owner injection", async () => {
  const owner = await studyFixture(db);
  const other = await studyFixture(db);
  const route = defineRoute(
    ROUTES.learningPreferences,
    learningPreferencesHandler(),
    routeDeps(db),
  );
  expect((await route(requestAs(null, "/api/learning/preferences", "PATCH", {}))).status).toBe(401);
  expect(
    (
      await route(
        requestAs(other.ctx.userId, "/api/learning/preferences", "PATCH", {
          action: "set_shorter_examples",
          value: true,
          userId: owner.ctx.userId,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await route(
        requestAs(other.ctx.userId, "/api/learning/preferences", "PATCH", {
          action: "set_shorter_examples",
          value: true,
        }),
      )
    ).status,
  ).toBe(200);
  expect((await learningOverview(db, owner.ctx)).shorterExamples).toBe(false);
  expect((await learningOverview(db, other.ctx)).shorterExamples).toBe(true);
});
