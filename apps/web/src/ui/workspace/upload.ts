import { WorkspaceRequestError } from "./api";

/** The transport cause of the last failed attempt before an upload was interrupted. */
export type UploadFailureCause = "timeout" | "rate_limited" | "offline";

export class UploadInterruptedError extends Error {
  constructor(
    message: string,
    /** Null when the last failure was not a timeout, a rate limit or a lost connection. */
    readonly lastCause: UploadFailureCause | null = null,
  ) {
    super(message);
    this.name = "UploadInterruptedError";
  }
}

/** Which part of a file a transfer is sending; numbers only, never names or locations. */
export interface UploadPartDiagnostic {
  part: number;
  /** Bytes of this part the current attempt had sent. */
  sentBytes: () => number;
}

export interface UploadRecovery {
  attempts?: number;
  signal?: AbortSignal;
  /**
   * How long one request attempt may go without progress before it times out (default 90 s).
   * Each transfer progress reported through `extendUploadDeadline` starts the window again.
   */
  timeoutMs?: number;
  onRetry?: (attempt: number) => void;
  onOffline?: () => void;
  /** Part facts for the in-memory interruption diagnostics. */
  diagnostic?: UploadPartDiagnostic;
}

/**
 * One interrupted upload, kept only in this tab's memory (PRD-PRIV-06): the error kind, the part
 * number and the bytes sent. Never a file name, content, user identifier or URL.
 */
export interface UploadFailureDiagnostic {
  kind: UploadFailureCause | "unknown";
  part: number | null;
  sentBytes: number | null;
}

const DIAGNOSTIC_LIMIT = 50;
const diagnostics: UploadFailureDiagnostic[] = [];
let interruptions = 0;

/** The interruption counter of this tab and its most recent records. Nothing is sent or stored. */
export function uploadFailureDiagnostics(): {
  total: number;
  recent: UploadFailureDiagnostic[];
} {
  return { total: interruptions, recent: diagnostics.map((entry) => ({ ...entry })) };
}

export function resetUploadFailureDiagnostics() {
  interruptions = 0;
  diagnostics.length = 0;
}

function statusCause(status: number | undefined): UploadFailureCause | null {
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  return null;
}

/** Classifies a failed upload attempt; an earlier interruption keeps the cause it carries. */
export function uploadFailureCause(failure: unknown): UploadFailureCause | null {
  if (failure instanceof UploadInterruptedError) return failure.lastCause;
  if (failure instanceof DOMException && failure.name === "TimeoutError") return "timeout";
  if (failure instanceof TypeError) return "offline";
  if (failure instanceof WorkspaceRequestError)
    return failure.code === "rate_limited" ? "rate_limited" : statusCause(failure.status);
  return null;
}

/**
 * The interruption raised for `failure`. A nested interruption was already counted where it was
 * raised, so it is not counted again.
 */
function interruption(
  message: string,
  cause: UploadFailureCause | null,
  failure: unknown,
  diagnostic?: UploadPartDiagnostic,
): UploadInterruptedError {
  if (!(failure instanceof UploadInterruptedError)) {
    interruptions++;
    diagnostics.push({
      kind: cause ?? "unknown",
      part: diagnostic?.part ?? null,
      sentBytes: diagnostic ? Math.max(0, Math.floor(diagnostic.sentBytes())) : null,
    });
    if (diagnostics.length > DIAGNOSTIC_LIMIT) diagnostics.shift();
  }
  return new UploadInterruptedError(message, cause);
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

/** Restarts the no-progress deadline of each request attempt, keyed by the attempt's signal. */
const deadlineRestarts = new WeakMap<AbortSignal, () => void>();

/**
 * Reports transfer progress for the request attempt that owns `signal`, so a slow but progressing
 * transfer is not timed out (AUD-1 F-1). A signal that no attempt owns is ignored.
 */
export function extendUploadDeadline(signal?: AbortSignal) {
  if (signal) deadlineRestarts.get(signal)?.();
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
  const idleMs = options.timeoutMs ?? 90_000;
  const expire = () =>
    controller.abort(new DOMException("The upload request timed out.", "TimeoutError"));
  // A request without progress, such as a signed link GET or a stalled PUT, keeps this bound.
  let timer = setTimeout(expire, idleMs);
  deadlineRestarts.set(controller.signal, () => {
    if (controller.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(expire, idleMs);
  });
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    // The race also bounds a stalled response reader or a request that ignores abort.
    return await Promise.race([request(controller.signal), cancelled]);
  } finally {
    deadlineRestarts.delete(controller.signal);
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
      if (attempt === attempts)
        throw interruption(
          failureMessage,
          uploadFailureCause(failure),
          failure,
          options.diagnostic,
        );
      options.onRetry?.(attempt + 1);
      await delay(1000 * 2 ** (attempt - 1), options.signal);
    }
  }
  throw interruption(failureMessage, null, undefined, options.diagnostic);
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
  // The cause of the latest failed write; a confirmation failure replaces it.
  let lastCause: UploadFailureCause | null = null;
  const confirm = async () => {
    let failed: unknown;
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
      failed = failure;
      lastCause = uploadFailureCause(failure);
    }
    // Unknown verification must never trigger another PUT.
    throw interruption(failureMessage, lastCause, failed, recovery.diagnostic);
  };
  if (recovery.confirmBeforeWrite && (await confirm())) return;
  const attempts = recovery.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status: number | undefined;
    try {
      const response = await requestWithDeadline(write, recovery);
      if (response.ok && !recovery.confirmSuccess) return;
      status = response.status;
      lastCause = response.ok ? null : statusCause(status);
    } catch (failure) {
      aborted(recovery.signal);
      if (options && failure instanceof WorkspaceRequestError && !isRetryableUploadFailure(failure))
        throw failure;
      if (failure instanceof UploadInterruptedError) throw failure;
      // A lost response leaves the upload outcome unknown, like a rejected repeated PUT.
      lastCause = uploadFailureCause(failure);
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
    if (attempt === attempts)
      throw interruption(failureMessage, lastCause, undefined, recovery.diagnostic);
    recovery.onRetry?.(attempt + 1);
    await delay(1000 * 2 ** (attempt - 1), recovery.signal);
  }
}
