import { randomUUID } from "node:crypto";
import { OpenRouterProvider } from "@recalino/core/aip";
import { DEFAULT_PLT_SETTINGS } from "@recalino/core/plt";
import { cancelRun } from "@recalino/core/proc";
import { expect, it, vi } from "vitest";
import { lessonReviewFixture } from "../../../../../packages/core/test/lesson-review-fixture";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { classLessonReviewHandler } from "../lesson-review-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
import { orgTestDatabase } from "./org-support";

const db = orgTestDatabase();

function routes(
  fixture: Awaited<ReturnType<typeof lessonReviewFixture>>,
  sessionId = fixture.session.id,
) {
  const request = vi.fn<typeof fetch>();
  const provider = new OpenRouterProvider("synthetic-no-network", fixture.settings, request);
  const wake = vi.fn();
  const handler = classLessonReviewHandler(sessionId, { provider: () => provider, wake });
  const get = defineRoute(ROUTES.classLessonReview, handler, routeDeps(db));
  const post = defineRoute(
    { ...ROUTES.classLessonReview, idempotency: "handler", rateLimit: "ai_start" },
    handler,
    routeDeps(db),
  );
  const path = `/api/classes/${sessionId}/lesson-review`;
  return { get, post, path, request, wake, handler };
}

function postRequest(
  userId: string | null,
  path: string,
  knowledgeVersionId: string,
  key?: string,
) {
  const request = requestAs(userId, path, "POST", { knowledgeVersionId });
  if (key) request.headers.set("idempotency-key", key);
  return request;
}

it("requires sign-in for both report reads and explicit review requests", async () => {
  const id = randomUUID();
  const handler = classLessonReviewHandler(id, {
    provider: () => {
      throw new Error("Unauthenticated request must not resolve a provider");
    },
  });
  const route = defineRoute(ROUTES.classLessonReview, handler, routeDeps(db));
  const path = `/api/classes/${id}/lesson-review`;
  for (const request of [
    requestAs(null, `${path}?versionId=${randomUUID()}`, "GET"),
    postRequest(null, path, randomUUID(), randomUUID()),
  ]) {
    const response = await route(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

it("does not reveal or review a foreign session or a foreign version through an owned session", async () => {
  const owner = await lessonReviewFixture(db);
  const other = await studyFixture(db);
  for (const sessionId of [owner.session.id, other.session.id]) {
    const route = routes(owner, sessionId);
    const read = await route.get(
      requestAs(other.ctx.userId, `${route.path}?versionId=${owner.knowledge.id}`, "GET"),
    );
    expect(read.status).toBe(404);
    expect((await read.json()).error.code).toBe("not_found");
    const write = await route.post(
      postRequest(other.ctx.userId, route.path, owner.knowledge.id, randomUUID()),
    );
    expect(write.status).toBe(404);
    expect((await write.json()).error.code).toBe("not_found");
    expect(route.wake).not.toHaveBeenCalled();
    expect(route.request).not.toHaveBeenCalled();
  }
});

it("reads without a key or provider calls, then schedules once per explicit idempotency key", async () => {
  const owner = await lessonReviewFixture(db);
  const route = routes(owner);
  const readRequest = () =>
    requestAs(owner.ctx.userId, `${route.path}?versionId=${owner.knowledge.id}`, "GET");
  const empty = await route.get(readRequest());
  expect(empty.status).toBe(200);
  expect(await empty.json()).toBeNull();
  expect(route.wake).not.toHaveBeenCalled();
  const key = randomUUID();
  const first = await route.post(
    postRequest(owner.ctx.userId, route.path, owner.knowledge.id, key),
  );
  expect(first.status).toBe(202);
  const scheduled = await first.json();
  try {
    expect(scheduled).toEqual({
      runId: expect.any(String),
      knowledgeVersionId: owner.knowledge.id,
    });
    const replay = await route.post(
      postRequest(owner.ctx.userId, route.path, owner.knowledge.id, key),
    );
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(scheduled);
    const pending = await route.get(readRequest());
    expect(pending.headers.get("cache-control")).toBe("private, no-store");
    expect(await pending.json()).toMatchObject({
      ...scheduled,
      state: "queued",
      response: null,
      verdict: null,
    });
    expect(route.wake).toHaveBeenCalledTimes(2);
    expect(
      route.wake.mock.calls.every(([kinds]) => JSON.stringify(kinds) === '["eval.lesson_review"]'),
    ).toBe(true);
    expect(route.request).not.toHaveBeenCalled();
  } finally {
    await cancelRun(db, owner.ctx, scheduled.runId);
  }
});

it("applies the AI-start limit and refuses a missing idempotency key before scheduling", async () => {
  const owner = await lessonReviewFixture(db);
  const route = routes(owner);
  const invalid = await route.post(postRequest(owner.ctx.userId, route.path, owner.knowledge.id));
  expect(invalid.status).toBe(400);
  expect(route.wake).not.toHaveBeenCalled();
  const limited = defineRoute(
    { ...ROUTES.classLessonReview, idempotency: "handler", rateLimit: "ai_start" },
    route.handler,
    {
      ...routeDeps(db),
      settings: () => ({
        ...DEFAULT_PLT_SETTINGS,
        rateLimits: {
          ...DEFAULT_PLT_SETTINGS.rateLimits,
          // The rejected missing-key attempt above already occupies the only allowed request.
          ai_start: { limit: 1, windowSeconds: 60, scopes: ["user"] },
        },
      }),
    },
  );
  const blocked = await limited(
    postRequest(owner.ctx.userId, route.path, owner.knowledge.id, randomUUID()),
  );
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).not.toBeNull();
  expect(route.wake).not.toHaveBeenCalled();
  expect(route.request).not.toHaveBeenCalled();
});
