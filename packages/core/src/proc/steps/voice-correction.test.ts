import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { startVoiceCheck } from "./voice-check";
import { correctSpokenMistakes } from "./voice-correction";

const m = vi.hoisted(() => ({ process: vi.fn(), correct: vi.fn(), providerStep: vi.fn() }));
vi.mock("../voice-processing", async (original) => ({
  ...(await original<object>()),
  processVoiceSource: m.process,
  correctVoiceCandidates: m.correct,
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  providerStep: m.providerStep,
}));

// QUA-01: the optional spoken-mistake correction before a lesson is published.
const audio = runSource({ kind: "audio" });
const notes = runSource({ role: "user_notes" });
const material = runSource({ role: "class_material" });
const extracted = [audio, material];
const classified = [audio, notes, material] as never;
const input = { extracted, classified, knowledgeDispatched: false, voiceCheck: null };
function withDiarizer() {
  const run = stageRun();
  run.dependencies = { ...run.dependencies, diarizeVoice: vi.fn() };
  return run;
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.process.mockResolvedValue("unchanged");
});

describe("correctSpokenMistakes", () => {
  it("does nothing without a diarizer", async () => {
    expect(await correctSpokenMistakes(stageRun(), input)).toBe("unchanged");
    expect(m.process).not.toHaveBeenCalled();
  });
  it("never shares a job with a paid lesson call or a saved acoustic check", async () => {
    expect(
      await correctSpokenMistakes(withDiarizer(), { ...input, knowledgeDispatched: true }),
    ).toBe("checkpoint");
    const voiceCheck = startVoiceCheck(async () => true);
    expect(await correctSpokenMistakes(withDiarizer(), { ...input, voiceCheck })).toBe(
      "checkpoint",
    );
    expect(m.process).not.toHaveBeenCalled();
  });
  it("checks every source and ends the job after any voice progress", async () => {
    const run = withDiarizer();
    expect(await correctSpokenMistakes(run, input)).toBe("unchanged");
    expect(m.process).toHaveBeenCalledTimes(2);
    m.process.mockReset();
    m.process.mockResolvedValueOnce("analyzed");
    expect(await correctSpokenMistakes(run, input)).toBe("checkpoint");
    expect(m.process).toHaveBeenCalledTimes(1);
  });
  it("corrects against class material only, through the paid provider step", async () => {
    const run = withDiarizer();
    m.process.mockImplementation(async ({ correct }) => {
      await correct({ id: "analysis" });
      return "unchanged";
    });
    m.correct.mockImplementation(async ({ execute }) => {
      await execute({ step: "voice:correct", model: "synthetic/llm", schema: {}, effect: vi.fn() });
    });
    await correctSpokenMistakes(run, { ...input, extracted: [audio] });
    expect(m.correct.mock.calls[0]?.[0].referenceTexts).toEqual(["Synthetic class text."]);
    expect(m.providerStep.mock.calls[0]?.slice(2, 5)).toEqual([
      run.payload.runId,
      "voice:correct",
      "synthetic/llm",
    ]);
  });
});
