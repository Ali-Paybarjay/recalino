import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceRequestError, type workspaceRequest } from "./api";
import { inAutomaticLearningBatch, pendingLearningBatch } from "./automatic-learning";
import { createSourceUploadRequest, uploadSourceFileParts } from "./source-upload";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function input() {
  return {
    uploadId: "synthetic-upload",
    file: new Blob(["abcdefghijkl"]),
    mimeType: "text/plain",
    partBytes: 4,
    parts: [0, 1, 2].map((index) => ({ index, sizeBytes: 4 })),
    onProgress: vi.fn(),
  };
}

function singlePart() {
  return { ...input(), file: new Blob(["abcd"]), parts: [{ index: 0, sizeBytes: 4 }] };
}

it("FR-SRC-004 resumes confirmed and unacknowledged parts, then retries completion with one key", async () => {
  vi.useFakeTimers();
  let confirmations = 0;
  let completions = 0;
  const request = vi.fn(async (path: string, method: string) => {
    if (path.endsWith("/synthetic-upload"))
      return { state: "pending", parts: [{ index: 0, verifiedAt: "saved" }] };
    if (path.endsWith("/parts/1") && method === "POST") return { confirmed: true };
    if (path.endsWith("/parts/2") && method === "POST") return { confirmed: ++confirmations > 1 };
    if (path.endsWith("/parts/2") && method === "GET")
      return { url: "https://storage.example/new" };
    if (path.endsWith("/complete")) {
      if (++completions === 1) throw new TypeError("Synthetic acknowledgement lost");
      return { state: "pending", jobId: "same-job" };
    }
    throw new Error("Unexpected synthetic request");
  });
  const put = vi.fn().mockResolvedValue({ ok: true, status: 201 });
  const material = input();
  const result = uploadSourceFileParts(material, {
    request: request as typeof workspaceRequest,
    put,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(put).toHaveBeenCalledTimes(1);
  const written = put.mock.calls[0]?.[1] as Blob | undefined;
  expect(await written?.text()).toBe("ijkl");
  expect(confirmations).toBe(2);
  expect(material.onProgress).toHaveBeenLastCalledWith(12);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/parts/0"))).toHaveLength(0);
  const completed = vi
    .mocked(request as typeof workspaceRequest)
    .mock.calls.filter(([path]) => path.endsWith("/complete"));
  expect(completed).toHaveLength(2);
  expect(completed.every((call) => call[3] === "source-complete:synthetic-upload")).toBe(true);
});

it("FR-SRC-004 refreshes the signed URL after an expired link and checkpoints the retry", async () => {
  vi.useFakeTimers();
  let confirmations = 0;
  let links = 0;
  const request = vi.fn(async (path: string, method: string) => {
    if (path.endsWith("/synthetic-upload")) return { state: "pending", parts: [] };
    if (path.endsWith("/parts/0") && method === "POST") return { confirmed: ++confirmations === 3 };
    if (path.endsWith("/parts/0") && method === "GET")
      return { url: `https://storage.example/${++links}` };
    return { jobId: "verification" };
  });
  const put = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 403 })
    .mockResolvedValueOnce({ ok: true, status: 201 });
  const result = uploadSourceFileParts(singlePart(), {
    request: request as typeof workspaceRequest,
    put,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(put.mock.calls.map(([url]) => url)).toEqual([
    "https://storage.example/1",
    "https://storage.example/2",
  ]);
  expect(confirmations).toBe(3);
});

it("FR-SRC-004 never repeats a successful PUT whose response was lost", async () => {
  let confirmations = 0;
  const request = vi.fn(async (path: string, method: string) => {
    if (path.endsWith("/synthetic-upload")) return { state: "pending", parts: [] };
    if (method === "GET") return { url: "https://storage.example/part" };
    if (path.endsWith("/parts/0")) return { confirmed: ++confirmations === 2 };
    return { jobId: "verification" };
  });
  const put = vi.fn().mockRejectedValue(new TypeError("Synthetic PUT response lost"));
  await uploadSourceFileParts(singlePart(), { request: request as typeof workspaceRequest, put });
  expect(put).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
});

it("FR-SRC-004 preserves a terminal integrity rejection without writing or completing", async () => {
  const failure = new WorkspaceRequestError(
    "Invalid synthetic bytes",
    "validation_failed",
    undefined,
    400,
  );
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("/synthetic-upload")) return { state: "pending", parts: [] };
    throw failure;
  });
  const put = vi.fn();
  await expect(
    uploadSourceFileParts(singlePart(), { request: request as typeof workspaceRequest, put }),
  ).rejects.toBe(failure);
  expect(put).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(0);
});

it("FR-SRC-004 stops after three missing writes without queuing verification", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (path: string, method: string) => {
    if (path.endsWith("/synthetic-upload")) return { state: "pending", parts: [] };
    return method === "GET" ? { url: "https://storage.example/part" } : { confirmed: false };
  });
  const put = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  const result = expect(
    uploadSourceFileParts(singlePart(), { request: request as typeof workspaceRequest, put }),
  ).rejects.toThrow("Upload interrupted");
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(put).toHaveBeenCalledTimes(3);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(0);
});

it("FR-SRC-004 aborts an in-flight PUT without sending confirmation or completion", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const request = vi.fn(async (path: string, method: string) => {
    if (path.endsWith("/synthetic-upload")) return { state: "pending", parts: [] };
    return method === "GET" ? { url: "https://storage.example/part" } : { confirmed: false };
  });
  const put = vi.fn(() => new Promise<{ ok: boolean; status: number }>(() => {}));
  const result = expect(
    uploadSourceFileParts(singlePart(), {
      request: request as typeof workspaceRequest,
      put,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  expect(put).toHaveBeenCalledTimes(1);
  controller.abort();
  await result;
  expect(request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["verified", "verifying"])(
  "FR-SRC-004 does not resend bytes for a %s manifest",
  async (state) => {
    const request = vi.fn().mockResolvedValue({ state, parts: [] });
    const put = vi.fn();
    await uploadSourceFileParts(singlePart(), { request, put });
    expect(request).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  },
);

it("FR-PLT-004 retries source creation with the original operation key", async () => {
  vi.useFakeTimers();
  const api = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Synthetic response lost"))
    .mockResolvedValueOnce({ assetId: "same-source" });
  const request = createSourceUploadRequest({}, api);
  const result = request("/api/sources", "POST", { kind: "text" }, "same-operation");
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toEqual({ assetId: "same-source" });
  expect(api.mock.calls.every((call) => call[3] === "same-operation")).toBe(true);
});

it("FR-PROC-001 retries a lost batch acknowledgement without reopening its upload fence", async () => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const attempts = new Map<string, number>();
  const bodies: { action: string; batchId: string }[] = [];
  const api = vi.fn(async (_path: string, _method: string, body: unknown) => {
    const batch = body as { action: string; batchId: string };
    bodies.push(batch);
    const count = (attempts.get(batch.action) ?? 0) + 1;
    attempts.set(batch.action, count);
    if (count === 1) throw new TypeError("Synthetic batch acknowledgement lost");
    return { batchId: batch.action === "begin" ? batch.batchId : null };
  });
  const upload = vi.fn().mockResolvedValue(undefined);
  const result = inAutomaticLearningBatch(
    "learner",
    "class",
    upload,
    createSourceUploadRequest({}, api as typeof workspaceRequest),
  );
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(upload).toHaveBeenCalledTimes(1);
  expect(bodies.map(({ action }) => action)).toEqual(["begin", "begin", "complete", "complete"]);
  expect(new Set(bodies.map(({ batchId }) => batchId)).size).toBe(1);
  expect(pendingLearningBatch("learner", "class")).toBeNull();
});

it("FR-PROC-001 retains the batch fence when navigation cancels an unfinished picker upload", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const controller = new AbortController();
  const api = vi.fn(async (_path: string, _method: string, body: unknown) => ({
    batchId: (body as { batchId: string }).batchId,
  }));
  await expect(
    inAutomaticLearningBatch(
      "learner",
      "class",
      async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      },
      createSourceUploadRequest({ signal: controller.signal }, api as typeof workspaceRequest),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(api).toHaveBeenCalledTimes(1);
  expect(pendingLearningBatch("learner", "class")).not.toBeNull();
});
