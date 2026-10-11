import { randomUUID } from "node:crypto";
import { type AiProvider, OpenRouterProvider, providerSettingsSchema } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import type { readLessonReview, scheduleLessonReview } from "@recalino/core/eval";
import { errors } from "@recalino/core/plt";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import defaults from "../../../../config/openrouter-defaults.json";
import { classLessonReviewHandler } from "./lesson-review-routes";

vi.mock("./jobs", () => ({
  PROCESSING_WAKE: { budgetSeconds: 540, functionSeconds: 800 },
  runJobsSoon: vi.fn(),
}));

// All domain operations are injected; this pool never connects to a database.
const db = createDatabase("postgresql://unused:unused@127.0.0.1:1/unused");
afterAll(() => db.destroy());
const sessionId = randomUUID();
const knowledgeVersionId = randomUUID();
const runId = randomUUID();
const ctx = { userId: randomUUID(), requestId: randomUUID(), route: "classLessonReview" };
const learner = { userId: ctx.userId, requestId: ctx.requestId };
const request = vi.fn<typeof fetch>();
const configured = new OpenRouterProvider(
  "synthetic-no-network",
  providerSettingsSchema.parse({ ...defaults, dataContractApproved: true }),
  request,
);
const read = vi.fn<typeof readLessonReview>();
const schedule = vi.fn<typeof scheduleLessonReview>();
const provider = vi.fn<() => AiProvider | undefined>(() => configured);
const wake = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  provider.mockReturnValue(configured);
  read.mockResolvedValue(null);
  schedule.mockResolvedValue({ runId, knowledgeVersionId });
});

function call(
  method: string,
  input?: unknown,
  key?: string,
  query = `?versionId=${knowledgeVersionId}`,
) {
  return classLessonReviewHandler(sessionId, { read, schedule, provider, wake })({
    db,
    ctx,
    request: new Request(`https://recalino.test/api/classes/${sessionId}/lesson-review${query}`, {
      method,
      ...(key === undefined ? {} : { headers: { "idempotency-key": key } }),
    }),
    input,
  });
}

it("AC-EE-07 reads only the requested version without starting or resolving a provider", async () => {
  expect(await call("GET")).toEqual({ body: null });
  expect(read).toHaveBeenCalledExactlyOnceWith(db, learner, sessionId, knowledgeVersionId);
  expect(provider).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each(["", "?versionId=invalid"])(
  "rejects a missing or invalid version query (%s)",
  async (query) => {
    await expect(call("GET", undefined, undefined, query)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  },
);

it("schedules only an explicit versioned request and wakes only the review job", async () => {
  const key = randomUUID();
  expect(await call("POST", { knowledgeVersionId }, key)).toEqual({
    status: 202,
    body: { runId, knowledgeVersionId },
  });
  expect(schedule).toHaveBeenCalledExactlyOnceWith(
    db,
    learner,
    sessionId,
    { knowledgeVersionId },
    { key, provider: configured },
  );
  expect(wake).toHaveBeenCalledExactlyOnceWith(["eval.lesson_review"], 540, 800);
  expect(read).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([
  [{ knowledgeVersionId }, undefined],
  [{ knowledgeVersionId }, "bad"],
  [{ knowledgeVersionId, userId: randomUUID() }, randomUUID()],
  [{ knowledgeVersionId: "not-a-version" }, randomUUID()],
])("rejects malformed writes before resolving or scheduling provider work", async (input, key) => {
  await expect(call("POST", input, key as string | undefined)).rejects.toThrow();
  expect(provider).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});

it("preserves ownership failures without waking provider work", async () => {
  schedule.mockRejectedValueOnce(errors.ownershipDenied());
  await expect(call("POST", { knowledgeVersionId }, randomUUID())).rejects.toMatchObject({
    code: "not_found",
  });
  expect(wake).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it("keeps reads available when a provider is absent and rejects a new review clearly", async () => {
  provider.mockReturnValue(undefined);
  expect(await call("GET")).toEqual({ body: null });
  await expect(call("POST", { knowledgeVersionId }, randomUUID())).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { provider: ["configuration_unavailable"] } },
  });
  expect(schedule).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});
