import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { extractAudioSource } from "./audio-source";
import { YIELDED } from "./context";
import { YIELD_DELAY_SECONDS } from "./runtime";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  completedSteps: vi.fn(),
  transcribeChunks: vi.fn(),
  checkpointAndContinue: vi.fn(),
  storeExtraction: vi.fn(),
  saveStep: vi.fn(),
  liveRun: vi.fn(),
  ownedObjectMetadata: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
  completedSteps: m.completedSteps,
  transcribeChunks: m.transcribeChunks,
  checkpointAndContinue: m.checkpointAndContinue,
  storeExtraction: m.storeExtraction,
  saveStep: m.saveStep,
  liveRun: m.liveRun,
}));
vi.mock("../../plt", async (original) => ({
  ...(await original<object>()),
  ownedObjectMetadata: m.ownedObjectMetadata,
  deleteObject: m.deleteObject,
}));

// QUA-01: the audio extraction stage, with a mock provider and mocked checkpoints.
const OBJECT = "66666666-6666-4666-8666-666666666666";
const source = {
  ...runSource({
    kind: "audio",
    mimeType: "audio/webm",
    durationMs: 120_000,
    contentVersionId: null,
  }),
  objectId: OBJECT,
  units: [],
  blocks: [],
};
const chunk = (id: string, offsetMs: number) => ({
  id,
  sourceId: source.sourceId,
  objectId: OBJECT,
  offsetMs,
  durationMs: 60_000,
  format: "mp3" as const,
});
const chunks = [chunk("c1", 0), chunk("c2", 60_000)];

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of Object.values(m)) if (typeof mock === "function") mock.mockReset();
  m.storeExtraction.mockImplementation(async (_job, _ctx, _run, stored, content) => ({
    ...stored,
    ...content,
    contentVersionId: "77777777-7777-4777-8777-777777777777",
  }));
});

describe("extractAudioSource", () => {
  it("needs the audio preparer", async () => {
    await expect(extractAudioSource(stageRun(), source)).rejects.toMatchObject({
      details: { fields: { audio: ["preparer_unavailable"] } },
    });
  });
  it("rejects a prepared chunk plan that does not fit the recording", async () => {
    const prepareAudio = vi.fn(async () => [{ ...chunk("c1", 0), durationMs: 180_000 }]);
    const run = stageRun();
    run.dependencies = { ...run.dependencies, prepareAudio };
    await expect(extractAudioSource(run, source)).rejects.toMatchObject({
      details: { fields: { audio: ["manifest_invalid"] } },
    });
    expect(m.saveStep).not.toHaveBeenCalled();
  });
  it("saves a new chunk plan, transcribes the pending chunks and yields to a fresh runner", async () => {
    const prepareAudio = vi.fn(async () => chunks);
    const run = stageRun();
    run.dependencies = { ...run.dependencies, prepareAudio, transcriptionConcurrency: 2 };
    m.completedSteps.mockResolvedValue(new Set(["stt:c1"]));
    m.ownedObjectMetadata.mockResolvedValue({ state: "ready" });
    m.transcribeChunks.mockResolvedValue(1);
    expect(await extractAudioSource(run, source)).toBe(YIELDED);
    expect(m.saveStep).toHaveBeenCalledWith(
      expect.anything(),
      run.payload.runId,
      `audio:${source.sourceId}`,
      chunks,
      run.job.now(),
    );
    // The transcribed chunk's leftover bytes are deleted; only the other chunk is sent.
    expect(m.deleteObject).toHaveBeenCalledTimes(1);
    expect(m.transcribeChunks).toHaveBeenCalledWith(
      run.job,
      expect.objectContaining({ chunks: [chunks[1]], concurrency: 2, model: "synthetic/stt" }),
    );
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      0,
    );
  });
  it("waits before the next runner when no chunk fit before the deadline", async () => {
    const run = stageRun();
    run.dependencies = { ...run.dependencies, prepareAudio: vi.fn() };
    m.checkpoints.set(`audio:${source.sourceId}`, chunks);
    m.completedSteps.mockResolvedValue(new Set());
    m.transcribeChunks.mockResolvedValue(0);
    expect(await extractAudioSource(run, source)).toBe(YIELDED);
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      YIELD_DELAY_SECONDS,
    );
  });
  it("stores the joined transcript once every chunk is transcribed", async () => {
    const onTranscribed = vi.fn();
    const run = stageRun();
    run.dependencies = { ...run.dependencies, prepareAudio: vi.fn(), onTranscribed };
    m.checkpoints.set(`audio:${source.sourceId}`, chunks);
    m.checkpoints.set("stt:c1", {
      text: "Hello class",
      segments: [{ startMs: 0, endMs: 2000, text: "Hello class", speakerId: "A" }],
    });
    m.checkpoints.set("stt:c2", { text: "", segments: [] });
    m.completedSteps.mockResolvedValue(new Set(["stt:c1", "stt:c2"]));
    m.ownedObjectMetadata.mockResolvedValue({ state: "deleted" });
    const stored = await extractAudioSource(run, source);
    expect(m.transcribeChunks).not.toHaveBeenCalled();
    expect(m.deleteObject).not.toHaveBeenCalled();
    const [, , , , content, settings] = m.storeExtraction.mock.calls[0] ?? [];
    expect(settings).toEqual({
      provider: "synthetic",
      model: "synthetic/stt",
      promptVersion: "synthetic-prompt",
    });
    expect(content.units).toEqual([
      { id: "c1-0", kind: "time", start: 0, end: 2000, status: "extracted" },
      { id: "c2", kind: "document", start: 1, status: "failed", reason: "no_speech" },
    ]);
    expect(content.blocks).toEqual([
      expect.objectContaining({ id: "c1-0-text", text: "Hello class", speakerRole: "unknown" }),
    ]);
    expect(content.blocks[0].speakerId).toBeDefined();
    expect(onTranscribed).toHaveBeenCalledWith(run.job.db, run.ctx, source.sourceId, run.job.now());
    expect(stored).toMatchObject({ contentVersionId: "77777777-7777-4777-8777-777777777777" });
  });
});
