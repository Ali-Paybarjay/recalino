import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, runSource, stageRun, syntheticJob } from "../../../test/processing-run";
import { ProviderError } from "../../aip";
import { errors } from "../../plt";
import { emptyStudyOutputAudit, emptyStudyTally } from "../study-output-guard";
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
  productionLimit: 18,
} as unknown as LessonInput;
const part = (index: number) => ({ title: `Part ${index}` });
/** What validateGeneratedKnowledge returns for a part: its pruned model and its counts. */
const checked = (output: { title: string }, droppedItems: Record<string, number> = {}) => {
  const invalid = Object.values(droppedItems).reduce((sum, value) => sum + value, 0);
  return {
    classified: [],
    model: { ...output, learningItems: [{ study: { set: "production" } }] },
    audit: { ...emptyStudyOutputAudit(18), droppedItems },
    sourceClassifications: [],
    tally: { invalid, basis: 1 + invalid, production: 1 },
  };
};
const merged = (titles: string[]) =>
  titles.map((title) => ({
    title,
    learningItems: [{ study: { set: "production" } }],
    sourceClassifications: [],
  }));

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
  m.validate.mockImplementation((output: { title: string }) => checked(output));
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
      { singleResponse: true, onCommit: expect.any(Function) },
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
      return checked(output);
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
    expect(await generateLessonParts(stageRun(), { lesson, plan })).toMatchObject({
      knowledge: { title: "Merged" },
    });
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(m.merge.mock.calls[0]?.[0]).toEqual(merged(["Part 0", "Part 2"]));
  });
  it("D110 merges a part's pruned cards without its regeneration and checks it with its own limit", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    m.checkpoints.set("knowledge:part:1", part(1));
    m.checkpoints.set("knowledge:part:1:assembly-omitted", {
      version: 1,
      omitted: { study_gap_partial: 1 },
      omittedProduction: 1,
      first: "study_gap_partial",
    });
    m.validate.mockImplementation((output: { title: string }) =>
      checked(output, output.title === "Part 1" ? { study_target_unsupported: 1 } : {}),
    );
    const result = await generateLessonParts(stageRun(), { lesson, plan });
    expect(m.providerStep).not.toHaveBeenCalled();
    // The pruned part, never the raw response, takes the merged slots.
    expect(m.merge.mock.calls[0]).toEqual([merged(["Part 0", "Part 1"]), 18]);
    // The second part is checked with what the first already kept: one lesson-wide bound.
    expect(m.validate.mock.calls[0]?.[4]).toMatchObject({ prior: emptyStudyTally() });
    expect(m.validate.mock.calls[1]?.[4]).toEqual({
      productionLimit: 18,
      salvage: true,
      assemblyOmitted: {
        omitted: { study_gap_partial: 1 },
        omittedProduction: 1,
        first: "study_gap_partial",
      },
      prior: { invalid: 0, basis: 1, production: 1 },
    });
    expect(result).toMatchObject({
      audit: { droppedItems: { study_target_unsupported: 1 }, productionLimit: 18 },
    });
  });
  it("D110 keeps a saved part repair's route and falls back to the bounded original", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    m.checkpoints.set("knowledge:part:1", part(1));
    m.checkpoints.set("knowledge:part:1:repair", part(2));
    m.validate.mockImplementation((output: { title: string }) => {
      if (output.title === "Part 2")
        throw errors.validationFailed({ output: ["study_gap_missing"] });
      return checked(output);
    });
    await generateLessonParts(stageRun(), { lesson, plan });
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(m.merge.mock.calls[0]?.[0]).toEqual(merged(["Part 0", "Part 1"]));
    // Without a usable original the repair's own failure stands, exactly as before.
    m.validate.mockImplementation((output: { title: string }) => {
      if (output.title !== "Part 0")
        throw errors.validationFailed({
          output: [
            `${output.title === "Part 2" ? "study_gap_missing" : "study_target_unsupported"}`,
          ],
        });
      return checked(output);
    });
    await expect(generateLessonParts(stageRun(), { lesson, plan })).rejects.toMatchObject({
      details: { fields: { output: ["study_gap_missing"] } },
    });
  });
  it("D110 sends a part beyond the lesson's allowance to its regeneration, with its first problem", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    m.checkpoints.set("knowledge:part:1", part(1));
    // Each part fits its own allowance; the second exceeds the lesson's (the validator decides
    // from the prior counts it is given).
    m.validate.mockImplementation(
      (output: { title: string }, _sources, _missing, _language, checks: { prior: unknown }) => {
        if (output.title === "Part 1" && (checks.prior as { invalid: number }).invalid > 0)
          throw errors.validationFailed({ output: ["study_target_unsupported"] });
        return checked(output, { study_target_unsupported: 2 });
      },
    );
    expect(await generateLessonParts(stageRun(), { lesson, plan })).toBe("checkpoint");
    expect(m.providerStep.mock.calls[0]?.[3]).toBe("knowledge:part:1:repair");
    expect(m.build).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({ repairReason: "study_target_unsupported" }),
    );
    expect(m.merge).not.toHaveBeenCalled();
  });
  it("D110 recovers a part with assembly omissions it cannot accept as a schema failure, as before", async () => {
    m.checkpoints.set("knowledge:part:0", part(0));
    m.checkpoints.set("knowledge:part:0:assembly-omitted", {
      version: 1,
      omitted: { study_gap_partial: 2, study_content_invalid: 1 },
      omittedProduction: 3,
      first: "study_gap_partial",
    });
    m.validate.mockImplementation(() => {
      throw errors.validationFailed({ output: ["language_mismatch"] });
    });
    expect(await generateLessonParts(stageRun(), { lesson, plan })).toBe("checkpoint");
    expect(m.providerStep.mock.calls[0]?.[3]).toBe("knowledge:part:0:repair");
    expect(m.build).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({
        repairReason: "provider_schema_invalid",
        repairDetail: "assembly:study_gap_partial",
      }),
    );
  });
});
