import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getAutomaticLearningSession } from "@recalino/core/proc";
import { afterAll, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { readAutomaticLearning } from "../automatic-learning";
import { automaticLearningHandler } from "../automatic-learning-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 2 });
afterAll(() => db.destroy());
const wake = vi.fn();
// Exercise owned state and real responses while excluding provider/quota dispatch.
function route(id: string) {
  return defineRoute(
    ROUTES.classLearning,
    automaticLearningHandler(id, {
      sync: (database, learner, sessionId) => readAutomaticLearning(database, learner, sessionId),
      wake,
    }),
    routeDeps(db),
  );
}

it("requires authentication for reading and posting automatic learning", async () => {
  const id = randomUUID();
  for (const method of ["GET", "POST"]) {
    const response = await route(id)(
      requestAs(
        null,
        `/api/classes/${id}/learning`,
        method,
        method === "POST" ? { action: "sync" } : undefined,
      ),
    );
    expect(response.status).toBe(401);
  }
});

it("does not read, initialize or batch another learner's class", async () => {
  const x = await studyFixture(db);
  const other = await newLearner(db);
  for (const [method, input] of [
    ["GET", undefined],
    ["POST", { action: "sync" }],
    ["POST", { action: "begin", batchId: randomUUID() }],
  ] as const) {
    expect(
      (
        await route(x.session.id)(
          requestAs(other, `/api/classes/${x.session.id}/learning`, method, input),
        )
      ).status,
    ).toBe(404);
  }
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
});

it("preserves an open group during sync and replays completion once", async () => {
  const x = await studyFixture(db);
  const batchId = randomUUID();
  const call = (input: unknown) =>
    route(x.session.id)(
      requestAs(x.ctx.userId, `/api/classes/${x.session.id}/learning`, "POST", input),
    );
  const beforeWake = wake.mock.calls.length;
  const begun = await call({ action: "begin", batchId });
  expect(begun.status).toBe(200);
  expect(await begun.json()).toMatchObject({ batchId, revision: 1 });
  expect(wake.mock.calls.length).toBe(beforeWake);
  expect((await call({ action: "begin", batchId: randomUUID() })).status).toBe(409);
  const sync = await call({ action: "sync" });
  expect(sync.status).toBe(202);
  expect(await sync.json()).toMatchObject({ batchId, revision: 1 });
  const done = await call({ action: "complete", batchId });
  expect(done.status).toBe(202);
  expect(await done.json()).toMatchObject({ batchId: null, revision: 2 });
  expect(await (await call({ action: "complete", batchId })).json()).toMatchObject({
    batchId: null,
    revision: 2,
  });
  expect(wake).toHaveBeenLastCalledWith(
    ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
    90,
  );
});

it("requires an idempotency key for explicit retries and validates batch actions", async () => {
  const x = await studyFixture(db);
  const call = (input: unknown) =>
    route(x.session.id)(
      requestAs(x.ctx.userId, `/api/classes/${x.session.id}/learning`, "POST", input),
    );
  expect((await call({ action: "retry" })).status).toBe(400);
  expect((await call({ action: "begin", batchId: "invalid" })).status).toBe(400);
  expect((await call({ action: "complete", batchId: randomUUID() })).status).toBe(409);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
});
