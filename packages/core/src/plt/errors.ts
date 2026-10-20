import { z } from "zod";

/** Stable error codes and their fixed HTTP statuses (FR-PLT-003, docs/API_CONTRACTS.md). */
export const ERROR_STATUS = {
  unauthenticated: 401,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  idempotency_mismatch: 422,
  rate_limited: 429,
  quota_insufficient: 403,
  cross_site: 403,
  payload_too_large: 413,
  unsupported_media: 415,
  internal: 500,
  /** A service the request needs (file store, verifier) is not connected: retry later. */
  service_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

// Plain English for A2–B1 readers; screens may show their own copy for a code.
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Please sign in to continue.",
  not_found: "We couldn't find that.",
  validation_failed: "Some information is missing or not valid.",
  conflict: "This is already being processed. Please wait a moment.",
  idempotency_mismatch: "This request is different from an earlier one with the same key.",
  rate_limited: "Too many tries. Please wait and try again.",
  quota_insufficient: "You don't have enough allowance for this.",
  cross_site: "This request didn't come from Recalino.",
  payload_too_large: "This file is too large.",
  unsupported_media: "This type of file isn't supported.",
  internal: "Something went wrong. Please try again.",
  service_unavailable: "Recalino is not available right now. Please try again in a moment.",
};

/** Security events the request layer records for an error; never sent to the client. */
export type SecuritySignal = "ownership_denied" | "job_tampered" | "auth_failures";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
  securitySignal?: SecuritySignal;
  /** An identifier-like cause for the server log, e.g. "storage_adapter_missing"; never sent. */
  reason?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string>;
  readonly securitySignal: SecuritySignal | undefined;
  readonly reason: string | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(DEFAULT_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.headers = options.headers ?? {};
    this.securitySignal = options.securitySignal;
    this.reason = options.reason;
  }
}

/** Machine-readable problems per field, e.g. { title: ["too_big"] }. Never echoes input values. */
export type FieldProblems = Record<string, string[]>;

export const errors = {
  unauthenticated: () => new AppError("unauthenticated"),
  /** A sign-in that failed at Google or Supabase, e.g. a forged or replayed code (FR-ACC-002). */
  signInFailed: () => new AppError("unauthenticated", { securitySignal: "auth_failures" }),
  /** A state-changing request sent from another site (cookie sessions, M3). */
  crossSite: () => new AppError("cross_site"),
  notFound: () => new AppError("not_found"),
  /** Another user's resource: answered exactly like a missing one, but recorded (FR-PLT-002). */
  ownershipDenied: () => new AppError("not_found", { securitySignal: "ownership_denied" }),
  validationFailed: (fields: FieldProblems) =>
    new AppError("validation_failed", { details: { fields } }),
  /** With fields, the stable reason a client can name, e.g. { session: ["capture_in_progress"] }. */
  conflict: (fields?: FieldProblems) =>
    new AppError("conflict", fields ? { details: { fields } } : {}),
  idempotencyMismatch: () => new AppError("idempotency_mismatch"),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError("rate_limited", { headers: { "Retry-After": String(retryAfterSeconds) } }),
  quotaInsufficient: (details?: Record<string, unknown>) =>
    new AppError("quota_insufficient", details ? { details } : {}),
  payloadTooLarge: () => new AppError("payload_too_large"),
  unsupportedMedia: () => new AppError("unsupported_media"),
  /**
   * A service this request depends on is not connected (D71, 2026-10-13): 503 with the same
   * stable field reason as before, so clients retry it as a service failure, not as their input.
   */
  serviceUnavailable: (fields: FieldProblems) =>
    new AppError("service_unavailable", { details: { fields } }),
  /**
   * PERF-05: the file store did not answer in time. A temporary service failure, so the job
   * runner schedules a retry and an API client may try again; the reason reaches the log.
   */
  storageTimeout: () =>
    new AppError("service_unavailable", {
      reason: "storage_timeout",
      details: { fields: { storage: ["storage_timeout"] } },
    }),
  /**
   * Server configuration the request needs is missing. The client cannot fix it, so it is an
   * internal error; the reason reaches only the server log (FR-PLT-003, FR-PLT-007).
   */
  configurationMissing: (reason: string) => new AppError("internal", { reason }),
};

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export interface ErrorResponse {
  status: number;
  headers: Record<string, string>;
  body: ErrorEnvelope;
  code: ErrorCode;
}

/**
 * Maps any thrown value to the standard envelope. Unknown errors become `internal` with only
 * the request id: no message, stack, SQL or internal path reaches the client (FR-PLT-003).
 */
export function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  if (error instanceof AppError) {
    const body: ErrorEnvelope = {
      error: { code: error.code, message: error.message, request_id: requestId },
    };
    if (error.details) body.error.details = error.details;
    return { status: error.status, headers: error.headers, body, code: error.code };
  }
  if (error instanceof z.ZodError) {
    const fields: FieldProblems = {};
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body";
      fields[path] ??= [];
      fields[path].push(issue.code);
    }
    return toErrorResponse(errors.validationFailed(fields), requestId);
  }
  return toErrorResponse(new AppError("internal"), requestId);
}
