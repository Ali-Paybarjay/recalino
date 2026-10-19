import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, runSource, stageRun, syntheticJob } from "../../../test/processing-run";
import { ProviderError } from "../../aip";
import { errors } from "../../plt";
import type { LessonInput } from "./lesson-input";
import { generateLessonParts } from "./lesson-parts";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  providerStep: vi.fn(),
  saveStep: vi.fn(),
  liveRun: vi.fn(),
  validate: vi.fn(),
  merge: vi.fn(),
  build: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
  providerStep: m.providerStep,
  saveStep: m.saveStep,
  liveRun: m.liveRun,
}));
vi.mock("./knowledge-checks", async (original) => ({
  ...(await original<object>()),
  validateGeneratedKnowledge: m.validate,
}));
vi.mock("../knowledge-parts", async (original) => ({
  ...(await original<object>()),
  mergeLessonParts: m.merge,
}));
vi.mock("../knowledge-generation", async (original) => ({
  ...(await original<object>()),
  buildKnowledgeGenerationInput: m.build,
}));

// QUA-01: D63 part-by-part lessons, with a mock provider and mocked checkpoints.
const ATTEMPT = "abababab-abab-4bab-8bab-abababababab";
const sources = [runSource(), runSource()];
const plan = sources.map((source, index) => ({
  index,
  sources: [source],
  missingSourceIds: [],
}));
const lesson = {
  extracted: sources,
  generationData: {},
  quality: undefined,
} as unknown as LessonInput;
const part = (index: number) => ({ title: `Part ${index}` });

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of [m.providerStep, m.saveStep, m.liveRun, m.validate, m.merge, m.build])
    mock.mockReset();
  m.build.mockReturnValue({
    schema: {},
    system: "",
    input: "",
    assemble: (value: unknown) => value,
  });
  m.merge.mockReturnValue({ title: "Merged" });
});

describe("generateLessonParts", () => {
  it("buys the next part's single generation and ends the job after it", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    const run = stageRun();
    expect(await generateLessonParts(run, { lesson, plan })).toBe("checkpoint");
    expect(m.providerStep).toHaveBeenCalledTimes(1);
    const [, , runId, step, model, , , , options] = m.providerStep.mock.calls[0] ?? [];
    expect([runId, step, model, options]).toEqual([
      RUN_ID,
      "knowledge:part:1",
      "synthetic/llm",
      { singleResponse: true },
    ]);
  });
  it("records a known invalid paid response as the part's repair marker", async () => {
    const calls: unknown[][] = [];
    const run = stageRun({ job: syntheticJob(calls, undefined, [{ id: ATTEMPT }]) });
    m.providerStep.mockRejectedValue(
      new ProviderError("provider_schema_invalid", false, false, {
        provider: "synthetic",
        model: "synthetic/llm",
        actualMicros: 5,
        usage: {},
      } as never),
    );
    expect(await generateLessonParts(run, { lesson, plan })).toBe("checkpoint");
    expect(m.saveStep).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      "knowledge:part:0:schema-invalid",
      { reason: "provider_schema_invalid", attemptId: ATTEMPT },
      run.job.now(),
    );
    m.providerStep.mockRejectedValue(new ProviderError("provider_http_500", true, false));
    await expect(generateLessonParts(run, { lesson, plan })).rejects.toMatchObject({
      code: "provider_http_500",
    });
  });
  it("regenerates a part once after a repairable problem, and merges valid parts", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    m.checkpoints.set("knowledge:part:1", part(1));
    m.validate.mockImplementation((output: { title: string }) => {
      if (output.title === "Part 1")
        throw errors.validationFailed({ output: ["study_gap_missing"] });
    });
    expect(await generateLessonParts(stageRun(), { lesson, plan })).toBe("checkpoint");
    expect(m.providerStep.mock.calls[0]?.[3]).toBe("knowledge:part:1:repair");
    expect(m.build).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({ repairReason: "study_gap_missing" }),
    );
    m.checkpoints.set("knowledge:part:1:repair", part(2));
    m.providerStep.mockClear();
    expect(await generateLessonParts(stageRun(), { lesson, plan })).toEqual({ title: "Merged" });
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(m.merge.mock.calls[0]?.[0]).toEqual([part(0), part(2)]);
  });
});
