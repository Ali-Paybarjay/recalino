import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { releaseCaptureLease, renewCaptureLease } from "@recalino/core/org";
import { getAutomaticLearningSession } from "@recalino/core/proc";
import { afterAll, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { readAutomaticLearning } from "../automatic-learning";
import { automaticLearningHandler } from "../automatic-learning-routes";
import { PROCESSING_WAKE } from "../jobs";
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
  for (const [method, input] of [
    ["GET", undefined],
    ["POST", { action: "sync" }],
    ["POST", { action: "process" }],
  ] as const) {
    const response = await route(id)(requestAs(null, `/api/classes/${id}/learning`, method, input));
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
    PROCESSING_WAKE.budgetSeconds,
    PROCESSING_WAKE.functionSeconds,
  );
});

it("requires an idempotency key for explicit retries and validates batch actions", async () => {
  const x = await studyFixture(db);
  const call = (input: unknown) =>
    route(x.session.id)(
      requestAs(x.ctx.userId, `/api/classes/${x.session.id}/learning`, "POST", input),
    );
  expect((await call({ action: "retry" })).status).toBe(400);
  expect((await call({ action: "process" })).status).toBe(400);
  expect((await call({ action: "begin", batchId: "invalid" })).status).toBe(400);
  expect((await call({ action: "complete", batchId: randomUUID() })).status).toBe(409);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
});

// D105 (owner decision 2026-10-20): "Process this session" is the only request that starts lesson
// work. It is owner-checked, needs a key, changes nothing on a second press and is refused while
// any device records into the class.
it("D105: processes only the learner's own class, once, and never while it is being recorded", async () => {
  const x = await studyFixture(db);
  const other = await newLearner(db);
  const process = (userId: string, key: string) => {
    const request = requestAs(userId, `/api/classes/${x.session.id}/learning`, "POST", {
      action: "process",
    });
    request.headers.set("idempotency-key", key);
    return route(x.session.id)(request);
  };
  expect((await process(other, randomUUID())).status).toBe(404);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  await renewCaptureLease(db, x.ctx, x.session.id);
  const refused = await process(x.ctx.userId, randomUUID());
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    error: { code: "conflict", details: { fields: { session: ["capture_in_progress"] } } },
  });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  await releaseCaptureLease(db, x.ctx, x.session.id);
  const key = randomUUID();
  const processed = await process(x.ctx.userId, key);
  expect(processed.status).toBe(202);
  expect(await processed.json()).toMatchObject({
    revision: 1,
    requestedRevision: 1,
    processRequest: "requested",
  });
  const intent = await getAutomaticLearningSession(db, x.ctx, x.session.id);
  for (const again of [key, randomUUID()]) {
    expect((await process(x.ctx.userId, again)).status).toBe(202);
    expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(intent);
  }
  expect(wake).toHaveBeenLastCalledWith(
    ["proc.automatic_learning", "src.verify_upload", "src.verify_audio", "proc.process"],
    PROCESSING_WAKE.budgetSeconds,
    PROCESSING_WAKE.functionSeconds,
  );
  // Another learner's press cannot reach it either once it exists.
  expect((await process(other, randomUUID())).status).toBe(404);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(intent);
});

it("D105: refuses a press while an upload group of the class is open", async () => {
  const x = await studyFixture(db);
  const call = (input: unknown) => {
    const request = requestAs(x.ctx.userId, `/api/classes/${x.session.id}/learning`, "POST", input);
    request.headers.set("idempotency-key", randomUUID());
    return route(x.session.id)(request);
  };
  expect((await call({ action: "begin", batchId: randomUUID() })).status).toBe(200);
  const refused = await call({ action: "process" });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    error: { details: { fields: { batch: ["batch_open"] } } },
  });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toMatchObject({
    requestedVersion: null,
  });
});
