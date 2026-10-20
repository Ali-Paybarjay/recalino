import { createDatabase } from "@recalino/core/db";
import { errors, MemoryObjectStore } from "@recalino/core/plt";
import { sourceAudioVerificationJob } from "@recalino/core/src";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { sourceAudioJobDefinition } from "./source-jobs";

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  fail: vi.fn(),
  factory: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@recalino/core/proc", async (original) => ({
  ...(await original<object>()),
  activateProcessingRun: mocks.activate,
  failAwaitingUploadRun: mocks.fail,
}));
vi.mock("@recalino/core/src", async (original) => ({
  ...(await original<object>()),
  sourceAudioVerificationJob: mocks.factory,
}));
vi.mock("./automatic-learning-notifications", () => ({
  notifyAutomaticLearningForRun: mocks.notify,
  notifyAutomaticLearningForUpload: vi.fn(),
}));
vi.mock("./processing-jobs", () => ({
  getProcessingDefinition: () => ({ kind: "proc.synthetic" }),
}));
vi.mock("./audio-preparer", () => ({ audioVerifier: () => ({ inspect: vi.fn() }) }));
vi.mock("./storage", () => ({ getObjectStore: () => new MemoryObjectStore() }));

// Pool construction does not connect: mocked domain calls assert the composition boundary only.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
const ctx = {
  userId: "12345678-1234-4234-8234-123456789abc",
  requestId: "synthetic-audio-composition",
};
const runId = "12345678-1234-4234-8234-123456789def";
afterAll(() => db.destroy());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.activate.mockResolvedValue(undefined);
  mocks.fail.mockResolvedValue(undefined);
});
function callbacks() {
  sourceAudioJobDefinition();
  const call = vi.mocked(sourceAudioVerificationJob).mock.calls[0];
  if (!call?.[2] || !call[3]) throw new Error("Expected audio completion callbacks");
  return { verified: call[2], rejected: call[3] };
}
it("waits for remaining confirmed audio sources without rejecting a verified upload or refunding its hold", async () => {
  mocks.activate.mockRejectedValue(errors.validationFailed({ upload: ["incomplete"] }));
  await expect(callbacks().verified(db, ctx, runId)).resolves.toBeUndefined();
  expect(mocks.activate).toHaveBeenCalledWith(db, ctx, runId, { kind: "proc.synthetic" });
  expect(mocks.fail).not.toHaveBeenCalled();
});
it.each(["audio", "quota"])(
  "releases the awaiting hold and asks for new confirmation when verified %s exceeds the confirmed estimate",
  async (field) => {
    mocks.activate.mockRejectedValue(
      errors.validationFailed({ [field]: ["new_confirmation_required"] }),
    );
    await callbacks().verified(db, ctx, runId);
    expect(mocks.fail).toHaveBeenCalledExactlyOnceWith(db, ctx, runId, "new_confirmation_required");
  },
);
it("closes a run whose material changed after confirmation instead of leaving it waiting", async () => {
  mocks.activate.mockRejectedValue(
    errors.validationFailed({ sources: ["changed_after_confirmation"] }),
  );
  await expect(callbacks().verified(db, ctx, runId)).resolves.toBeUndefined();
  expect(mocks.fail).toHaveBeenCalledExactlyOnceWith(db, ctx, runId, "new_confirmation_required");
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(db, ctx, runId);
});
it("preserves unexpected activation failures and explicitly rejects invalid audio", async () => {
  const failure = errors.validationFailed({ audio: ["unexpected_integrity_failure"] });
  const callback = callbacks();
  mocks.activate.mockRejectedValue(failure);
  await expect(callback.verified(db, ctx, runId)).rejects.toBe(failure);
  expect(mocks.fail).not.toHaveBeenCalled();
  await callback.rejected(db, ctx, runId);
  expect(mocks.fail).toHaveBeenCalledExactlyOnceWith(db, ctx, runId, "audio_upload_rejected");
});
