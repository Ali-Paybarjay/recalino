import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { calculateFileHashes, type FileHashes, prepareFileHashes } from "./file-hashes";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
it("reads original bytes once and hashes correctly indexed complete and trailing parts", async () => {
  const file = new Blob(["abcdefghij"]);
  const reads = vi.spyOn(file, "arrayBuffer");
  expect(await calculateFileHashes(file, 4, true)).toEqual({
    sha256: sha256("abcdefghij"),
    parts: ["abcd", "efgh", "ij"].map((part, index) => ({
      index,
      sizeBytes: part.length,
      sha256: sha256(part),
    })),
  });
  expect(reads).toHaveBeenCalledOnce();
});
it("omits transport parts for a local audio source and works without Worker support", async () => {
  vi.stubGlobal("Worker", undefined);
  expect(await prepareFileHashes(new Blob(["audio"]), 4, false)).toEqual({
    sha256: sha256("audio"),
    parts: [],
  });
});
it.each([0, -1, 1.5, Number.NaN])(
  "rejects invalid part size %s before reading",
  async (partBytes) => {
    const file = new Blob(["content"]);
    const reads = vi.spyOn(file, "arrayBuffer");
    await expect(calculateFileHashes(file, partBytes, true)).rejects.toThrow();
    expect(reads).not.toHaveBeenCalled();
  },
);

function worker() {
  const instances: TestWorker[] = [];
  class TestWorker {
    onmessage: ((event: { data: { result?: FileHashes; error?: string } }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("Worker", TestWorker);
  return () => {
    const instance = instances[0];
    if (!instance) throw new Error("Expected a hash worker");
    return instance;
  };
}
it("returns worker output and removes the exact abort listener before terminating", async () => {
  const current = worker();
  const controller = new AbortController();
  const added = vi.spyOn(controller.signal, "addEventListener"),
    removed = vi.spyOn(controller.signal, "removeEventListener");
  const output = { sha256: sha256("content"), parts: [] };
  const run = prepareFileHashes(new Blob(["content"]), 4, false, controller.signal);
  current().onmessage?.({ data: { result: output } });
  expect(await run).toEqual(output);
  expect(current().terminate).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0]?.[1]);
});
it("cancels a running worker and terminates it without waiting for a reply", async () => {
  const current = worker();
  const controller = new AbortController();
  const run = prepareFileHashes(new Blob(["content"]), 4, true, controller.signal);
  const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(new DOMException("paused", "AbortError"));
  await rejected;
  expect(current().terminate).toHaveBeenCalledOnce();
});
it("cleans up the worker and abort listener when its deadline expires", async () => {
  vi.useFakeTimers();
  const current = worker();
  const controller = new AbortController();
  const added = vi.spyOn(controller.signal, "addEventListener"),
    removed = vi.spyOn(controller.signal, "removeEventListener");
  const run = prepareFileHashes(new Blob(["content"]), 4, true, controller.signal);
  const rejected = expect(run).rejects.toThrow("File checking took too long");
  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(current().terminate).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0]?.[1]);
});
