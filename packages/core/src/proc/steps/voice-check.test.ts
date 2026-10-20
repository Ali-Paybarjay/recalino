import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, runSource, SESSION_ID, stageRun, syntheticJob } from "../../../test/processing-run";
import { YIELDED } from "./context";
import { YIELD_DELAY_SECONDS } from "./runtime";
import { beginVoiceCheck, startVoiceCheck } from "./voice-check";

const m = vi.hoisted(() => ({
  pending: vi.fn(),
  analyze: vi.fn(),
  checkpointAndContinue: vi.fn(),
}));
vi.mock("../voice-processing", async (original) => ({
  ...(await original<object>()),
  voiceAnalysisPending: m.pending,
  analyzeVoiceSources: m.analyze,
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  checkpointAndContinue: m.checkpointAndContinue,
}));

// QUA-01: the acoustic check started beside lesson generation.
const extracted = [runSource({ kind: "audio" })];
const diarizeVoice = vi.fn();

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
});

describe("beginVoiceCheck", () => {
  it("has nothing to check without a diarizer or pending audio", async () => {
    expect(await beginVoiceCheck(stageRun(), extracted)).toBeNull();
    expect(m.pending).not.toHaveBeenCalled();
    const run = stageRun();
    run.dependencies = { ...run.dependencies, diarizeVoice };
    m.pending.mockResolvedValue(false);
    expect(await beginVoiceCheck(run, extracted)).toBeNull();
    expect(m.pending).toHaveBeenCalledWith(run.job.db, run.ctx, {
      sessionId: SESSION_ID,
      runId: run.payload.runId,
      sources: extracted,
    });
  });
  it("leaves a check that cannot finish to a fresh runner", async () => {
    const run = stageRun({ job: syntheticJob([], new Date(NOW.getTime() + 60_000)) });
    run.dependencies = { ...run.dependencies, diarizeVoice };
    m.pending.mockResolvedValue(true);
    expect(await beginVoiceCheck(run, extracted)).toBe(YIELDED);
    expect(m.analyze).not.toHaveBeenCalled();
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      YIELD_DELAY_SECONDS,
    );
  });
  it("starts the check without waiting for it", async () => {
    const run = stageRun();
    run.dependencies = { ...run.dependencies, diarizeVoice };
    m.pending.mockResolvedValue(true);
    let finish: (analyzed: boolean) => void = () => {};
    m.analyze.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    const check = await beginVoiceCheck(run, extracted);
    if (!check || check === YIELDED) throw new Error("expected a running check");
    expect(m.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, sources: extracted, diarize: diarizeVoice }),
    );
    expect(check.running()).toBe(true);
    finish(true);
    expect(await check.wait()).toBe(true);
    expect(check.running()).toBe(false);
  });
});

describe("startVoiceCheck", () => {
  it("rethrows the check's failure on wait but not on settle", async () => {
    const check = startVoiceCheck(async () => {
      throw new Error("synthetic engine failure");
    });
    await expect(check.settle()).resolves.toBeUndefined();
    await expect(check.wait()).rejects.toThrow("synthetic engine failure");
  });
});
