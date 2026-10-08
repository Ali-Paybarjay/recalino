import { randomUUID } from "node:crypto";
import type { Database } from "@recalino/core/db";
import { beforeEach, expect, it, vi } from "vitest";
import { automaticLearningHandler } from "./automatic-learning-routes";

const requestReview = vi.hoisted(() => vi.fn());
vi.mock("@recalino/core/ops", async (original) => ({
  ...(await original<object>()),
  requestClassProcessingReview: requestReview,
}));
const sessionId = randomUUID(),
  runId = randomUUID(),
  userId = randomUUID();
const db = {} as Database;
const read = vi.fn(),
  sync = vi.fn(),
  wake = vi.fn();
const handler = automaticLearningHandler(sessionId, { read, sync, wake });
function args(key?: string, authenticated = true) {
  return {
    request: new Request(`http://localhost/api/classes/${sessionId}/learning`, {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : {},
    }),
    input: { action: "request_review", runId },
    db,
    ctx: {
      userId: authenticated ? userId : null,
      requestId: "synthetic-review-route",
      route: "classLearning",
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  requestReview.mockResolvedValue(undefined);
  read.mockResolvedValue({
    state: "blocked",
    processingReview: { state: "awaiting_review", runId },
  });
});
it("records the explicit class review and reads fresh state without syncing or waking any AI worker", async () => {
  const key = randomUUID();
  expect(await handler(args(key))).toEqual({
    body: { state: "blocked", processingReview: { state: "awaiting_review", runId } },
  });
  expect(requestReview).toHaveBeenCalledExactlyOnceWith(
    db,
    { userId, requestId: "synthetic-review-route" },
    { sessionId, runId, requestId: key },
  );
  expect(sync).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});
it.each([undefined, "bad key"])(
  "requires a valid idempotency key (%s) before recording a review",
  async (key) => {
    await expect(handler(args(key))).rejects.toMatchObject({ code: "validation_failed" });
    expect(requestReview).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  },
);
it("requires an authenticated learner before handling a review", async () => {
  await expect(handler(args(randomUUID(), false))).rejects.toMatchObject({
    code: "unauthenticated",
  });
  expect(requestReview).not.toHaveBeenCalled();
});
