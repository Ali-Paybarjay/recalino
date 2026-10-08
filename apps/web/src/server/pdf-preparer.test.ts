import { createHash, randomUUID } from "node:crypto";
import type { PdfPagesPreparer } from "@recalino/core/proc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { preparePdfPages } from "./pdf-preparer";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  source: vi.fn(),
  contract: vi.fn(),
  document: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
  encode: vi.fn(),
}));
vi.mock("@recalino/core/plt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@recalino/core/plt")>()),
  readOwnedObject: mocks.read,
  writeOwnedObject: mocks.write,
}));
vi.mock("@recalino/core/src", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@recalino/core/src")>()),
  getSource: mocks.source,
  readInputContract: mocks.contract,
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: mocks.document }));
vi.mock("@napi-rs/canvas", () => ({
  createCanvas: () => ({ getContext: () => ({}), encode: mocks.encode }),
}));

const original = Buffer.from("owned synthetic PDF");
const input: Parameters<PdfPagesPreparer>[0] = {
  db: {} as Parameters<PdfPagesPreparer>[0]["db"],
  store: {} as Parameters<PdfPagesPreparer>[0]["store"],
  ctx: { userId: randomUUID(), requestId: randomUUID() },
  runId: randomUUID(),
  now: new Date("2026-10-08T12:00:00Z"),
  pages: [2, 3],
  source: {
    sourceId: randomUUID(),
    kind: "pdf",
    objectId: randomUUID(),
    sha256: createHash("sha256").update(original).digest("hex"),
    mimeType: "application/pdf",
    pageCount: 5,
    durationMs: null,
    contentVersionId: null,
    captureAnchor: null,
    ranges: [{ start: 2, end: 5 }],
    units: [],
    blocks: [],
  },
};
function page() {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(original);
  mocks.write.mockImplementation(async () => randomUUID());
  mocks.source.mockResolvedValue({ kind: "pdf", contract_version: "1" });
  mocks.contract.mockResolvedValue({ formats: { pdf: { maxPages: 10, maxBytes: 1000 } } });
  mocks.getPage.mockImplementation(async () => page());
  mocks.destroy.mockResolvedValue(undefined);
  mocks.document.mockReturnValue({
    promise: Promise.resolve({ numPages: 5, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  });
  mocks.encode.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});
afterEach(() => vi.useRealTimers());

it("downloads, checks ownership and opens one document for the selected page batch", async () => {
  const first = page();
  const second = page();
  mocks.getPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const images = await preparePdfPages(input);
  expect(images.map((image) => image.page)).toEqual([2, 3]);
  expect(new Set(images.map((image) => image.objectId)).size).toBe(2);
  expect(mocks.source).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.document).toHaveBeenCalledTimes(1);
  expect(mocks.getPage.mock.calls.map(([number]) => number)).toEqual([2, 3]);
  expect(first.cleanup).toHaveBeenCalledOnce();
  expect(second.cleanup).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it.each([[], [1], [2, 2], [2, 3, 4, 5], [2, 6], [2.5]].map((pages) => ({ pages })))(
  "rejects invalid, excessive or unselected page batches before downloading (%j)",
  async ({ pages }) => {
    await expect(preparePdfPages({ ...input, pages })).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.document).not.toHaveBeenCalled();
  },
);

it("does not open an original with a changed content hash", async () => {
  mocks.read.mockResolvedValue(Buffer.from("changed"));
  await expect(preparePdfPages(input)).rejects.toMatchObject({ code: "validation_failed" });
  expect(mocks.document).not.toHaveBeenCalled();
});

it("keeps the prepared prefix usable if a speculative later page fails", async () => {
  mocks.getPage.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("Corrupt next page"));
  const images = await preparePdfPages(input);
  expect(images.map((image) => image.page)).toEqual([2]);
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("surfaces a current-page failure without creating an image", async () => {
  mocks.getPage.mockRejectedValueOnce(new Error("Corrupt current page"));
  await expect(preparePdfPages(input)).rejects.toThrow("Corrupt current page");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("shares the render deadline across the batch and returns the completed prefix", async () => {
  vi.useFakeTimers();
  const first = page();
  const blocked = page();
  const cancel = vi.fn();
  blocked.render.mockReturnValue({ promise: new Promise<void>(() => {}), cancel });
  mocks.getPage.mockResolvedValueOnce(first).mockResolvedValueOnce(blocked);
  const result = preparePdfPages(input);
  await vi.advanceTimersByTimeAsync(60000);
  expect((await result).map((image) => image.page)).toEqual([2]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(blocked.cleanup).toHaveBeenCalledOnce();
});
