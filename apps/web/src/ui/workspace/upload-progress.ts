import { extendUploadDeadline } from "./upload";

/**
 * Reports transmitted bytes; callers still confirm the stored file before accepting it. Each new
 * byte sent restarts the no-progress deadline of the upload attempt that owns `signal`.
 */
export async function uploadWithProgress(
  signedUrl: string,
  body: Blob,
  contentType: string,
  onProgress: (sentBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let furthest = 0;
    const cleanup = () => {
      request.upload.onprogress = null;
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      request.ontimeout = null;
      signal?.removeEventListener("abort", cancel);
    };
    const fail = (failure: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(failure);
    };
    const cancel = () => {
      fail(signal?.reason ?? new DOMException("The upload was aborted.", "AbortError"));
      request.abort();
    };

    // Register before open/send so browsers deliver upload events reliably.
    request.upload.onprogress = (event) => {
      const loaded = Math.min(body.size, Math.max(0, event.loaded));
      // Only bytes beyond the furthest point reached count as progress for the deadline.
      if (loaded > furthest) {
        furthest = loaded;
        extendUploadDeadline(signal);
      }
      onProgress(loaded, body.size);
    };
    request.onload = () => {
      const result = { ok: request.status >= 200 && request.status < 300, status: request.status };
      try {
        if (result.ok) onProgress(body.size, body.size);
        settled = true;
        cleanup();
        resolve(result);
      } catch (failure) {
        fail(failure);
      }
    };
    request.onerror = () => fail(new TypeError("The upload connection failed."));
    request.onabort = () =>
      fail(signal?.reason ?? new DOMException("The upload was aborted.", "AbortError"));
    request.ontimeout = () =>
      fail(new DOMException("The upload request timed out.", "TimeoutError"));

    try {
      request.open("PUT", signedUrl);
      request.setRequestHeader("Content-Type", contentType);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      onProgress(0, body.size);
      if (!settled) request.send(body);
    } catch (failure) {
      fail(failure);
    }
  });
}
