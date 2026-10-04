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
export {
  assertExportSize,
  type ExportArtifact,
  type ExportMedia,
  type ExportMediaBytes,
  type ExportSettings,
  escapeExportHtml,
  exportSettingsSchema,
} from "./export";
export { canonicalJson, hmacSha256Hex, sha256Hex } from "./hash";
export {
  type IdempotentRequest,
  type IdempotentResult,
  isValidIdempotencyKey,
  purgeExpiredIdempotencyKeys,
  redactUserIdempotencyResponses,
  runIdempotent,
  type StoredResponse,
} from "./idempotency";
export {
  type ClaimedJob,
  cancelJob,
  claimJobs,
  completeJob,
  type EnqueueRequest,
  enqueueJob,
  ensurePeriodicJob,
  failJob,
  hasJobStep,
  JobCancelled,
  type JobContext,
  type JobDefinition,
  type JobOptions,
  type JobState,
  jobState,
  purgeFinishedJobs,
  type RunOptions,
  type RunSummary,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "./jobs";
export {
  createLogger,
  formatLogLine,
  type Logger,
  type LogLevel,
  type LogSink,
  type LogValue,
} from "./log";
export {
  type EmptyPayload,
  emptyPayload,
  type PeriodicJob,
  pltPeriodicJobs,
  storagePeriodicJobs,
} from "./maintenance";
export { platformOperationalSummary } from "./operations";
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
export { spikeCleanup, spikeJobReport, spikeObjects } from "./spike";
export {
  type ConfirmResult,
  composeOwnedObjects,
  confirmObject,
  createObject,
  deleteObject,
  issueReadLink,
  issueWriteLink,
  type LinkRequest,
  type NewObject,
  type ObjectState,
  type ObjectStore,
  ownedObjectMetadata,
  ownerStorageAccessExpiry,
  type ReconcileSummary,
  type Retention,
  readOwnedObject,
  reconcileStorage,
  type StorageActor,
  type StoredObjectInfo,
  writeOwnedObject,
} from "./storage";
export { MemoryObjectStore } from "./storage-memory";
export { readSystemJournalObjects } from "./system-journals";
export { isValidTimeZone, resolveTimeZone, studyDay } from "./time";
