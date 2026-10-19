// PERF-05 (audit 2026-10-18): every Vercel Blob call has a deadline. A request that hangs is
// rejected as the retryable storage_timeout error, so the job runner retries it instead of
// waiting for the function limit. The SDK is replaced by fakes that never answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  class BlobRequestAbortedError extends Error {}
  return {
    BlobNotFoundError,
    BlobRequestAbortedError,
    calls: [] as { name: string; options: { abortSignal?: AbortSignal } | undefined }[],
    behaviour: "hang" as "hang" | "honour-signal" | "answer",
  };
});

/** Records the options, then never settles ("hang"), or rejects like the SDK when aborted. */
function fake(name: string, answer: unknown, optionsAt: number) {
  return (...args: unknown[]) => {
    const options = args[optionsAt] as { abortSignal?: AbortSignal } | undefined;
    sdk.calls.push({ name, options });
    if (sdk.behaviour === "answer")
      return Promise.resolve(typeof answer === "function" ? answer() : answer);
    return new Promise((_resolve, reject) => {
      if (sdk.behaviour === "honour-signal")
        options?.abortSignal?.addEventListener("abort", () =>
          reject(new sdk.BlobRequestAbortedError("The request was aborted.")),
        );
    });
  };
}

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: sdk.BlobNotFoundError,
  head: fake("head", { size: 1, contentType: "x/y", uploadedAt: new Date(0), etag: "e" }, 1),
  get: fake(
    "get",
    () => ({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      }),
    }),
    1,
  ),
  put: fake("put", {}, 2),
  del: fake("del", undefined, 1),
  list: fake("list", { blobs: [], hasMore: false }, 0),
  issueSignedToken: fake("issueSignedToken", { clientSigningToken: "c", delegationToken: "d" }, 0),
  presignUrl: async () => ({ presignedUrl: "https://blob.example/object" }),
  getDownloadUrl: (url: string) => url,
  createMultipartUpload: fake("createMultipartUpload", { uploadId: "u", key: "k" }, 1),
  uploadPart: fake("uploadPart", { etag: "e", partNumber: 1 }, 2),
  completeMultipartUpload: fake("completeMultipartUpload", {}, 2),
}));

const { VercelBlobStore } = await import("./storage-vercel-blob");
const { AppError } = await import("./errors");
const { DEFAULT_PLT_SETTINGS } = await import("./settings");

const TIMEOUT_MS = 25;

function expectStorageTimeout(error: unknown) {
  expect(error).toBeInstanceOf(AppError);
  // service_unavailable is a temporary failure: the job runner schedules a retry (FR-PLT-005).
  expect(error).toMatchObject({ code: "service_unavailable", reason: "storage_timeout" });
  expect((error as InstanceType<typeof AppError>).details).toEqual({
    fields: { storage: ["storage_timeout"] },
  });
}

beforeEach(() => {
  sdk.calls.length = 0;
  sdk.behaviour = "hang";
});

describe("PERF-05 Vercel Blob deadlines", () => {
  const store = () => new VercelBlobStore({ timeoutMs: TIMEOUT_MS });
  const operations: [string, (s: InstanceType<typeof VercelBlobStore>) => Promise<unknown>][] = [
    ["write", (s) => s.write("src/a", new Uint8Array([1]), "audio/webm")],
    ["head", (s) => s.head("src/a")],
    ["read", (s) => s.read("src/a")],
    ["delete", (s) => s.delete("src/a")],
    ["list", (s) => s.list("src/")],
    [
      "signWrite",
      (s) => s.signWrite("src/a", { contentType: "x/y", maxBytes: 1, validUntil: new Date() }),
    ],
    ["signRead", (s) => s.signRead("src/a", new Date())],
    ["compose", (s) => s.compose(["src/a"], "src/b", "audio/webm", "multipart")],
  ];

  it.each(operations)("rejects a hung %s with storage_timeout", async (_name, run) => {
    const started = Date.now();
    const error = await run(store()).catch((caught: unknown) => caught);
    expectStorageTimeout(error);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(sdk.calls[0]?.options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(sdk.calls[0]?.options?.abortSignal?.aborted).toBe(true);
  });

  it("maps the SDK's own abort error to storage_timeout", async () => {
    sdk.behaviour = "honour-signal";
    expectStorageTimeout(
      await store()
        .write("src/a", new Uint8Array([1]), "audio/webm")
        .catch((caught: unknown) => caught),
    );
  });

  it("passes a live signal and answers normally when the store replies", async () => {
    sdk.behaviour = "answer";
    await expect(store().head("src/a")).resolves.toMatchObject({ size: 1, etag: "e" });
    await store().write("src/a", new Uint8Array([1]), "audio/webm");
    await expect(store().read("src/a")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(sdk.calls.map((call) => call.name)).toEqual(["head", "put", "get"]);
    expect(sdk.calls.every((call) => call.options?.abortSignal?.aborted === false)).toBe(true);
  });

  it("defaults to the 60-second setting, overridable in PLT_SETTINGS_JSON", () => {
    expect(DEFAULT_PLT_SETTINGS.storage.blobTimeoutMs).toBe(60_000);
    expect(new VercelBlobStore().timeoutMs).toBe(60_000);
  });
});
