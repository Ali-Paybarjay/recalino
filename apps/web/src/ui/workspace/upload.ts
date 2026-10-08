import { WorkspaceRequestError } from "./api";

export class UploadInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadInterruptedError";
  }
}

export interface UploadRecovery {
  attempts?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onRetry?: (attempt: number) => void;
  onOffline?: () => void;
}

export function isRetryableUploadFailure(failure: unknown): boolean {
  return (
    failure instanceof UploadInterruptedError ||
    failure instanceof TypeError ||
    (failure instanceof DOMException && failure.name === "TimeoutError") ||
    (failure instanceof WorkspaceRequestError &&
      (failure.code === "internal" ||
        failure.code === "rate_limited" ||
        failure.status === 408 ||
        failure.status === 429 ||
        (failure.status !== undefined && failure.status >= 500)))
  );
}

function aborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function waitForConnection(options: UploadRecovery) {
  aborted(options.signal);
  if (typeof window === "undefined" || navigator.onLine !== false) return;
  options.onOffline?.();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("online", connected);
      options.signal?.removeEventListener("abort", cancel);
    };
    const connected = () => {
      if (navigator.onLine === false) return;
      cleanup();
      resolve();
    };
    const cancel = () => {
      cleanup();
      reject(options.signal?.reason);
    };
    window.addEventListener("online", connected);
    options.signal?.addEventListener("abort", cancel, { once: true });
    connected();
  });
}

async function requestWithDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: UploadRecovery,
): Promise<T> {
  await waitForConnection(options);
  aborted(options.signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("The upload request timed out.", "TimeoutError")),
    options.timeoutMs ?? 90_000,
  );
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    // The race also bounds a stalled response reader or a request that ignores abort.
    return await Promise.race([request(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Only use for reads or mutations protected by a stable idempotency key. */
export async function retryUploadRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  failureMessage: string,
  options: UploadRecovery,
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestWithDeadline(request, options);
    } catch (failure) {
      aborted(options.signal);
      if (!isRetryableUploadFailure(failure)) throw failure;
      if (attempt === attempts) throw new UploadInterruptedError(failureMessage);
      options.onRetry?.(attempt + 1);
      await delay(1000 * 2 ** (attempt - 1), options.signal);
    }
  }
  throw new UploadInterruptedError(failureMessage);
}

interface PartRecovery extends UploadRecovery {
  /** Check legacy/unacknowledged writes when resuming an existing upload. */
  confirmBeforeWrite?: boolean;
  /** Persist each successful part so a later resume skips it. */
  confirmSuccess?: boolean;
}

/** A failed PUT can still have stored the bytes. Only the server can verify them safely. */
export async function uploadWithConfirmation(
  write: (
    signal?: AbortSignal,
  ) => Promise<Pick<Response, "ok"> & Partial<Pick<Response, "status">>>,
  confirmStored: (signal?: AbortSignal) => Promise<unknown>,
  failureMessage: string,
  options?: PartRecovery,
): Promise<void> {
  const recovery = options ?? { attempts: 1 };
  const confirm = async () => {
    try {
      const confirmation = await retryUploadRequest(confirmStored, failureMessage, recovery);
      if (
        confirmation !== null &&
        typeof confirmation === "object" &&
        "confirmed" in confirmation
      ) {
        if (confirmation.confirmed === true) return true;
        if (confirmation.confirmed === false) return false;
      }
    } catch (failure) {
      aborted(recovery.signal);
      // Existing source/photo callers keep their original recovery copy. Audio
      // opts in to preserving an authoritative validation or authorization error.
      if (options && !isRetryableUploadFailure(failure)) throw failure;
    }
    // Unknown verification must never trigger another PUT.
    throw new UploadInterruptedError(failureMessage);
  };
  if (recovery.confirmBeforeWrite && (await confirm())) return;
  const attempts = recovery.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status: number | undefined;
    try {
      const response = await requestWithDeadline(write, recovery);
      if (response.ok && !recovery.confirmSuccess) return;
      status = response.status;
    } catch (failure) {
      aborted(recovery.signal);
      if (options && failure instanceof WorkspaceRequestError && !isRetryableUploadFailure(failure))
        throw failure;
      if (failure instanceof UploadInterruptedError) throw failure;
      // A lost response leaves the upload outcome unknown, like a rejected repeated PUT.
    }
    if (await confirm()) return;
    if (status === 413 || status === 415)
      throw new WorkspaceRequestError(
        status === 413
          ? "The audio part is too large to upload."
          : "This audio format cannot be uploaded.",
        status === 413 ? "payload_too_large" : "unsupported_media",
        undefined,
        status,
      );
    if (attempt === attempts) throw new UploadInterruptedError(failureMessage);
    recovery.onRetry?.(attempt + 1);
    await delay(1000 * 2 ** (attempt - 1), recovery.signal);
  }
}
