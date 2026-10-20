import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockProvider,
  NOW,
  providerSettings,
  runSource,
  stageRun,
  syntheticJob,
} from "../../../test/processing-run";
import { YIELDED } from "./context";
import { extractImageSources } from "./image-sources";
import { YIELD_DELAY_SECONDS } from "./runtime";

const m = vi.hoisted(() => ({
  completedSteps: vi.fn(),
  checkpointAndContinue: vi.fn(),
  storeExtraction: vi.fn(),
  providerStep: vi.fn(),
  readOwnedObject: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  completedSteps: m.completedSteps,
  checkpointAndContinue: m.checkpointAndContinue,
  storeExtraction: m.storeExtraction,
  providerStep: m.providerStep,
}));
vi.mock("../../plt", async (original) => ({
  ...(await original<object>()),
  readOwnedObject: m.readOwnedObject,
}));

// QUA-01: the photo extraction stage, with a mock provider and mocked checkpoints.
const bytes = new Uint8Array([7, 7, 7]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const photo = (role?: "board_photo" | "user_notes") => ({
  ...runSource({
    kind: "image",
    mimeType: "image/jpeg",
    sha256,
    contentVersionId: null,
    units: [],
    blocks: [],
    ...(role ? { role } : {}),
  }),
  objectId: "66666666-6666-4666-8666-666666666666",
});
const reading = { classification: { role: "user_notes", confidence: "high" }, blocks: [] };

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.readOwnedObject.mockResolvedValue(bytes);
  m.providerStep.mockResolvedValue(reading);
  m.completedSteps.mockResolvedValue(new Set());
});

describe("extractImageSources", () => {
  it("reads this photo and every later unread photo, then yields", async () => {
    const [first, done, later] = [photo("board_photo"), photo(), photo("user_notes")];
    const provider = mockProvider(
      providerSettings({
        lessonQuality: {
          version: "lesson-quality-1",
          budget: "lesson-budget-1",
          sourceCoverage: true,
          structuredBoard: true,
          boardVisionModel: "synthetic/board",
        },
      }),
    );
    const run = stageRun({
      provider,
      settings: {
        provider: provider.settings,
        explanationLanguage: "fa",
        profileVersion: 1,
        teachingPreferences: { shorterExamples: false },
      },
    });
    run.snapshot = { ...run.snapshot, sources: [first, done, later] };
    m.completedSteps.mockResolvedValue(new Set([`source:${done.sourceId}`]));
    expect(await extractImageSources(run, first)).toBe(YIELDED);
    expect(m.providerStep.mock.calls.map((call) => [call[3], call[4]])).toEqual([
      [`vision:${first.sourceId}`, "synthetic/board"],
      [`vision:${later.sourceId}`, "synthetic/vision"],
    ]);
    const [, , , stored, content, settings] = m.storeExtraction.mock.calls[0] ?? [];
    expect(stored).toBe(first);
    expect(content.units).toEqual([
      { id: "image-1", kind: "document", start: 1, status: "failed", reason: "unreadable_image" },
    ]);
    expect(settings).toEqual({
      provider: "synthetic",
      model: "synthetic/board",
      sourceClassification: reading.classification,
    });
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      0,
    );
  });
  it("refuses a photo whose bytes changed", async () => {
    const changed = { ...photo(), sha256: "b".repeat(64) };
    const run = stageRun();
    run.snapshot = { ...run.snapshot, sources: [changed] };
    await expect(extractImageSources(run, changed)).rejects.toMatchObject({
      details: { fields: { source: ["integrity_mismatch"] } },
    });
    expect(m.checkpointAndContinue).not.toHaveBeenCalled();
  });
  it("starts no reading that cannot finish before the deadline, and waits", async () => {
    const only = photo();
    const run = stageRun({ job: syntheticJob([], new Date(NOW.getTime() + 1000)) });
    run.snapshot = { ...run.snapshot, sources: [only] };
    expect(await extractImageSources(run, only)).toBe(YIELDED);
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      YIELD_DELAY_SECONDS,
    );
  });
});
