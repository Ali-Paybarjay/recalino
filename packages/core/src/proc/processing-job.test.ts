import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, RUN_ID, runSource, stageRun, syntheticJob, USER_ID } from "../../test/processing-run";
import { YIELDED } from "./steps/context";
import { YIELD_DELAY_SECONDS } from "./steps/runtime";
import { processingJob } from "./worker";

const m = vi.hoisted(() => ({
  start: vi.fn(),
  extract: vi.fn(),
  voice: vi.fn(),
  teach: vi.fn(),
  fail: vi.fn(),
  checkpoint: vi.fn(),
}));
vi.mock("./steps/start", () => ({ startRun: m.start }));
vi.mock("./steps/extract-sources", () => ({ extractSources: m.extract }));
vi.mock("./steps/voice-check", () => ({ beginVoiceCheck: m.voice }));
vi.mock("./steps/lesson", () => ({ teachLesson: m.teach }));
vi.mock("./steps/fail-run", () => ({ failRun: m.fail }));
vi.mock("./steps/runtime", async (original) => ({
  ...(await original<object>()),
  checkpointAndContinue: m.checkpoint,
}));

// QUA-01: processingJob's run is a short orchestrator of its stages; this pins their order.
const payload = { runId: RUN_ID, userId: USER_ID };
const extracted = [runSource()];
const job = processingJob({ store: {} as never });
const stage = stageRun();

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.start.mockResolvedValue(stage);
  m.extract.mockResolvedValue(extracted);
  m.voice.mockResolvedValue(null);
  m.teach.mockResolvedValue("published");
});

describe("processingJob run", () => {
  it("starts, extracts, then teaches and publishes the lesson", async () => {
    const context = syntheticJob();
    await job.run(payload, context);
    expect(m.start).toHaveBeenCalledWith(
      expect.objectContaining({ job: context, payload, definition: job }),
    );
    expect(m.extract).toHaveBeenCalledWith(stage);
    expect(m.voice).toHaveBeenCalledWith(stage, extracted);
    expect(m.teach).toHaveBeenCalledWith(stage, { extracted, voiceCheck: null });
    expect(m.checkpoint).not.toHaveBeenCalled();
    expect(m.fail).not.toHaveBeenCalled();
  });
  it("ends at a yielding stage and queues the next lesson stage after a checkpoint", async () => {
    m.extract.mockResolvedValue(YIELDED);
    await job.run(payload, syntheticJob());
    expect(m.voice).not.toHaveBeenCalled();
    m.extract.mockResolvedValue(extracted);
    m.voice.mockResolvedValue(YIELDED);
    await job.run(payload, syntheticJob());
    expect(m.teach).not.toHaveBeenCalled();
    m.voice.mockResolvedValue(null);
    m.teach.mockResolvedValue("checkpoint");
    const context = syntheticJob();
    await job.run(payload, context);
    expect(m.teach).toHaveBeenCalledTimes(1);
    expect(m.checkpoint).toHaveBeenCalledWith(context, expect.anything(), RUN_ID, job);
  });
  it("leaves the lesson to a fresh runner when no lesson call fits", async () => {
    const context = syntheticJob([], new Date(NOW.getTime() + 1000));
    await job.run(payload, context);
    expect(m.voice).not.toHaveBeenCalled();
    expect(m.checkpoint).toHaveBeenCalledWith(
      context,
      expect.anything(),
      RUN_ID,
      job,
      YIELD_DELAY_SECONDS,
    );
  });
  it("teaches on while the acoustic check runs, then waits for it", async () => {
    let running = true;
    const voiceCheck = {
      running: () => running,
      wait: vi.fn(async () => false),
      settle: vi.fn(),
    };
    m.voice.mockResolvedValue(voiceCheck);
    m.teach.mockResolvedValueOnce("checkpoint").mockImplementationOnce(async () => {
      running = false;
      return "checkpoint";
    });
    await job.run(payload, syntheticJob());
    expect(m.teach).toHaveBeenCalledTimes(2);
    expect(voiceCheck.wait).toHaveBeenCalled();
    expect(m.checkpoint).toHaveBeenCalledTimes(1);
  });
  it("settles a running check and hands every failure to the failure stage", async () => {
    const voiceCheck = { running: () => true, wait: vi.fn(), settle: vi.fn() };
    m.voice.mockResolvedValue(voiceCheck);
    const failure = new Error("synthetic lesson failure");
    m.teach.mockRejectedValue(failure);
    await job.run(payload, syntheticJob());
    expect(voiceCheck.settle).toHaveBeenCalled();
    expect(voiceCheck.wait).not.toHaveBeenCalled();
    expect(m.fail).toHaveBeenCalledWith(expect.objectContaining({ payload }), failure);
    m.start.mockRejectedValue(failure);
    await job.run(payload, syntheticJob());
    expect(m.fail).toHaveBeenCalledTimes(2);
  });
});
