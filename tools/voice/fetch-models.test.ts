import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_ATTEMPTS,
  DOWNLOAD_BACKOFF_MS,
  DOWNLOAD_TIMEOUT_MS,
  fetchPinned,
} from "./fetch-models.mjs";

// OPS-06 (docs/audit/2026-10-18-project-audit.md): a slow or failing model host must not hang
// or silently weaken the build. Every download here uses a fake fetch; nothing touches the network.

const bytes = Buffer.from("synthetic model weights");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = "https://models.invalid/model.onnx";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "recalino-fetch-models-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

const ok = () => new Response(bytes, { status: 200 });
const quiet = { log: () => undefined };
/** Records the waits instead of sleeping. */
function waits() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}
/** A host that accepts the request and never answers, until the caller's signal aborts it. */
const hangs = (_url: string, init: { signal: AbortSignal }) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });

describe("OPS-06 model download", () => {
  it("defaults to a 120 second timeout, three attempts and doubling backoff", async () => {
    expect(DOWNLOAD_TIMEOUT_MS).toBe(120_000);
    expect(DOWNLOAD_ATTEMPTS).toBe(3);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await fetchPinned(url, join(directory, "model.onnx"), sha256, {
      fetchImpl: async () => ok(),
      ...quiet,
    });
    expect(timeout).toHaveBeenCalledWith(120_000);
  });

  it("writes a verified download and nothing else beside it", async () => {
    const path = join(directory, "model.onnx");
    await fetchPinned(url, path, sha256, { fetchImpl: async () => ok(), ...quiet });
    expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(directory)).toEqual(["model.onnx"]);
  });

  it("retries a server error, waiting 2 s and then 4 s by default", async () => {
    const { slept, sleep } = waits();
    let calls = 0;
    const fetchImpl = async () => (++calls < 3 ? new Response("", { status: 503 }) : ok());
    await fetchPinned(url, join(directory, "model.onnx"), sha256, { fetchImpl, sleep, ...quiet });
    expect(calls).toBe(3);
    expect(slept).toEqual([DOWNLOAD_BACKOFF_MS, DOWNLOAD_BACKOFF_MS * 2]);
  });

  it("retries a dropped connection and then stops with a fixed error", async () => {
    const { slept, sleep } = waits();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      throw new TypeError("fetch failed");
    };
    await expect(
      fetchPinned(url, join(directory, "model.onnx"), sha256, { fetchImpl, sleep, ...quiet }),
    ).rejects.toThrow("model_download_network_error");
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2);
  });

  it("stops a host that never answers with model_download_timeout after the last attempt", async () => {
    const { slept, sleep } = waits();
    let calls = 0;
    const fetchImpl = (target: string, init: { signal: AbortSignal }) => {
      calls++;
      return hangs(target, init);
    };
    const path = join(directory, "model.onnx");
    await expect(
      fetchPinned(url, path, sha256, { fetchImpl, sleep, timeoutMs: 20, ...quiet }),
    ).rejects.toThrow("model_download_timeout");
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2);
    expect(await readdir(directory)).toEqual([]);
  });

  it("times out a body that stalls after the headers arrived", async () => {
    const { sleep } = waits();
    const fetchImpl = async (_target: string, init: { signal: AbortSignal }) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason), {
            once: true,
          });
        },
      });
      return new Response(body, { status: 200 });
    };
    await expect(
      fetchPinned(url, join(directory, "model.onnx"), sha256, {
        fetchImpl,
        sleep,
        timeoutMs: 20,
        attempts: 2,
        ...quiet,
      }),
    ).rejects.toThrow("model_download_timeout");
  });

  it("does not retry an answer that will not change", async () => {
    const { slept, sleep } = waits();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: 404 });
    };
    await expect(
      fetchPinned(url, join(directory, "model.onnx"), sha256, { fetchImpl, sleep, ...quiet }),
    ).rejects.toThrow("model_download_http_404");
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("rejects a download that does not match the pinned SHA-256 and keeps no file", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("tampered", { status: 200 });
    };
    await expect(
      fetchPinned(url, join(directory, "model.onnx"), sha256, { fetchImpl, ...quiet }),
    ).rejects.toThrow("model_download_integrity_mismatch");
    expect(calls).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  });

  it("uses an existing verified file without any request", async () => {
    const path = join(directory, "model.onnx");
    await writeFile(path, bytes);
    const fetchImpl = vi.fn();
    await fetchPinned(url, path, sha256, { fetchImpl, ...quiet });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("build cache", () => {
    it("lets a second build succeed from the cache with the network down", async () => {
      const cacheDirectory = join(directory, "cache");
      const first = join(directory, "first", "model.onnx");
      await mkdir(join(directory, "first"));
      await fetchPinned(url, first, sha256, {
        fetchImpl: async () => ok(),
        cacheDirectory,
        ...quiet,
      });
      expect(await readdir(cacheDirectory)).toEqual([sha256]);

      const second = join(directory, "second", "model.onnx");
      await mkdir(join(directory, "second"));
      const offline = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      await fetchPinned(url, second, sha256, { fetchImpl: offline, cacheDirectory, ...quiet });
      expect(offline).not.toHaveBeenCalled();
      expect(await readFile(second)).toEqual(bytes);
    });

    it("ignores a cache entry whose content is not the pinned file", async () => {
      const cacheDirectory = join(directory, "cache");
      await mkdir(cacheDirectory);
      await writeFile(join(cacheDirectory, sha256), "poisoned");
      const path = join(directory, "model.onnx");
      const fetchImpl = vi.fn(async () => ok());
      await fetchPinned(url, path, sha256, { fetchImpl, cacheDirectory, ...quiet });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(await readFile(path)).toEqual(bytes);
      expect(await readFile(join(cacheDirectory, sha256))).toEqual(bytes);
    });

    it("still succeeds when the cache directory cannot be written", async () => {
      const blocker = join(directory, "not-a-directory");
      await writeFile(blocker, "x");
      const path = join(directory, "model.onnx");
      await fetchPinned(url, path, sha256, {
        fetchImpl: async () => ok(),
        cacheDirectory: join(blocker, "cache"),
        ...quiet,
      });
      expect(await readFile(path)).toEqual(bytes);
    });
  });
});
