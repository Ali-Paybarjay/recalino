import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSource, stageRun } from "../../../test/processing-run";
import { YIELDED } from "./context";
import { extractPdfSource } from "./pdf-source";

const m = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(),
  checkpointAndContinue: vi.fn(),
  storeExtraction: vi.fn(),
  saveStep: vi.fn(),
  liveRun: vi.fn(),
  providerStep: vi.fn(),
  readOwnedObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<object>()),
  cached: vi.fn(
    async (_db: unknown, _run: string, step: string) => m.checkpoints.get(step) ?? null,
  ),
  checkpointAndContinue: m.checkpointAndContinue,
  storeExtraction: m.storeExtraction,
  saveStep: m.saveStep,
  liveRun: m.liveRun,
  providerStep: m.providerStep,
}));
vi.mock("../../plt", async (original) => ({
  ...(await original<object>()),
  readOwnedObject: m.readOwnedObject,
  deleteObject: m.deleteObject,
}));

// QUA-01: the PDF extraction stage, with a mock provider and mocked checkpoints.
const OBJECT = "66666666-6666-4666-8666-666666666666";
const image = (page: number) => ({
  page,
  objectId: `88888888-8888-4888-8888-00000000000${page}`,
  mimeType: "image/png" as const,
});
const pdf = {
  ...runSource({ kind: "pdf", mimeType: "application/pdf", pageCount: 3 }),
  objectId: OBJECT,
  units: [
    { id: "p1", kind: "page" as const, start: 1, status: "extracted" as const },
    {
      id: "p2",
      kind: "page" as const,
      start: 2,
      status: "failed" as const,
      reason: "ocr_required",
    },
    {
      id: "p3",
      kind: "page" as const,
      start: 3,
      status: "failed" as const,
      reason: "ocr_required",
    },
  ],
  blocks: [{ id: "p1-1", kind: "paragraph" as const, text: "Printed page.", unitId: "p1" }],
};
const reading = (text: string) => ({
  classification: { role: "class_material", confidence: "uncertain" },
  blocks: text ? [{ id: "b1", text }] : [],
});

beforeEach(() => {
  m.checkpoints.clear();
  for (const mock of Object.values(m)) if (typeof mock === "function") mock.mockReset();
  m.readOwnedObject.mockResolvedValue(new Uint8Array([1, 2, 3]));
  m.storeExtraction.mockImplementation(async (_job, _ctx, _run, stored, content) => ({
    ...stored,
    ...content,
  }));
});

describe("extractPdfSource", () => {
  it("refuses an original whose bytes changed", async () => {
    await expect(
      extractPdfSource(stageRun(), { ...pdf, contentVersionId: null }),
    ).rejects.toMatchObject({ details: { fields: { source: ["integrity_mismatch"] } } });
  });
  it("needs a page renderer for pages without text", async () => {
    await expect(extractPdfSource(stageRun(), pdf)).rejects.toMatchObject({
      details: { fields: { pdf: ["page_renderer_unavailable"] } },
    });
    // The text layer is saved before the renderer is needed.
    expect(m.saveStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      `pdf:text:${pdf.sourceId}`,
      { units: pdf.units, blocks: pdf.blocks },
      expect.any(Date),
    );
  });
  it("renders the pending pages in one batch, reads them and yields", async () => {
    const preparePdfPages = vi.fn(async () => [image(2), image(3)]);
    const run = stageRun();
    run.dependencies = { ...run.dependencies, preparePdfPages };
    m.providerStep.mockImplementation(async (_job, _ctx, _run, step: string) => {
      const page = Number(step.split(":").at(-1));
      m.checkpoints.set(step, reading(`Page ${page}`));
      return reading(`Page ${page}`);
    });
    m.saveStep.mockImplementation(async (_tx, _run, step: string, output: unknown) => {
      m.checkpoints.set(step, output);
    });
    expect(await extractPdfSource(run, pdf)).toBe(YIELDED);
    expect(preparePdfPages).toHaveBeenCalledWith(expect.objectContaining({ pages: [2, 3] }));
    expect(m.providerStep.mock.calls.map((call) => call[3])).toEqual([
      `vision:pdf:${pdf.sourceId}:2`,
      `vision:pdf:${pdf.sourceId}:3`,
    ]);
    expect(m.deleteObject).toHaveBeenCalledTimes(2);
    expect(m.checkpointAndContinue).toHaveBeenCalledWith(
      run.job,
      run.ctx,
      run.payload.runId,
      run.definition,
      0,
    );
  });
  it("stores the text layer with each page's reading once every page is read", async () => {
    m.checkpoints.set(`vision:pdf:${pdf.sourceId}:2`, reading("Board notes"));
    m.checkpoints.set(`vision:pdf:${pdf.sourceId}:3`, reading(""));
    const stored = await extractPdfSource(stageRun(), pdf);
    const [, , , , content, settings] = m.storeExtraction.mock.calls[0] ?? [];
    expect(content.units.map((unit: { status: string }) => unit.status)).toEqual([
      "extracted",
      "extracted",
      "failed",
    ]);
    expect(content.units[2].reason).toBe("unreadable");
    expect(content.blocks.map((block: { id: string }) => block.id)).toEqual(["p1-1", "p2-ocr-b1"]);
    expect(settings).toEqual({
      method: "selected_page_ocr",
      sourceClassification: { role: "class_material", confidence: "uncertain" },
      provider: "synthetic",
      model: "synthetic/vision",
      promptVersion: "synthetic-prompt",
    });
    expect(stored).toMatchObject({ sourceId: pdf.sourceId });
    expect(m.checkpointAndContinue).not.toHaveBeenCalled();
  });
});
