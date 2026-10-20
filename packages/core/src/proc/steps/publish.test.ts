import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  runSource,
  SESSION_ID,
  stageRun,
  syntheticJob,
} from "../../../test/processing-run";
import type { LessonInput } from "./lesson-input";
import { publishLesson } from "./publish";

const m = vi.hoisted(() => ({
  liveRun: vi.fn(),
  assertSourcesLive: vi.fn(),
  updateRoles: vi.fn(),
  publish: vi.fn(),
  settle: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({ ...(await original<object>()), liveRun: m.liveRun }));
vi.mock("../../src", async (original) => ({
  ...(await original<object>()),
  assertSourcesLive: m.assertSourcesLive,
  updateAutomaticSourceRoles: m.updateRoles,
}));
vi.mock("../../lkm", async (original) => ({
  ...(await original<object>()),
  publishKnowledgeVersion: m.publish,
}));
vi.mock("../charged-material", () => ({ settleClassMaterial: m.settle }));

// QUA-01: publishing a lesson and settling its allowance, with no database.
const RESERVATION = "99999999-9999-4999-8999-999999999999";
const VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const held = { audio: 0, document: 2, regeneration: 0, tts: 0, storage: 0 };
const withText = runSource();
const empty = runSource({ blocks: [] });
const lesson = (missing: string[]) =>
  ({ extracted: [withText, empty], missing, practiceFocus: [] }) as unknown as LessonInput;
const classified = [{ ...withText, role: "user_notes" }, empty] as never;
const model = { learningItems: [] } as never;

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.liveRun.mockResolvedValue({
    id: RUN_ID,
    session_id: SESSION_ID,
    reservation_id: RESERVATION,
    requested_amounts: held,
  });
  m.publish.mockResolvedValue({ id: VERSION });
});

describe("publishLesson", () => {
  it("publishes, charges only material with text and marks the run ready", async () => {
    const calls: unknown[][] = [];
    const run = stageRun({ job: syntheticJob(calls) });
    run.snapshot = { ...run.snapshot, sources: [withText, empty] };
    expect(
      await publishLesson(run, {
        lesson: lesson([]),
        classified,
        model,
        practiceAudit: { applied: false } as never,
      }),
    ).toBe("published");
    expect(m.assertSourcesLive).toHaveBeenCalledWith(expect.anything(), run.ctx, [
      withText.sourceId,
      empty.sourceId,
    ]);
    expect(m.updateRoles.mock.calls[0]?.[3]).toEqual([
      { sourceId: withText.sourceId, role: "user_notes" },
      { sourceId: empty.sourceId, role: "class_material" },
    ]);
    const published = m.publish.mock.calls[0]?.[2];
    expect(published).toMatchObject({ runId: RUN_ID, sessionId: SESSION_ID, model });
    expect(published.generation).not.toHaveProperty("studyPractice");
    expect(published.generation).not.toHaveProperty("teachingAdaptation");
    expect(m.settle.mock.calls[0]?.[2]).toMatchObject({
      reservationId: RESERVATION,
      held,
      sources: [withText],
    });
    expect(calls).toContainEqual([
      "set",
      expect.objectContaining({ state: "ready", output_version_id: VERSION, last_error: null }),
    ]);
  });
  it("records a partial lesson and the applied study practice", async () => {
    const calls: unknown[][] = [];
    const run = stageRun({ job: syntheticJob(calls) });
    await publishLesson(run, {
      lesson: lesson([empty.sourceId]),
      classified,
      model,
      practiceAudit: { applied: true } as never,
    });
    expect(m.publish.mock.calls[0]?.[2].generation.studyPractice).toEqual({ applied: true });
    expect(calls).toContainEqual(["set", expect.objectContaining({ state: "partial_ready" })]);
  });
});
