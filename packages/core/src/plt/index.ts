// Public API of the PLT module (platform and base protection). Other modules import only this file.
export {
  AppError,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorEnvelope,
  type ErrorResponse,
  errorEnvelopeSchema,
  errors,
  type FieldProblems,
  type SecuritySignal,
  toErrorResponse,
} from "./errors";
export { canonicalJson, hmacSha256Hex, sha256Hex } from "./hash";
export {
  type IdempotentRequest,
  type IdempotentResult,
  isValidIdempotencyKey,
  purgeExpiredIdempotencyKeys,
  runIdempotent,
  type StoredResponse,
} from "./idempotency";
export {
  createLogger,
  formatLogLine,
  type Logger,
  type LogLevel,
  type LogSink,
  type LogValue,
} from "./log";
export { assertOwner, type LearnerContext } from "./ownership";
export {
  checkRateLimit,
  hitRateLimit,
  purgeRateLimitBuckets,
  type RateLimitCheck,
  type RateLimitDecision,
  type RateLimitSubject,
  rateLimitBuckets,
} from "./rate-limit";
export {
  type AuditInput,
  recordAudit,
  recordSecurityEvent,
  type SecurityEventInput,
  type SecurityEventKind,
} from "./security";
export {
  DEFAULT_PLT_SETTINGS,
  type PltSettings,
  pltSettingsSchema,
  type RateLimitClass,
  type RateLimitRule,
  readPltSettings,
} from "./settings";
export { isValidTimeZone, resolveTimeZone, studyDay } from "./time";
