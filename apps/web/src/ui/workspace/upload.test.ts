import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceRequestError, workspaceRequest } from "./api";
import { retryUploadRequest, UploadInterruptedError, uploadWithConfirmation } from "./upload";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const interrupted = "Upload interrupted. The local original is still saved.";

it("successful PUTs make no extra confirmation request", async () => {
  const confirm = vi.fn();
  await uploadWithConfirmation(
    async () => new Response(null, { status: 201 }),
    confirm,
    interrupted,
  );
  expect(confirm).not.toHaveBeenCalled();
});

it.each([400, 409, 503])(
  "recovers HTTP %s only after authoritative verification",
  async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(Response.json({ confirmed: true }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadWithConfirmation(
      () => fetch("https://private-upload.example/part", { method: "PUT" }),
      () => workspaceRequest("/api/sources/uploads/owned-upload/parts/0", "POST"),
      interrupted,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/sources/uploads/owned-upload/parts/0",
      expect.objectContaining({ method: "POST" }),
    ]);
  },
);

it("a lost PUT response can recover after verification without writing the bytes again", async () => {
  const write = vi.fn().mockRejectedValue(new TypeError("Synthetic response lost"));
  const confirm = vi.fn().mockResolvedValue({ confirmed: true });
  await uploadWithConfirmation(write, confirm, interrupted);
  expect(write).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("a server checksum rejection prevents upload completion after HTTP 400", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 400 }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Invalid part",
            details: { fields: { upload: ["checksum_mismatch"] } },
          },
        },
        { status: 422 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const complete = vi.fn();
  const upload = async () => {
    await uploadWithConfirmation(
      () => fetch("https://private-upload.example/part", { method: "PUT" }),
      () => workspaceRequest("/api/sources/uploads/owned-upload/parts/0", "POST"),
      interrupted,
    );
    await complete();
  };
  await expect(upload()).rejects.toThrow(interrupted);
  expect(complete).not.toHaveBeenCalled();
});

it.each([{ confirmed: false }, { state: "queued" }, { confirmed: "true" }, null, undefined])(
  "an unverified confirmation response %j cannot accept the part",
  async (confirmation) => {
    await expect(
      uploadWithConfirmation(
        async () => new Response(null, { status: 400 }),
        async () => confirmation,
        interrupted,
      ),
    ).rejects.toThrow(interrupted);
  },
);

it("a missing part or failed confirmation request leaves the upload interrupted", async () => {
  await expect(
    uploadWithConfirmation(
      async () => new Response(null, { status: 400 }),
      async () => {
        throw new TypeError("Synthetic verification connection lost");
      },
      interrupted,
    ),
  ).rejects.toThrow(interrupted);
});

it("retries a missing audio part after a connection drop and checkpoints its successful write", async () => {
  vi.useFakeTimers();
  const write = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Connection dropped"))
    .mockResolvedValueOnce(new Response(null, { status: 201 }));
  const confirm = vi
    .fn()
    .mockResolvedValueOnce({ confirmed: false })
    .mockResolvedValueOnce({ confirmed: true });
  const retry = vi.fn();
  const result = uploadWithConfirmation(write, confirm, interrupted, {
    attempts: 3,
    confirmSuccess: true,
    onRetry: retry,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(write).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[1] ?? 0);
  expect(retry).toHaveBeenCalledWith(2);
});

it("refreshes an expired signed URL only after verification establishes a missing part", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ url: "https://storage.example/expired" }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ confirmed: false }))
    .mockResolvedValueOnce(Response.json({ url: "https://storage.example/fresh" }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ confirmed: true }));
  vi.stubGlobal("fetch", fetchMock);
  const result = uploadWithConfirmation(
    async (signal) => {
      const link = await workspaceRequest<{ url: string }>(
        "/part/link",
        "GET",
        undefined,
        undefined,
        { signal },
      );
      return fetch(link.url, { method: "PUT", signal });
    },
    (signal) => workspaceRequest("/part/confirm", "POST", undefined, undefined, { signal }),
    interrupted,
    { attempts: 3, confirmSuccess: true },
  );
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/part/link",
    "https://storage.example/expired",
    "/part/confirm",
    "/part/link",
    "https://storage.example/fresh",
    "/part/confirm",
  ]);
});

it("retries an unknown confirmation without uploading already stored audio again", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Confirmation response lost"))
    .mockResolvedValueOnce({ confirmed: true });
  const result = uploadWithConfirmation(write, confirm, interrupted, {
    attempts: 3,
    confirmSuccess: true,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(write).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("an unresolved confirmation exhausts its bounded retries without another PUT", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockRejectedValue(new TypeError("PUT response lost"));
  const confirm = vi.fn().mockRejectedValue(new TypeError("Confirmation unavailable"));
  const result = expect(
    uploadWithConfirmation(write, confirm, interrupted, { attempts: 3 }),
  ).rejects.toBeInstanceOf(UploadInterruptedError);
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(write).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(3);
});

it("resuming skips an unacknowledged part when authoritative confirmation finds its bytes", async () => {
  const write = vi.fn();
  const confirm = vi.fn().mockResolvedValue({ confirmed: true });
  await uploadWithConfirmation(write, confirm, interrupted, {
    attempts: 3,
    confirmBeforeWrite: true,
  });
  expect(write).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(1);
});

it.each(["validation_failed", "unauthenticated", "conflict", "not_found"])(
  "preserves terminal %s confirmation errors and never resends the part",
  async (code) => {
    const write = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const failure = new WorkspaceRequestError("Check the selected audio.", code, undefined, 400, {
      audio: ["part_integrity_mismatch"],
    });
    const confirm = vi.fn().mockRejectedValue(failure);
    await expect(uploadWithConfirmation(write, confirm, interrupted, { attempts: 3 })).rejects.toBe(
      failure,
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  },
);

it("a stalled PUT is aborted and verified before any decision to resend", async () => {
  vi.useFakeTimers();
  let writeSignal: AbortSignal | undefined;
  const write = vi.fn((signal?: AbortSignal) => {
    writeSignal = signal;
    return new Promise<Response>(() => {});
  });
  const confirm = vi.fn().mockResolvedValue({ confirmed: true });
  const result = uploadWithConfirmation(write, confirm, interrupted, {
    attempts: 3,
    timeoutMs: 5000,
  });
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(writeSignal?.aborted).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("cancelling a retry stops both further requests and its pending timer", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const write = vi.fn().mockRejectedValue(new TypeError("Offline"));
  const confirm = vi.fn().mockResolvedValue({ confirmed: false });
  const result = expect(
    uploadWithConfirmation(write, confirm, interrupted, { attempts: 3, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await result;
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("an offline upload waits for reconnection without spending a request attempt", async () => {
  const browser = new EventTarget();
  const network = { onLine: false };
  vi.stubGlobal("window", browser);
  vi.stubGlobal("navigator", network);
  const offline = vi.fn();
  const write = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
  const confirm = vi.fn().mockResolvedValue({ confirmed: true });
  const result = uploadWithConfirmation(write, confirm, interrupted, {
    attempts: 3,
    confirmSuccess: true,
    onOffline: offline,
  });
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
  expect(offline).toHaveBeenCalledTimes(1);
  network.onLine = true;
  browser.dispatchEvent(new Event("online"));
  await result;
  expect(write).toHaveBeenCalledTimes(1);
});

it("safe upload API retries preserve their stable idempotency key", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("gateway unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ uploadId: "same-upload" }));
  vi.stubGlobal("fetch", fetchMock);
  const result = retryUploadRequest(
    (signal) => workspaceRequest("/audio/start", "POST", { parts: [0] }, "same-key", { signal }),
    interrupted,
    { attempts: 3 },
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual({ uploadId: "same-upload" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchMock.mock.calls)
    expect(init.headers["Idempotency-Key"]).toBe("same-key");
});
