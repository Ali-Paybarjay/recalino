import { randomUUID } from "node:crypto";
import type { Database } from "@recalino/core/db";
import { errors } from "@recalino/core/plt";
import { beforeEach, expect, it, vi } from "vitest";
import { automaticLearningHandler } from "./automatic-learning-routes";

// D105 (owner decision 2026-10-20): "Process this session" names the revision the learner saw, so
// a replay or a press made after other material arrived never processes material nobody confirmed.
const requestProcessing = vi.hoisted(() => vi.fn());
vi.mock("@recalino/core/proc", async (original) => ({
  ...(await original<object>()),
  requestAutomaticProcessing: requestProcessing,
}));
const sessionId = randomUUID(),
  userId = randomUUID();
const db = {} as Database;
const read = vi.fn(),
  sync = vi.fn(),
  wake = vi.fn();
const handler = automaticLearningHandler(sessionId, { read, sync, wake });
function args(input: unknown, key: string | null = randomUUID()) {
  return {
    request: new Request(`http://localhost/api/classes/${sessionId}/learning`, {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : {},
    }),
    input,
    db,
    ctx: { userId, requestId: "synthetic-process-route", route: "classLearning" },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  requestProcessing.mockResolvedValue(undefined);
  sync.mockResolvedValue({ state: "waiting_sources", processRequest: "requested" });
});

it("D105: passes the revision the learner saw to the press and returns the new status", async () => {
  expect(await handler(args({ action: "process", revision: 3 }))).toEqual({
    status: 202,
    body: { state: "waiting_sources", processRequest: "requested" },
  });
  expect(requestProcessing).toHaveBeenCalledExactlyOnceWith(
    db,
    { userId, requestId: "synthetic-process-route" },
    sessionId,
    expect.any(Date),
    3,
  );
  expect(sync).toHaveBeenCalledOnce();
  expect(wake).toHaveBeenCalledOnce();
});

it("D105: a class without intent is processed from revision 0", async () => {
  await handler(args({ action: "process", revision: 0 }));
  expect(requestProcessing).toHaveBeenCalledWith(
    db,
    expect.anything(),
    sessionId,
    expect.any(Date),
    0,
  );
});

it.each([
  { action: "process" },
  { action: "process", revision: -1 },
  { action: "process", revision: 1.5 },
  { action: "process", revision: "2" },
  { action: "process", revision: 2, expectedFingerprint: "x" },
])(
  "D105: refuses a press without a valid revision (%o) before changing anything",
  async (input) => {
    await expect(handler(args(input))).rejects.toBeDefined();
    expect(requestProcessing).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  },
);

it("D105: requires an idempotency key before recording a press", async () => {
  await expect(handler(args({ action: "process", revision: 1 }, null))).rejects.toMatchObject({
    code: "validation_failed",
  });
  expect(requestProcessing).not.toHaveBeenCalled();
});

it("D105: a press on a stale revision is refused without syncing or waking any worker", async () => {
  requestProcessing.mockRejectedValue(
    errors.validationFailed({ sources: ["changed_after_estimate"] }),
  );
  await expect(handler(args({ action: "process", revision: 1 }))).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { sources: ["changed_after_estimate"] } },
  });
  expect(sync).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});
