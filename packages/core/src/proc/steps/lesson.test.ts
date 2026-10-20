import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { errors } from "../../plt";
import { emptyStudyOutputAudit } from "../study-output-guard";
import type { KnowledgeDispatch } from "./legacy-knowledge-repair";
import { teachLesson } from "./lesson";

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  parts: vi.fn(),
  knowledge: vi.fn(),
  validate: vi.fn(),
  correct: vi.fn(),
  publish: vi.fn(),
  plan: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("./lesson-input", () => ({ prepareLesson: m.prepare }));
vi.mock("./lesson-parts", () => ({ generateLessonParts: m.parts }));
vi.mock("./lesson-knowledge", () => ({ generateLessonKnowledge: m.knowledge }));
vi.mock("./knowledge-checks", async (original) => ({
  ...(await original<object>()),
  validateGeneratedKnowledge: m.validate,
}));
vi.mock("./voice-correction", () => ({ correctSpokenMistakes: m.correct }));
vi.mock("./publish", () => ({ publishLesson: m.publish }));
vi.mock("../knowledge-parts", async (original) => ({
  ...(await original<object>()),
  planLessonParts: m.plan,
}));
vi.mock("../generated-study-practice", () => ({ finalizeGeneratedStudyPractice: m.finalize }));
vi.mock("../../lkm", async (original) => ({
  ...(await original<object>()),
  normalizeGeneratedStudyModel: (model: unknown) => model,
}));

// QUA-01: the order of one lesson stage, with every sub-stage mocked.
const extracted = [runSource()];
const audit = emptyStudyOutputAudit(18);
const validated = {
  classified: extracted,
  model: { title: "Lesson", learningItems: [{ study: { set: "production" } }] },
  audit,
};
function prepared(compactGeneration: boolean, classPartMinutes?: number) {
  return {
    extracted,
    missing: [],
    lessonContext: { date: "2026-10-18" },
    compactGeneration,
    quality: classPartMinutes ? { classPartMinutes } : undefined,
    productionLimit: 18,
  };
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.prepare.mockResolvedValue(prepared(false));
  m.validate.mockReturnValue(validated);
  m.finalize.mockReturnValue({ model: { title: "Final" }, audit: { applied: false } });
  m.correct.mockResolvedValue("unchanged");
  m.publish.mockResolvedValue("published");
});

describe("teachLesson", () => {
  it("teaches in one call, then publishes the finalized lesson", async () => {
    m.knowledge.mockImplementation(async (_run, { dispatch }: { dispatch: KnowledgeDispatch }) => {
      dispatch.knowledgeDispatched = true;
      return validated;
    });
    const run = stageRun();
    expect(await teachLesson(run, { extracted, voiceCheck: null })).toBe("published");
    expect(m.parts).not.toHaveBeenCalled();
    expect(m.correct).toHaveBeenCalledWith(run, {
      extracted,
      classified: extracted,
      knowledgeDispatched: true,
      voiceCheck: null,
    });
    expect(m.publish).toHaveBeenCalledWith(run, {
      lesson: prepared(false),
      classified: extracted,
      model: { title: "Final" },
      practiceAudit: { applied: false },
      studyOutput: audit,
    });
  });
  it("teaches a long class part by part and validates the merged lesson", async () => {
    m.prepare.mockResolvedValue(prepared(true, 45));
    m.plan.mockReturnValue([{ index: 0 }]);
    const partsAudit = { ...emptyStudyOutputAudit(18), droppedItems: { study_gap_missing: 1 } };
    m.parts.mockResolvedValue({ knowledge: { title: "Merged" }, audit: partsAudit });
    expect(await teachLesson(stageRun(), { extracted, voiceCheck: null })).toBe("published");
    expect(m.plan).toHaveBeenCalledWith(extracted, 45, []);
    expect(m.knowledge).not.toHaveBeenCalled();
    // The merged lesson is checked strictly: the parts already held the lesson's one bound.
    expect(m.validate).toHaveBeenCalledWith({ title: "Merged" }, extracted, [], "fa", {
      productionLimit: 18,
    });
    expect(m.correct.mock.calls[0]?.[1].knowledgeDispatched).toBe(false);
    // D110: the parts' drops are recorded with the merged lesson's own counts.
    expect(m.publish.mock.calls[0]?.[1].studyOutput.droppedItems).toEqual({
      study_gap_missing: 1,
    });
  });
  it("fails a merged lesson whose strict check fails, exactly as before", async () => {
    m.prepare.mockResolvedValue(prepared(true, 45));
    m.plan.mockReturnValue([{ index: 0 }]);
    m.parts.mockResolvedValue({
      knowledge: { title: "Merged" },
      audit: { ...emptyStudyOutputAudit(18), droppedItems: { study_target_unsupported: 2 } },
    });
    m.validate.mockImplementation(() => {
      throw errors.validationFailed({ output: ["study_mistake_item_missing"] });
    });
    await expect(teachLesson(stageRun(), { extracted, voiceCheck: null })).rejects.toMatchObject({
      details: { fields: { output: ["study_mistake_item_missing"] } },
    });
    expect(m.publish).not.toHaveBeenCalled();
  });
  it("stops at each sub-stage's checkpoint", async () => {
    m.knowledge.mockResolvedValue("checkpoint");
    expect(await teachLesson(stageRun(), { extracted, voiceCheck: null })).toBe("checkpoint");
    m.knowledge.mockResolvedValue(validated);
    m.correct.mockResolvedValue("checkpoint");
    expect(await teachLesson(stageRun(), { extracted, voiceCheck: null })).toBe("checkpoint");
    expect(m.publish).not.toHaveBeenCalled();
  });
});
