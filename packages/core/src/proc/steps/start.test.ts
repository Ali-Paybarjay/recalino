import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockProvider,
  providerSettings,
  RUN_ID,
  runSource,
  SESSION_ID,
  stageRun,
  syntheticJob,
} from "../../../test/processing-run";
import { startRun } from "./start";
import {
  extractionSchema,
  markedExtractionSchema,
  structuredExtractionSchema,
  visionContract,
} from "./vision";

const runtime = vi.hoisted(() => ({ liveRun: vi.fn() }));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  liveRun: runtime.liveRun,
}));

// QUA-01: the first stage of processingJob, with a mock provider and no database.
const settings = providerSettings();
function runRow(provider = settings) {
  return {
    id: RUN_ID,
    session_id: SESSION_ID,
    settings: { provider, explanationLanguage: "fa", profileVersion: 1 },
    input_snapshot: { sourcesVersion: 3, fingerprint: "synthetic", sources: [runSource()] },
  };
}
function base(provider = mockProvider()) {
  const calls: unknown[][] = [];
  const { ctx, payload, definition } = stageRun();
  return {
    calls,
    base: {
      job: syntheticJob(calls),
      ctx,
      payload,
      definition,
      dependencies: { store: stageRun().dependencies.store, provider },
    },
  };
}

beforeEach(() => runtime.liveRun.mockReset());

describe("startRun", () => {
  it("marks the run processing and reads its frozen settings and sources", async () => {
    runtime.liveRun.mockResolvedValue(runRow());
    const { base: input, calls } = base();
    const run = await startRun(input);
    expect(runtime.liveRun).toHaveBeenCalledWith(expect.anything(), input.ctx, RUN_ID);
    expect(calls).toContainEqual(["updateTable", "proc.processing_run"]);
    expect(calls).toContainEqual(["set", { state: "processing", updated_at: input.job.now() }]);
    expect(run.settings.teachingPreferences).toEqual({ shorterExamples: false });
    expect(run.snapshot.sourcesVersion).toBe(3);
    expect(run.initial.session_id).toBe(SESSION_ID);
    expect(run.vision.schema).toBe(extractionSchema);
  });
  it("refuses a provider whose settings changed since the run started", async () => {
    runtime.liveRun.mockResolvedValue(runRow({ ...settings, llmModel: "synthetic/older" }));
    await expect(startRun(base().base)).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { provider: ["settings_changed"] } },
    });
  });
  it("needs an approved provider before touching the run", async () => {
    const { base: input } = base(mockProvider(providerSettings({ dataContractApproved: false })));
    await expect(startRun(input)).rejects.toMatchObject({
      details: { fields: { provider: ["configuration_unavailable"] } },
    });
    expect(runtime.liveRun).not.toHaveBeenCalled();
  });
});

describe("visionContract", () => {
  const quality = {
    version: "lesson-quality-1" as const,
    budget: "lesson-budget-1" as const,
    sourceCoverage: true,
    structuredBoard: true,
  };
  it("keeps the plain OCR contract for older snapshots", () => {
    expect(visionContract(undefined)).toEqual({ schema: extractionSchema, instruction: "" });
    expect(visionContract({ ...quality, structuredBoard: false }).schema).toBe(extractionSchema);
  });
  it("reads typed blocks, and learner marks only when asked", () => {
    const board = visionContract(quality);
    const marks = visionContract({ ...quality, learnerMarks: true });
    expect(board.schema).toBe(structuredExtractionSchema);
    expect(marks.schema).toBe(markedExtractionSchema);
    expect(marks.instruction.startsWith(board.instruction)).toBe(true);
    expect(marks.instruction.length).toBeGreaterThan(board.instruction.length);
  });
});
