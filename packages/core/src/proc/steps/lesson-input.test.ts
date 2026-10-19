import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockProvider,
  providerSettings,
  runSource,
  SESSION_ID,
  stageRun,
} from "../../../test/processing-run";
import { prepareLesson } from "./lesson-input";

const m = vi.hoisted(() => ({ getSession: vi.fn(), getCourse: vi.fn() }));
vi.mock("../../org", async (original) => ({
  ...(await original<object>()),
  getSession: m.getSession,
  getCourse: m.getCourse,
}));

// QUA-01: the lesson input every lesson stage reads, with no database.
const COURSE = "12121212-1212-4121-8121-121212121212";

beforeEach(() => {
  m.getSession.mockResolvedValue({ id: SESSION_ID, courseId: COURSE, classDate: "2026-10-18" });
  m.getCourse.mockResolvedValue({ id: COURSE, name: "Synthetic course", isDefault: false });
});

describe("prepareLesson", () => {
  it("lists missing sources and names the lesson's date and course", async () => {
    const complete = runSource();
    const empty = runSource({ blocks: [] });
    const partial = runSource({
      units: [{ id: "doc", kind: "document", start: 1, status: "partial" }],
    });
    const lesson = await prepareLesson(stageRun(), [complete, empty, partial]);
    expect(lesson.missing).toEqual([empty.sourceId, partial.sourceId]);
    expect(lesson.lessonContext).toEqual({ date: "2026-10-18", course: "Synthetic course" });
    expect(lesson.generationData).toMatchObject({
      explanationLanguage: "fa",
      sources: [complete, empty, partial],
      missingSourceIds: [empty.sourceId, partial.sourceId],
    });
    expect(lesson.compactGeneration).toBe(false);
    expect(lesson.qualityOptions).toEqual({});
    expect(lesson.knowledgeInput.input).toContain("Synthetic class text.");
  });
  it("keeps the default course unnamed and derives lesson-quality limits", async () => {
    m.getCourse.mockResolvedValue({ id: COURSE, name: "My courses", isDefault: true });
    const provider = mockProvider(
      providerSettings({
        lessonQuality: {
          version: "lesson-quality-1",
          budget: "lesson-budget-1",
          sourceCoverage: true,
          structuredBoard: true,
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
    const lesson = await prepareLesson(run, [runSource()]);
    expect(lesson.lessonContext).toEqual({ date: "2026-10-18" });
    expect(lesson.qualityOptions).toMatchObject({ maxOutputTokens: 6144, sourceCoverage: true });
    expect(lesson.quality).toBe(provider.settings.lessonQuality);
  });
});
