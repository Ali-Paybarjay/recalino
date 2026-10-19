import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { ProviderError } from "../../aip";
import { errors } from "../../plt";
import type { LessonInput } from "./lesson-input";
import { generateLessonKnowledge } from "./lesson-knowledge";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  providerStep: vi.fn(),
  validate: vi.fn(),
  legacy: vi.fn(),
  build: vi.fn(),
  studyRepair: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
  providerStep: m.providerStep,
}));
vi.mock("./knowledge-checks", async (original) => ({
  ...(await original<object>()),
  validateGeneratedKnowledge: m.validate,
}));
vi.mock("./legacy-knowledge-repair", () => ({ repairLegacyKnowledge: m.legacy }));
vi.mock("../knowledge-generation", async (original) => ({
  ...(await original<object>()),
  buildKnowledgeGenerationInput: m.build,
}));
vi.mock("../knowledge-study-repair", () => ({
  buildKnowledgeStudyRepairInput: () => ({
    schema: {},
    system: "",
    input: "",
    apply: m.studyRepair,
  }),
}));

// QUA-01: a lesson taught in one call, with a mock provider and mocked checkpoints.
const lesson = (compactGeneration = false) =>
  ({
    extracted: [runSource()],
    missing: [],
    lessonContext: { date: "2026-10-18" },
    teaching: undefined,
    generationData: {},
    compactGeneration,
    qualityOptions: {},
    knowledgeInput: { input: "", sourceRefPrompt: "" },
  }) as unknown as LessonInput;
const valid = { classified: [], model: { title: "Lesson" } };
const problem = (code: string) => errors.validationFailed({ output: [code] });
const steps = () => m.providerStep.mock.calls.map((call) => call[3]);

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of [m.providerStep, m.validate, m.legacy, m.build, m.studyRepair])
    mock.mockReset();
  m.validate.mockReturnValue(valid);
  m.build.mockReturnValue({
    schema: {},
    system: "",
    input: "",
    assemble: (value: unknown) => value,
  });
});

describe("generateLessonKnowledge", () => {
  it("validates saved knowledge without a provider call", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    const dispatch = { knowledgeDispatched: true };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(valid);
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(dispatch.knowledgeDispatched).toBe(false);
  });
  it("buys the lesson and ends the job when the new response needs a repair", async () => {
    m.providerStep.mockResolvedValue({ title: "New" });
    const dispatch = { knowledgeDispatched: false };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(valid);
    expect(steps()).toEqual(["knowledge"]);
    expect(dispatch.knowledgeDispatched).toBe(true);
    m.validate.mockImplementation(() => {
      throw problem("source_reference_invalid");
    });
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(
      "checkpoint",
    );
  });
  it("repairs only the answer spans of a saved lesson", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.validate.mockImplementationOnce(() => {
      throw problem("study_sentence_mismatch");
    });
    m.providerStep.mockResolvedValue({ answers: [] });
    m.studyRepair.mockReturnValue({ title: "Fixed" });
    const dispatch = { knowledgeDispatched: false };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(valid);
    expect(steps()).toEqual(["knowledge:study-repair"]);
    expect(dispatch.knowledgeDispatched).toBe(true);
  });
  it("hands other legacy-contract problems to the legacy repair", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.validate.mockImplementation(() => {
      throw problem("source_reference_invalid");
    });
    m.legacy.mockResolvedValue("checkpoint");
    const dispatch = { knowledgeDispatched: false };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(
      "checkpoint",
    );
    expect(m.legacy).toHaveBeenCalledWith(expect.anything(), {
      lesson: expect.anything(),
      dispatch,
    });
  });
  it("regenerates a content-contract lesson once, unless both attempts are used", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.validate.mockImplementationOnce(() => {
      throw problem("source_reference_invalid");
    });
    m.providerStep.mockResolvedValue({ title: "Regenerated" });
    const dispatch = { knowledgeDispatched: false };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(true), dispatch })).toBe(
      valid,
    );
    expect(steps()).toEqual(["knowledge:repair"]);
    m.providerStep.mockClear();
    m.checkpoints.set("knowledge:truncated", { reason: "provider_output_truncated" });
    m.validate.mockImplementationOnce(() => {
      throw problem("source_reference_invalid");
    });
    await expect(
      generateLessonKnowledge(stageRun(), { lesson: lesson(true), dispatch }),
    ).rejects.toMatchObject({ details: { fields: { output: ["source_reference_invalid"] } } });
    expect(m.providerStep).not.toHaveBeenCalled();
  });
  it("ends the job after a known truncated response so the compact recovery gets its own", async () => {
    m.providerStep.mockImplementation(async () => {
      m.checkpoints.set("knowledge:truncated", { reason: "provider_output_truncated" });
      throw new ProviderError("provider_output_truncated", false, false, {
        provider: "synthetic",
      } as never);
    });
    const dispatch = { knowledgeDispatched: false };
    expect(await generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch })).toBe(
      "checkpoint",
    );
    m.providerStep.mockRejectedValue(new ProviderError("provider_http_500", true, false));
    m.checkpoints.clear();
    await expect(
      generateLessonKnowledge(stageRun(), { lesson: lesson(), dispatch }),
    ).rejects.toMatchObject({ code: "provider_http_500" });
  });
});
