import type { Database } from "@recalino/core/db";
import type { RunSnapshot } from "@recalino/core/proc";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { type AutomaticLearningDependencies, automaticLearningSync } from "./automatic-learning";

const mocks = vi.hoisted(() => ({
  intent: vi.fn(),
  readIntent: vi.fn(),
  progress: vi.fn(),
  materials: vi.fn(),
  snapshot: vi.fn(),
  runs: vi.fn(),
  acknowledged: vi.fn(),
  createRun: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@recalino/core/proc", async (original) => ({
  ...(await original<object>()),
  requestAutomaticLearning: mocks.intent,
  getAutomaticLearningSession: mocks.readIntent,
  updateAutomaticLearningProgress: mocks.progress,
  selectProcessingSourceSnapshot: mocks.snapshot,
  listRuns: mocks.runs,
  findProcessingRunByOperationKey: mocks.acknowledged,
  createProcessingRun: mocks.createRun,
  readClassProcessingReview: mocks.review,
  // D61: no background transcription is running in these classes.
  captureTranscriptionActive: vi.fn(async () => false),
}));
vi.mock("@recalino/core/src", async (original) => ({
  ...(await original<object>()),
  sessionSources: mocks.materials,
}));
vi.mock("@recalino/core/org", async (original) => ({
  ...(await original<object>()),
  // D60 capture lease: these classes are not being recorded.
  captureInProgress: vi.fn(async () => false),
}));
vi.mock("@recalino/core/note", async (original) => ({
  ...(await original<object>()),
  getNotebook: vi.fn(async () => null),
}));

const db = {} as Database;
const sessionId = "12345678-1234-4234-8234-123456789abc";
const sourceId = "12345678-1234-4234-8234-123456789aaa";
const addedId = "12345678-1234-4234-8234-123456789bbb";
const learner = { userId: sessionId, requestId: "synthetic-batch-verification" };
const snapshot: RunSnapshot = {
  sourcesVersion: 4,
  fingerprint: "a".repeat(64),
  sources: [sourceId, addedId].map((id) => ({
    sourceId: id,
    kind: "text",
    sha256: "b".repeat(64),
    mimeType: "text/plain",
    durationMs: null,
    pageCount: null,
    objectId: null,
    contentVersionId: id,
    captureAnchor: null,
    ranges: [],
    units: [{ id: "doc", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Handout" }],
  })),
};
const dependencies: Partial<AutomaticLearningDependencies> = {
  provider: () => undefined,
  processing: vi.fn(() => ({
    kind: "proc.synthetic",
    version: 1,
    payload: z.object({ runId: z.uuid(), userId: z.uuid() }),
    run: async () => {},
  })),
};
beforeEach(() => {
  vi.clearAllMocks();
  const intent = { requestVersion: 4, batchId: null, state: "waiting_sources" };
  mocks.intent.mockResolvedValue(intent);
  mocks.readIntent.mockResolvedValue(intent);
  mocks.progress.mockResolvedValue(intent);
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.runs.mockResolvedValue([]);
  mocks.acknowledged.mockResolvedValue(null);
  mocks.createRun.mockResolvedValue({ id: "new-run", state: "queued", lastError: null });
  mocks.review.mockResolvedValue(null);
});

it.each(["pending", "verifying"])(
  "waits for a newly added, not yet selected document in %s before creating any run",
  async (uploadState) => {
    mocks.materials.mockResolvedValue([
      { assetId: sourceId, selected: true, verifiedAt: "2026-10-07", uploadState: "verified" },
      { assetId: addedId, selected: false, verifiedAt: null, uploadState },
    ]);
    const status = await automaticLearningSync(db, learner, sessionId, {
      dependencies,
    });
    expect(status).toMatchObject({ state: "waiting_sources", run: null, lastError: null });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  },
);

it("starts one run with the whole submitted batch once verification has selected every document", async () => {
  mocks.materials.mockResolvedValue(
    [sourceId, addedId].map((assetId) => ({
      assetId,
      selected: true,
      verifiedAt: "2026-10-07",
      uploadState: "verified",
    })),
  );
  const status = await automaticLearningSync(db, learner, sessionId, {
    dependencies,
  });
  expect(status).toMatchObject({ state: "processing", run: { id: "new-run" } });
  expect(mocks.createRun).toHaveBeenCalledExactlyOnceWith(
    db,
    learner,
    expect.objectContaining({
      sessionId,
      expectedFingerprint: snapshot.fingerprint,
      expectedSourcesVersion: snapshot.sourcesVersion,
      automaticRequestVersion: 4,
    }),
    expect.any(Object),
  );
});

it("allows an already verified, intentionally deselected source to stay excluded", async () => {
  mocks.materials.mockResolvedValue([
    { assetId: sourceId, selected: true, verifiedAt: "2026-10-07", uploadState: "verified" },
    { assetId: addedId, selected: false, verifiedAt: "2026-10-07", uploadState: "pending" },
  ]);
  mocks.snapshot.mockResolvedValue({ ...snapshot, sources: snapshot.sources.slice(0, 1) });
  const status = await automaticLearningSync(db, learner, sessionId, {
    dependencies,
  });
  expect(status.state).toBe("processing");
  expect(mocks.createRun).toHaveBeenCalledOnce();
});
