import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadWithProgress } from "./upload-progress";

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  static sendFailure: Error | undefined;
  status = 0;
  upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => {
    if (FakeXMLHttpRequest.sendFailure) throw FakeXMLHttpRequest.sendFailure;
  });
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  progress(loaded: number, total = loaded) {
    this.upload.onprogress?.({ loaded, total });
  }

  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const signedUrl = "https://storage.example/upload?signature=original";
const body = new Blob(["0123456789"], { type: "application/pdf" });
const request = () => {
  const instance = FakeXMLHttpRequest.instances[0];
  if (!instance) throw new Error("The upload request has not been created.");
  return instance;
};

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.sendFailure = undefined;
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});
afterEach(() => vi.unstubAllGlobals());

it("PUTs the unchanged blob to its signed URL and reports actual bytes with the blob size", async () => {
  const progress = vi.fn();
  const upload = uploadWithProgress(signedUrl, body, body.type, progress);
  expect(request().open).toHaveBeenCalledWith("PUT", signedUrl);
  expect(request().setRequestHeader).toHaveBeenCalledWith("Content-Type", body.type);
  expect(request().send).toHaveBeenCalledWith(body);
  request().progress(-4);
  request().progress(4, 500);
  request().progress(20, 500);
  request().respond(201);
  await expect(upload).resolves.toEqual({ ok: true, status: 201 });
  expect(progress.mock.calls).toEqual([
    [0, 10],
    [0, 10],
    [4, 10],
    [10, 10],
    [10, 10],
  ]);
});

it.each([400, 409, 413, 503])(
  "preserves HTTP %s without synthesizing completed bytes",
  async (status) => {
    const progress = vi.fn();
    const upload = uploadWithProgress(signedUrl, body, body.type, progress);
    request().progress(4);
    request().respond(status);
    await expect(upload).resolves.toEqual({ ok: false, status });
    expect(progress.mock.calls).toEqual([
      [0, 10],
      [4, 10],
    ]);
  },
);

it("cleans up progress and abort listeners after success", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const progress = vi.fn();
  const upload = uploadWithProgress(signedUrl, body, body.type, progress, controller.signal);
  request().respond(204);
  await upload;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  request().progress(4);
  controller.abort();
  expect(progress).toHaveBeenCalledTimes(2);
  expect(request().abort).not.toHaveBeenCalled();
  expect(request().onload).toBeNull();
  expect(request().onerror).toBeNull();
});

it("rejects a lost response as a retryable network error and cleans up listeners", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const upload = uploadWithProgress(signedUrl, body, body.type, vi.fn(), controller.signal);
  request().onerror?.();
  await expect(upload).rejects.toBeInstanceOf(TypeError);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(request().upload.onprogress).toBeNull();
  controller.abort();
  expect(request().abort).not.toHaveBeenCalled();
});

it("does not start a request for an already aborted signal", async () => {
  const controller = new AbortController();
  const reason = new Error("The user cancelled this upload.");
  controller.abort(reason);
  const progress = vi.fn();
  await expect(
    uploadWithProgress(signedUrl, body, body.type, progress, controller.signal),
  ).rejects.toBe(reason);
  expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  expect(progress).not.toHaveBeenCalled();
});

it("aborts the active request and preserves the signal's timeout reason", async () => {
  const controller = new AbortController();
  const reason = new DOMException("The deadline expired.", "TimeoutError");
  const progress = vi.fn();
  const upload = uploadWithProgress(signedUrl, body, body.type, progress, controller.signal);
  request().progress(3);
  controller.abort(reason);
  await expect(upload).rejects.toBe(reason);
  expect(request().abort).toHaveBeenCalledTimes(1);
  request().progress(8);
  request().respond(201);
  expect(progress.mock.calls).toEqual([
    [0, 10],
    [3, 10],
  ]);
});

it("rejects browser aborts as AbortError", async () => {
  const upload = uploadWithProgress(signedUrl, body, body.type, vi.fn());
  request().onabort?.();
  await expect(upload).rejects.toMatchObject({ name: "AbortError" });
});

it("rejects browser timeouts as TimeoutError", async () => {
  const upload = uploadWithProgress(signedUrl, body, body.type, vi.fn());
  request().ontimeout?.();
  await expect(upload).rejects.toMatchObject({ name: "TimeoutError" });
});

it("preserves synchronous transport failures and removes the signal listener", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const reason = new TypeError("The transport could not send the request.");
  FakeXMLHttpRequest.sendFailure = reason;
  await expect(
    uploadWithProgress(signedUrl, body, body.type, vi.fn(), controller.signal),
  ).rejects.toBe(reason);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(request().upload.onprogress).toBeNull();
  controller.abort();
  expect(request().abort).not.toHaveBeenCalled();
});

it("does not send when the initial progress callback cancels the upload", async () => {
  const controller = new AbortController();
  const reason = new Error("The upload was cancelled.");
  const upload = uploadWithProgress(
    signedUrl,
    body,
    body.type,
    () => controller.abort(reason),
    controller.signal,
  );
  await expect(upload).rejects.toBe(reason);
  expect(request().send).not.toHaveBeenCalled();
});
