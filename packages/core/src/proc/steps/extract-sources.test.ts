import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { YIELDED } from "./context";
import { extractSources } from "./extract-sources";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  audio: vi.fn(),
  pdf: vi.fn(),
  image: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
}));
vi.mock("./audio-source", () => ({ extractAudioSource: m.audio }));
vi.mock("./pdf-source", () => ({ extractPdfSource: m.pdf }));
vi.mock("./image-sources", () => ({ extractImageSources: m.image }));

// QUA-01: the extraction stage's order, reuse and dispatch to each source kind's stage.
const OBJECT = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of [m.audio, m.pdf, m.image]) mock.mockReset();
});

describe("extractSources", () => {
  it("reuses checkpoints and saved content, and extracts the rest in order", async () => {
    const saved = runSource();
    const checkpointed = runSource({ kind: "image", objectId: OBJECT, contentVersionId: null });
    const audio = runSource({ kind: "audio", objectId: OBJECT, contentVersionId: null });
    const pdf = runSource({
      kind: "pdf",
      objectId: OBJECT,
      units: [{ id: "p1", kind: "page", start: 1, status: "failed", reason: "ocr_required" }],
      blocks: [],
    });
    m.checkpoints.set(`source:${checkpointed.sourceId}`, { ...checkpointed, blocks: saved.blocks });
    m.audio.mockImplementation(async (_run, source) => ({ ...source, blocks: saved.blocks }));
    m.pdf.mockImplementation(async (_run, source) => source);
    const run = stageRun();
    run.snapshot = { ...run.snapshot, sources: [saved, checkpointed, audio, pdf] };
    const extracted = await extractSources(run);
    expect(extracted).not.toBe(YIELDED);
    expect((extracted as { sourceId: string }[]).map((source) => source.sourceId)).toEqual([
      saved.sourceId,
      checkpointed.sourceId,
      audio.sourceId,
      pdf.sourceId,
    ]);
    expect(m.audio).toHaveBeenCalledWith(run, audio);
    // A PDF with saved text still needs its OCR pages read.
    expect(m.pdf).toHaveBeenCalledWith(run, pdf);
    expect(m.image).not.toHaveBeenCalled();
  });
  it("ends at a stage that yields; a photo always yields", async () => {
    const audio = runSource({ kind: "audio", objectId: OBJECT, contentVersionId: null });
    const photo = runSource({ kind: "image", objectId: OBJECT, contentVersionId: null });
    const run = stageRun();
    run.snapshot = { ...run.snapshot, sources: [photo, audio] };
    m.image.mockResolvedValue(YIELDED);
    expect(await extractSources(run)).toBe(YIELDED);
    expect(m.image).toHaveBeenCalledWith(run, photo);
    expect(m.audio).not.toHaveBeenCalled();
    run.snapshot = { ...run.snapshot, sources: [audio, photo] };
    m.audio.mockResolvedValue(YIELDED);
    expect(await extractSources(run)).toBe(YIELDED);
    expect(m.image).toHaveBeenCalledTimes(1);
  });
  it("needs a stored original, a known kind and some text", async () => {
    const run = stageRun();
    run.snapshot = {
      ...run.snapshot,
      sources: [runSource({ kind: "audio", contentVersionId: null })],
    };
    await expect(extractSources(run)).rejects.toMatchObject({
      details: { fields: { source: ["original_unavailable"] } },
    });
    run.snapshot = {
      ...run.snapshot,
      sources: [runSource({ kind: "html", objectId: OBJECT, contentVersionId: null })],
    };
    await expect(extractSources(run)).rejects.toMatchObject({
      details: { fields: { source: ["content_unavailable"] } },
    });
    run.snapshot = { ...run.snapshot, sources: [runSource({ blocks: [] })] };
    await expect(extractSources(run)).rejects.toMatchObject({
      details: { fields: { sources: ["no_extractable_content"] } },
    });
  });
});
