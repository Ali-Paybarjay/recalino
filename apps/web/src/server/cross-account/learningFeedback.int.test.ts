import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { learningFeedbackHandler } from "../pers-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgTestDatabase } from "./org-support";

const db = orgTestDatabase();
it("D49 FR-PLT-002: only the owner can correct a practice note; a retried key adds one row", async () => {
  const owner = await studyFixture(db, { count: 1 });
  const other = await studyFixture(db, { count: 1 });
  const goal = owner.cards[0]?.learningItemId;
  if (!goal) throw new Error("missing fixture goal");
  const route = defineRoute(ROUTES.learningFeedback, learningFeedbackHandler(), routeDeps(db));
  const body = { learningItemId: goal, kind: "explain_simpler", active: true };
  const key = randomUUID();
  const request = (userId: string | null, payload: unknown = body, idempotency: string = key) => {
    const value = requestAs(userId, "/api/learning/feedback", "POST", payload);
    if (idempotency) value.headers.set("idempotency-key", idempotency);
    return value;
  };
  expect((await route(request(null))).status).toBe(401);
  expect((await route(request(owner.ctx.userId, body, ""))).status).toBe(400);
  expect((await route(request(other.ctx.userId))).status).toBe(404);
  expect(
    (await route(request(other.ctx.userId, { ...body, userId: owner.ctx.userId }, randomUUID())))
      .status,
  ).toBe(400);
  const first = await route(request(owner.ctx.userId));
  expect(first.status).toBe(200);
  expect((await first.json()).memory).toBeDefined();
  expect((await route(request(owner.ctx.userId))).status).toBe(200);
  expect(
    await db
      .selectFrom("pers.item_feedback")
      .select("user_id")
      .where("learning_item_id", "=", goal)
      .execute(),
  ).toEqual([{ user_id: owner.ctx.userId }]);
  expect(
    await db
      .selectFrom("pers.item_feedback")
      .select("id")
      .where("user_id", "=", other.ctx.userId)
      .execute(),
  ).toEqual([]);
});
