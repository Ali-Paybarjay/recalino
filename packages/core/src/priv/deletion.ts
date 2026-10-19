import { z } from "zod";
import { lockAccount, lockAccountForCleanup, purgeAccountProfile, tombstoneAccount } from "../acc";
import type { Database, Tx } from "../db";
import {
  cleanupAccountOrg,
  cleanupSessionOrg,
  deleteSessionInTransaction,
  listSessions,
} from "../org";
import {
  AppError,
  anonymiseAuditActors,
  assertOwner,
  enqueueJob,
  errors,
  hasJobStep,
  type JobDefinition,
  type LearnerContext,
  ownerStorageAccessExpiry,
  readPltSettings,
  redactUserIdempotencyResponses,
} from "../plt";
import { cancelSessionRuns, markSourceProcessingForCleanup } from "../proc";

export interface PrivacyHook {
  module: string;
  tombstoneSession(tx: Tx, ctx: LearnerContext, sessionId: string, now: Date): Promise<void>;
  tombstoneAccount?(tx: Tx, ctx: LearnerContext, now: Date): Promise<void>;
  tombstoneSource?(
    tx: Tx,
    ctx: LearnerContext,
    sourceId: string,
    sessionIds: readonly string[],
    now: Date,
  ): Promise<void>;
  cleanupSession(db: Database, ctx: LearnerContext, sessionId: string, now: Date): Promise<void>;
  cleanupAccount(db: Database, ctx: LearnerContext, now: Date): Promise<void>;
  cleanupSource?(
    db: Database,
    ctx: LearnerContext,
    sourceId: string,
    sessionIds: readonly string[],
    now: Date,
  ): Promise<void>;
}
export interface AuthenticationDeletion {
  revokeSessions(userId: string): Promise<void>;
  /** Remove identity under the auth contract without erasing financial audit rows. */
  deleteIdentity(userId: string): Promise<void>;
}
export interface DeletionJournalEntry {
  requestId: string;
  userId: string;
  kind: PrivacyDeletionRequest["kind"];
  subjectId: string;
  relatedSessions: readonly string[];
  requestedAt: string;
}
export interface DeletionJournal {
  /** External append must be idempotent by requestId; encrypted metadata contains no class text. */
  record(entry: DeletionJournalEntry): Promise<void>;
}
export interface PrivacyDependencies {
  hooks: readonly PrivacyHook[];
  authentication?: AuthenticationDeletion;
  deletionJournal?: DeletionJournal;
}
/** API acknowledgement waits for this external durable receipt after the tombstone commits. */
export async function persistDeletionJournal(
  db: Database,
  ctx: LearnerContext,
  requestId: string,
  dependencies: PrivacyDependencies,
): Promise<void> {
  const request = await getPrivacyDeletionRequest(db, ctx, requestId);
  const journal = dependencies.deletionJournal;
  if (!journal) throw errors.configurationMissing("deletion_journal_adapter_missing");
  const row = await db
    .selectFrom("priv.deletion_request")
    .select("related_sessions")
    .where("id", "=", requestId)
    .where("user_id", "=", ctx.userId)
    .executeTakeFirstOrThrow();
  await journal.record({
    requestId: request.id,
    userId: ctx.userId,
    kind: request.kind,
    subjectId: request.subjectId,
    relatedSessions: row.related_sessions,
    requestedAt: request.requestedAt,
  });
}
export async function findPrivacyDeletionRequest(
  db: Database,
  ctx: LearnerContext,
  kind: PrivacyDeletionRequest["kind"],
  subjectId: string,
): Promise<PrivacyDeletionRequest | null> {
  z.enum(["session", "account", "source"]).parse(kind);
  z.uuid().parse(subjectId);
  const row = await db
    .selectFrom("priv.deletion_request")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("kind", "=", kind)
    .where("subject_id", "=", subjectId)
    .executeTakeFirst();
  return row ? view(row) : null;
}
export interface PrivacyDeletionRequest {
  id: string;
  kind: "session" | "account" | "source";
  subjectId: string;
  state: "pending" | "completed" | "needs_operator";
  requestedAt: string;
  completedAt: string | null;
  lastError: string | null;
}
type Row = {
  id: string;
  user_id: string;
  kind: string;
  subject_id: string;
  state: string;
  requested_at: Date;
  completed_at: Date | null;
  last_error: string | null;
};
function view(row: Row): PrivacyDeletionRequest {
  return {
    id: row.id,
    kind: row.kind as PrivacyDeletionRequest["kind"],
    subjectId: row.subject_id,
    state: row.state as PrivacyDeletionRequest["state"],
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}
export async function getPrivacyDeletionRequest(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<PrivacyDeletionRequest> {
  const row = await db
    .selectFrom("priv.deletion_request")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  return view(row);
}
const payloadSchema = z.strictObject({ requestId: z.uuid(), userId: z.uuid() });
const key = z.string().min(8).max(200);
function validateHooks(dependencies: PrivacyDependencies): Map<string, PrivacyHook> {
  const modules = new Map(dependencies.hooks.map((hook) => [hook.module, hook]));
  if (
    !modules.size ||
    modules.size !== dependencies.hooks.length ||
    dependencies.hooks.some(
      (hook) =>
        !/^[a-z][a-z0-9_]{0,30}$/.test(hook.module) ||
        typeof hook.cleanupAccount !== "function" ||
        (hook.tombstoneSource && !hook.cleanupSource),
    )
  )
    throw errors.validationFailed({ cleanup: ["invalid_hook_registry"] });
  return modules;
}
async function register(
  tx: Tx,
  ctx: LearnerContext,
  kind: PrivacyDeletionRequest["kind"],
  subjectId: string,
  operationKey: string,
  dependencies: PrivacyDependencies,
  now: Date,
  relatedSessions: readonly string[] = [],
): Promise<PrivacyDeletionRequest> {
  const row = await tx
    .insertInto("priv.deletion_request")
    .values({
      user_id: ctx.userId,
      kind,
      subject_id: subjectId,
      operation_key: operationKey,
      modules: [...validateHooks(dependencies).keys()],
      related_sessions: [...relatedSessions],
      requested_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const jobId = await enqueueJob(tx, privacyCleanupJob(dependencies), {
    payload: { requestId: row.id, userId: ctx.userId },
    singletonKey: row.id,
    now,
    runAt: await ownerStorageAccessExpiry(tx, ctx.userId, now),
    defaults: readPltSettings().jobs,
  });
  await tx
    .updateTable("priv.deletion_request")
    .set({ job_id: jobId })
    .where("id", "=", row.id)
    .execute();
  return view(row);
}
async function tombstoneSession(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  dependencies: PrivacyDependencies,
  now: Date,
) {
  await deleteSessionInTransaction(tx, ctx, sessionId, {
    now,
    onDelete: async (connection, id) => {
      await cancelSessionRuns(connection, ctx, id, now);
      await redactUserIdempotencyResponses(connection, ctx.userId);
      for (const hook of dependencies.hooks) await hook.tombstoneSession(connection, ctx, id, now);
    },
  });
}
export async function requestSessionDeletion(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  operationKey: string,
  dependencies: PrivacyDependencies,
  now = new Date(),
): Promise<PrivacyDeletionRequest> {
  z.uuid().parse(sessionId);
  key.parse(operationKey);
  validateHooks(dependencies);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await tx
      .selectFrom("priv.deletion_request")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", operationKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.kind !== "session" || previous.subject_id !== sessionId)
        throw errors.idempotencyMismatch();
      return view(previous);
    }
    await tombstoneSession(tx, ctx, sessionId, dependencies, now);
    const existing = await tx
      .selectFrom("priv.deletion_request")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("kind", "=", "session")
      .where("subject_id", "=", sessionId)
      .executeTakeFirst();
    return existing
      ? view(existing)
      : register(tx, ctx, "session", sessionId, operationKey, dependencies, now);
  });
}
/** One atomic tombstone hides the account and classes before asynchronous physical cleanup. */
export async function requestAccountDeletion(
  db: Database,
  ctx: LearnerContext,
  operationKey: string,
  dependencies: PrivacyDependencies,
  now = new Date(),
): Promise<PrivacyDeletionRequest> {
  key.parse(operationKey);
  validateHooks(dependencies);
  return db.transaction().execute(async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const previous = await tx
      .selectFrom("priv.deletion_request")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("kind", "=", "account")
      .executeTakeFirst();
    if (previous) return view(previous);
    await lockAccount(tx, ctx.userId);
    const mismatch = await tx
      .selectFrom("priv.deletion_request")
      .select("id")
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", operationKey)
      .executeTakeFirst();
    if (mismatch) throw errors.idempotencyMismatch();
    for (;;) {
      const { items } = await listSessions(tx, ctx, { limit: 100 });
      if (!items.length) break;
      for (const session of items) await tombstoneSession(tx, ctx, session.id, dependencies, now);
    }
    for (const hook of dependencies.hooks) await hook.tombstoneAccount?.(tx, ctx, now);
    await redactUserIdempotencyResponses(tx, ctx.userId);
    await tombstoneAccount(tx, ctx, now);
    return register(tx, ctx, "account", ctx.userId, operationKey, dependencies, now);
  });
}
/** SRC calls this inside full-delete after taking the shared account lock. */
export async function coordinateSourceDeletion(
  tx: Tx,
  ctx: LearnerContext,
  sourceId: string,
  sessionIds: readonly string[],
  dependencies: PrivacyDependencies,
  now = new Date(),
): Promise<PrivacyDeletionRequest> {
  validateHooks(dependencies);
  const existing = await tx
    .selectFrom("priv.deletion_request")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("kind", "=", "source")
    .where("subject_id", "=", sourceId)
    .executeTakeFirst();
  if (existing) return view(existing);
  await redactUserIdempotencyResponses(tx, ctx.userId);
  for (const sessionId of [...new Set(sessionIds)].sort())
    await cancelSessionRuns(tx, ctx, sessionId, now);
  await markSourceProcessingForCleanup(tx, ctx, sourceId, sessionIds, now);
  for (const hook of dependencies.hooks)
    await hook.tombstoneSource?.(tx, ctx, sourceId, sessionIds, now);
  return register(
    tx,
    ctx,
    "source",
    sourceId,
    `source-delete:${sourceId}`,
    dependencies,
    now,
    sessionIds,
  );
}
/** Checkpoints keep identifiers and module names. Captured modules must remain registered. */
export function privacyCleanupJob(
  dependencies: PrivacyDependencies,
): JobDefinition<z.infer<typeof payloadSchema>> {
  const modules = validateHooks(dependencies);
  return {
    kind: "priv.cleanup",
    version: 1,
    payload: payloadSchema,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      const request = await getPrivacyDeletionRequest(job.db, ctx, payload.requestId);
      if (request.state === "completed") return;
      try {
        const record = await job.db
          .selectFrom("priv.deletion_request")
          .select(["modules", "related_sessions"])
          .where("id", "=", request.id)
          .where("user_id", "=", ctx.userId)
          .executeTakeFirstOrThrow();
        if (!record.modules.length || record.modules.some((module) => !modules.has(module)))
          throw errors.validationFailed({ cleanup: ["captured_module_missing"] });
        const journal = dependencies.deletionJournal;
        if (!journal && ["production", "preview"].includes(process.env.VERCEL_ENV ?? ""))
          throw errors.configurationMissing("deletion_journal_adapter_missing");
        if (journal && !(await hasJobStep(job.db, job.job.id, "deletion_journal"))) {
          // The adapter commits its own durable registration; do not hold the job transaction
          // while it acquires a connection. An interrupted append is safe to repeat by requestId.
          await journal.record({
            requestId: request.id,
            userId: ctx.userId,
            kind: request.kind,
            subjectId: request.subjectId,
            relatedSessions: record.related_sessions,
            requestedAt: request.requestedAt,
          });
          await job.step("deletion_journal", async () => {});
        }
        const authentication = dependencies.authentication;
        if (request.kind === "account") {
          if (!authentication)
            throw errors.validationFailed({ cleanup: ["authentication_adapter_missing"] });
          await job.step("revoke_auth", async () => authentication.revokeSessions(ctx.userId));
        }
        for (const module of record.modules) {
          const hook = modules.get(module);
          if (!hook) throw errors.validationFailed({ cleanup: ["captured_module_missing"] });
          const done = await job.db
            .selectFrom("priv.cleanup_step")
            .select("module")
            .where("request_id", "=", request.id)
            .where("module", "=", module)
            .executeTakeFirst();
          if (done) continue;
          if (request.kind === "session")
            await hook.cleanupSession(job.db, ctx, request.subjectId, job.now());
          else if (request.kind === "account") await hook.cleanupAccount(job.db, ctx, job.now());
          else
            await hook.cleanupSource?.(
              job.db,
              ctx,
              request.subjectId,
              record.related_sessions,
              job.now(),
            );
          await job.db
            .insertInto("priv.cleanup_step")
            .values({ request_id: request.id, module, completed_at: job.now() })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
        // PRD-DEL-01: finalize ORG even for older requests whose captured registry predates it.
        if (request.kind === "session")
          await cleanupSessionOrg(job.db, ctx, request.subjectId, job.now());
        else if (request.kind === "account") {
          if (request.subjectId !== ctx.userId) throw errors.notFound();
          await cleanupAccountOrg(job.db, ctx, job.now());
        }
        if (request.kind === "account" && authentication) {
          await job.db.transaction().execute((tx) => purgeAccountProfile(tx, ctx));
          await job.step("delete_auth", async () => authentication.deleteIdentity(ctx.userId));
          // SEC-07 (D95): the audit trail keeps what happened, not who the deleted account was.
          await anonymiseAuditActors(job.db, [ctx.userId]);
        }
        await job.db
          .updateTable("priv.deletion_request")
          .set({ state: "completed", completed_at: job.now(), last_error: null })
          .where("id", "=", request.id)
          .execute();
      } catch (error) {
        await job.db
          .updateTable("priv.deletion_request")
          .set({
            state: "needs_operator",
            last_error: error instanceof AppError ? error.code : "cleanup_failed",
          })
          .where("id", "=", request.id)
          .execute();
        throw error;
      }
    },
  };
}
