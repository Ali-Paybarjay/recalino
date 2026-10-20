import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { errors } from "../../plt";
import { repairLegacyKnowledge } from "./legacy-knowledge-repair";
import type { LessonInput } from "./lesson-input";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  providerStep: vi.fn(),
  validate: vi.fn(),
  decode: vi.fn(),
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
vi.mock("../knowledge-repair", () => ({
  buildKnowledgeRepairInput: () => ({
    schema: {},
    system: "",
    input: "",
    decode: m.decode,
    expanded: (value: unknown) => value,
    assertLanguageRepairEvidence: () => {},
  }),
}));
vi.mock("../knowledge-study-repair", () => ({
  buildKnowledgeStudyRepairInput: () => ({
    schema: {},
    system: "",
    input: "",
    apply: m.studyRepair,
  }),
}));

// QUA-01: the bounded repair of a legacy-contract lesson, with a mock provider.
const lesson = {
  extracted: [runSource()],
  missing: [],
  lessonContext: { date: "2026-10-18" },
  teaching: undefined,
  productionLimit: 18,
} as unknown as LessonInput;
const studyMismatch = () => errors.validationFailed({ output: ["study_sentence_mismatch"] });
const valid = { classified: [], model: { title: "Repaired" } };

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of [m.providerStep, m.validate, m.decode, m.studyRepair]) mock.mockReset();
  m.decode.mockImplementation((value: unknown) => value);
  m.validate.mockReturnValue(valid);
});

describe("repairLegacyKnowledge", () => {
  it("buys one corrected response and accepts it when it validates", async () => {
    m.providerStep.mockResolvedValue({ title: "Corrected" });
    const dispatch = { knowledgeDispatched: false };
    expect(await repairLegacyKnowledge(stageRun(), { lesson, dispatch })).toBe(valid);
    expect(m.providerStep.mock.calls.map((call) => call[3])).toEqual(["knowledge:repair"]);
    expect(dispatch.knowledgeDispatched).toBe(true);
  });
  it("ends the job after paying for a correction whose language is wrong", async () => {
    m.providerStep.mockResolvedValue({ title: "Corrected" });
    m.decode.mockImplementation(() => {
      throw errors.validationFailed({ output: ["language_script_mismatch"] });
    });
    const dispatch = { knowledgeDispatched: false };
    expect(await repairLegacyKnowledge(stageRun(), { lesson, dispatch })).toBe("checkpoint");
    expect(m.providerStep).toHaveBeenCalledTimes(1);
  });
  it("leaves the answer-span repair to the next job after a paid call in this one", async () => {
    m.checkpoints.set("knowledge:repair", { title: "Saved" });
    m.validate.mockImplementation(() => {
      throw studyMismatch();
    });
    const dispatch = { knowledgeDispatched: true };
    expect(await repairLegacyKnowledge(stageRun(), { lesson, dispatch })).toBe("checkpoint");
    expect(m.providerStep).not.toHaveBeenCalled();
  });
  it("repairs only the answer spans of a saved correction", async () => {
    m.checkpoints.set("knowledge:repair", { title: "Saved" });
    m.validate.mockImplementationOnce(() => {
      throw studyMismatch();
    });
    m.providerStep.mockResolvedValue({ answers: [] });
    m.studyRepair.mockReturnValue({ title: "Answers fixed" });
    const dispatch = { knowledgeDispatched: false };
    expect(await repairLegacyKnowledge(stageRun(), { lesson, dispatch })).toBe(valid);
    expect(m.providerStep.mock.calls.map((call) => call[3])).toEqual(["knowledge:study-repair"]);
    // D110: the repaired lesson drops invalid cards within the allowance, as a first one does.
    expect(m.validate).toHaveBeenLastCalledWith(
      { title: "Answers fixed" },
      lesson.extracted,
      [],
      "fa",
      { productionLimit: 18, salvage: true },
    );
    expect(dispatch.knowledgeDispatched).toBe(true);
  });
});
