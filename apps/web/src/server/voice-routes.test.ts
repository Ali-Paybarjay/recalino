import { createDatabase } from "@recalino/core/db";
import { afterAll, expect, it, vi } from "vitest";
import { classVoiceHandler } from "./voice-routes";

const mocks = vi.hoisted(() => ({ queue: vi.fn(), runJobsSoon: vi.fn() }));
vi.mock("./voice-processing", () => ({ queueVoiceAnalysis: mocks.queue }));
vi.mock("./voice-engine", () => ({ loadVoiceEngine: vi.fn(), VOICE_MODEL_REVISION: "synthetic" }));
vi.mock("./voice-sample", () => ({ prepareVoiceSample: vi.fn() }));
vi.mock("./jobs", () => ({
  PROCESSING_WAKE: { budgetSeconds: 600, functionSeconds: 800 },
  runJobsSoon: mocks.runJobsSoon,
}));

// The queue is mocked; constructing the pool never connects to a database.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const sessionId = "12345678-1234-4234-8234-123456789aaa";
const ctx = {
  userId: "12345678-1234-4234-8234-123456789abc",
  route: "classVoice",
  requestId: "synthetic-voice-check",
};

it("FR-PLT-005 keeps a requested session voice check moving on its own request instead of waiting for cron", async () => {
  mocks.queue.mockResolvedValue("synthetic-voice-run");
  const request = new Request(`https://recalino.test/api/classes/${sessionId}/voice`, {
    method: "POST",
    headers: { "idempotency-key": "synthetic-voice-check-key" },
  });
  await expect(
    classVoiceHandler(sessionId)({ db, ctx, request, input: { action: "analyze" } }),
  ).resolves.toEqual({ status: 202, body: "synthetic-voice-run" });
  expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
    db,
    { userId: ctx.userId, requestId: ctx.requestId },
    sessionId,
    "synthetic-voice-check-key",
  );
  // The correction and publish steps follow the minutes-long check without a cron minute between.
  expect(mocks.runJobsSoon).toHaveBeenCalledExactlyOnceWith(["proc.voice_analysis"], 600, 800);
});
