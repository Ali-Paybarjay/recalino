import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, RUN_ID, runSource, stageRun } from "../../../test/processing-run";
import { ProviderError } from "../../aip";
import { errors } from "../../plt";
import { compactKnowledgeInstruction } from "../knowledge-compact";
import type { LessonInput } from "./lesson-input";
import { generateLessonKnowledge } from "./lesson-knowledge";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  providerStep: vi.fn(),
  validate: vi.fn(),
  legacy: vi.fn(),
  build: vi.fn(),
  studyRepair: vi.fn(),
  saveStep: vi.fn(),
  canonical: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
  providerStep: m.providerStep,
  saveStep: m.saveStep,
}));
vi.mock("../knowledge-generation-step", async (original) => ({
  ...(await original<object>()),
  generateCanonicalKnowledge: m.canonical,
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
  for (const mock of [
    m.providerStep,
    m.validate,
    m.legacy,
    m.build,
    m.studyRepair,
    m.saveStep,
    m.canonical,
  ])
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

// QUA-01 characterization: what each generation path asks for, saves and reuses.
describe("generateLessonKnowledge requests", () => {
  const request = (compactGeneration: boolean) =>
    ({
      ...lesson(compactGeneration),
      generationData: { marker: "generation-data" },
      qualityOptions: { sourceCoverage: true },
      knowledgeInput: { input: "LEGACY-INPUT", sourceRefPrompt: "SOURCE-REF" },
    }) as unknown as LessonInput;
  const built = { schema: {}, system: "", input: "", assemble: (value: unknown) => value };
  /** Runs the effect and commit hook as the real providerStep does after its checks. */
  function paidResponse(output: unknown) {
    m.providerStep.mockImplementation(async (...args: unknown[]) => {
      const step = args[3] as string;
      const effect = args[7] as (key: string) => Promise<unknown>;
      const options = args[8] as { onCommit?: (tx: unknown, value: unknown) => Promise<void> };
      await effect(`${step}:operation`);
      await options?.onCommit?.("tx", output);
      return output;
    });
  }
  const saved = () => m.saveStep.mock.calls.map((call) => [call[2], call[3]]);
  const inputContext = ["knowledge:input-context", { version: 1, date: "2026-10-18" }];
  beforeEach(() => m.build.mockReturnValue(built));

  it("asks a content-contract lesson with its quality options and saves its input context", async () => {
    paidResponse({ title: "New" });
    const run = stageRun();
    const dispatch = { knowledgeDispatched: false };
    await generateLessonKnowledge(run, { lesson: request(true), dispatch });
    expect(m.build.mock.calls).toEqual([
      [
        { marker: "generation-data" },
        100_000,
        { maxOutputTokens: 6144, sourceCoverage: true, compact: false },
      ],
    ]);
    expect(m.canonical.mock.calls).toEqual([
      [run.provider, "synthetic/llm", "knowledge:operation", built],
    ]);
    expect(steps()).toEqual(["knowledge"]);
    expect(saved()).toEqual([inputContext]);
    expect(m.saveStep.mock.calls[0]?.slice(0, 2)).toEqual(["tx", RUN_ID]);
    expect(m.saveStep.mock.calls[0]?.[4]).toEqual(NOW);
    expect(dispatch.knowledgeDispatched).toBe(true);
  });
  it("asks the compact recovery with its fixed budget and saves its lesson as the knowledge", async () => {
    m.checkpoints.set("knowledge:truncated", { reason: "provider_output_truncated" });
    paidResponse({ title: "Compact" });
    await generateLessonKnowledge(stageRun(), {
      lesson: request(true),
      dispatch: { knowledgeDispatched: false },
    });
    expect(m.build.mock.calls[0]?.[2]).toEqual({ maxOutputTokens: 2048, compact: true });
    expect(steps()).toEqual(["knowledge:compact"]);
    expect(saved()).toEqual([inputContext, ["knowledge", { title: "Compact" }]]);
  });
  it("asks the schema recovery with the saved reason and detail", async () => {
    m.checkpoints.set("knowledge:schema-invalid", {
      reason: "provider_schema_invalid",
      detail: "json_parse",
    });
    paidResponse({ title: "Recovered" });
    await generateLessonKnowledge(stageRun(), {
      lesson: request(true),
      dispatch: { knowledgeDispatched: false },
    });
    expect(m.build.mock.calls[0]?.[2]).toEqual({
      maxOutputTokens: 6144,
      sourceCoverage: true,
      compact: false,
      repairReason: "provider_schema_invalid",
      repairDetail: "json_parse",
    });
    expect(steps()).toEqual(["knowledge:repair"]);
    expect(saved()).toEqual([inputContext, ["knowledge", { title: "Recovered" }]]);
  });
  it.each([false, true])(
    "asks a legacy-contract lesson in one structured call (compact %s)",
    async (compact) => {
      if (compact)
        m.checkpoints.set("knowledge:truncated", { reason: "provider_output_truncated" });
      paidResponse({ title: "Legacy" });
      const run = stageRun();
      vi.mocked(run.provider.structured).mockResolvedValue({ output: {} } as never);
      await generateLessonKnowledge(run, {
        lesson: request(false),
        dispatch: { knowledgeDispatched: false },
      });
      expect(m.build).not.toHaveBeenCalled();
      const call = vi.mocked(run.provider.structured).mock.calls[0]?.[0];
      expect(call).toMatchObject({
        operationKey: `${compact ? "knowledge:compact" : "knowledge"}:operation`,
        model: "synthetic/llm",
        schemaName: "class_knowledge",
        input: "LEGACY-INPUT",
      });
      expect(call?.system).toContain(
        " SOURCE-REF Return one sourceClassifications entry per source",
      );
      expect(call?.system.endsWith(compactKnowledgeInstruction("fa"))).toBe(compact);
      expect(saved()).toEqual(
        compact ? [inputContext, ["knowledge", { title: "Legacy" }]] : [inputContext],
      );
    },
  );
  it("ends the job after a paid invalid content-contract response once its recovery is saved", async () => {
    m.providerStep.mockImplementation(async () => {
      m.checkpoints.set("knowledge:schema-invalid", { reason: "provider_schema_invalid" });
      throw new ProviderError("provider_schema_invalid", false, false, {
        provider: "synthetic",
      } as never);
    });
    expect(
      await generateLessonKnowledge(stageRun(), {
        lesson: request(true),
        dispatch: { knowledgeDispatched: false },
      }),
    ).toBe("checkpoint");
    m.checkpoints.clear();
    m.providerStep.mockRejectedValue(new ProviderError("provider_schema_invalid", false, false));
    await expect(
      generateLessonKnowledge(stageRun(), {
        lesson: request(true),
        dispatch: { knowledgeDispatched: false },
      }),
    ).rejects.toMatchObject({ code: "provider_schema_invalid" });
  });
  it("validates a saved answer-span repair without a provider call", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.checkpoints.set("knowledge:study-repair", { answers: ["saved"] });
    m.validate.mockImplementationOnce(() => {
      throw problem("study_sentence_mismatch");
    });
    m.studyRepair.mockReturnValue({ title: "Fixed" });
    const dispatch = { knowledgeDispatched: true };
    expect(await generateLessonKnowledge(stageRun(), { lesson: request(true), dispatch })).toBe(
      valid,
    );
    expect(m.studyRepair).toHaveBeenCalledWith({ answers: ["saved"] });
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(dispatch.knowledgeDispatched).toBe(false);
  });
  it("validates a saved content repair, asked with the semantic reason, without a provider call", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.checkpoints.set("knowledge:repair", { title: "Saved repair" });
    m.validate.mockImplementationOnce(() => {
      throw problem("source_reference_invalid");
    });
    const dispatch = { knowledgeDispatched: true };
    expect(await generateLessonKnowledge(stageRun(), { lesson: request(true), dispatch })).toBe(
      valid,
    );
    expect(m.build.mock.calls).toEqual([
      [
        { marker: "generation-data" },
        100_000,
        { maxOutputTokens: 6144, sourceCoverage: true, repairReason: "source_reference_invalid" },
      ],
    ]);
    expect(m.validate.mock.calls.at(-1)?.[0]).toEqual({ title: "Saved repair" });
    expect(m.providerStep).not.toHaveBeenCalled();
    expect(dispatch.knowledgeDispatched).toBe(false);
  });
  it("buys the content repair under its own name", async () => {
    m.checkpoints.set("knowledge", { title: "Saved" });
    m.validate.mockImplementationOnce(() => {
      throw problem("source_reference_invalid");
    });
    paidResponse({ title: "Repaired" });
    const run = stageRun();
    await generateLessonKnowledge(run, {
      lesson: request(true),
      dispatch: { knowledgeDispatched: false },
    });
    expect(m.canonical.mock.calls).toEqual([
      [
        run.provider,
        "synthetic/llm",
        "knowledge:repair:operation",
        built,
        "class_knowledge_content_repair",
      ],
    ]);
  });
});
