// Public API of the PLT module (platform and base protection). Other modules import only this file.
export { isAdminOwner } from "./admin-access";
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
export { type PlatformHealth, pingDatabase, readPlatformHealth } from "./health";
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
  jobStates,
  latestJobStateForPayload,
  purgeFinishedJobs,
  type RunOptions,
  type RunSummary,
  renewJobLease,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "./jobs";
export {
  causeCode,
  createLogger,
  errorLocation,
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
export {
  type BrowserPushSender,
  type BrowserPushSubscription,
  browserPushDeliveryJob,
  browserPushSubscriptionSchema,
  clearAccountNotifications,
  clearSessionNotifications,
  isBrowserPushEndpoint,
  type LearnerNotification,
  learnerNotifications,
  markNotificationsRead,
  type NotificationKind,
  ownsBrowserPushSubscription,
  recordLearnerNotification,
  removeBrowserPushSubscription,
  saveBrowserPushSubscription,
  webPushQueue,
} from "./notifications";
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
  compareSchemaVersions,
  createSchemaGuard,
  readAppliedSchemaVersion,
  type SchemaCheck,
  type SchemaGuard,
  type SchemaGuardOptions,
  type SchemaState,
} from "./schema-version";
export {
  type AuditInput,
  latestSubjectAudit,
  recordAudit,
  recordAuditOnce,
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
