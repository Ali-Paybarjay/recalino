import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import {
  canonicalJson,
  createLogger,
  createObject,
  deleteObject,
  errors,
  type Logger,
  latestSubjectAudit,
  type ObjectStore,
  type PeriodicJob,
  readOwnedObject,
  recordAudit,
  sha256Hex,
  writeOwnedObject,
} from "../plt";
import { backupArchiveHeader, encryptBackupArchive } from "./backup-crypto";
import { maintainDeletionJournals } from "./deletion-journals";

export const backupSettingsSchema = z.strictObject({
  version: z.literal("1"),
  keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  maxEncryptedBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024 * 1024),
  timeoutSeconds: z.number().int().min(1).max(3600),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export type BackupOperator = { actorId: string; reason: string };

/**
 * OPS-01 (audit 2026-10-18). `keepReady` newest ready backups survive retention even past their
 * 30-day expiry, so a run of failed nightly backups never leaves no restorable copy; 0 restores
 * the strict 30-day lifecycle. `staleAfterHours` is the age of the newest ready backup that
 * raises the stale-backup alert. A deployment overrides either with RECALINO_BACKUP_RETENTION_JSON.
 */
export const backupRetentionSettingsSchema = z.strictObject({
  keepReady: z.int().min(0).max(30),
  staleAfterHours: z.int().min(1).max(720),
});
export type BackupRetentionSettings = z.infer<typeof backupRetentionSettingsSchema>;
export const DEFAULT_BACKUP_RETENTION: BackupRetentionSettings = {
  keepReady: 3,
  staleAfterHours: 30,
};
export function readBackupRetentionSettings(
  env: Record<string, string | undefined> = process.env,
): BackupRetentionSettings {
  const raw = env.RECALINO_BACKUP_RETENTION_JSON;
  if (!raw) return DEFAULT_BACKUP_RETENTION;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    throw new Error("Invalid RECALINO_BACKUP_RETENTION_JSON: not valid JSON");
  }
  const result = backupRetentionSettingsSchema.safeParse(
    overrides !== null && typeof overrides === "object" && !Array.isArray(overrides)
      ? { ...DEFAULT_BACKUP_RETENTION, ...overrides }
      : overrides,
  );
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid RECALINO_BACKUP_RETENTION_JSON: ${names.join(", ")}`);
  }
  return result.data;
}
export type BackupRetentionRow = { id: string; state: string; createdAt: Date; expiresAt: Date };
/** The newest `keepReady` ready backups, newest first; the order matches `created_at desc, id desc`. */
export function retainedReadyBackupIds(
  rows: readonly Pick<BackupRetentionRow, "id" | "state" | "createdAt">[],
  keepReady: number,
): string[] {
  return rows
    .filter((row) => row.state === "ready")
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .slice(0, keepReady)
    .map((row) => row.id);
}
/** Lapsed backups the retention job deletes now, in input order; the retained ready ones stay. */
export function backupsToExpire(
  rows: readonly BackupRetentionRow[],
  now: Date,
  keepReady: number,
): string[] {
  const retained = new Set(retainedReadyBackupIds(rows, keepReady));
  return rows
    .filter((row) => row.state !== "deleted" && row.expiresAt <= now && !retained.has(row.id))
    .map((row) => row.id);
}
/** Stale when the newest ready backup is older than the threshold, or when there is none. */
export function backupStaleness(
  newestReady: { id: string; createdAt: Date } | null,
  now: Date,
  staleAfterHours: number,
): { stale: false } | { stale: true; subjectId: string; ageMs: number | null } {
  if (!newestReady) return { stale: true, subjectId: "none", ageMs: null };
  const ageMs = now.getTime() - newestReady.createdAt.getTime();
  return ageMs > staleAfterHours * 3600 * 1000
    ? { stale: true, subjectId: newestReady.id, ageMs }
    : { stale: false };
}
async function liveBackupRows(tx: Tx) {
  return tx
    .selectFrom("ops.database_backup")
    .select([
      "id",
      "state",
      "object_id as objectId",
      "created_at as createdAt",
      "expires_at as expiresAt",
    ])
    .where("state", "<>", "deleted")
    .execute();
}
async function lockBackups(tx: Tx) {
  await sql`select pg_advisory_xact_lock(hashtextextended('ops:encrypted-backups', 1))`.execute(tx);
}
function operator(value: BackupOperator) {
  return z
    .strictObject({
      actorId: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(1).max(500),
    })
    .parse(value);
}
/** Trusted operator CLI only. Source dump may contain private content, but only ciphertext reaches Blob. */
export async function createDatabaseBackup(
  db: Database,
  store: ObjectStore,
  chunks: AsyncIterable<Uint8Array>,
  input: {
    settings: BackupSettings;
    key: Uint8Array;
    operationKey: string;
    operator: BackupOperator;
    now?: Date;
  },
) {
  const settings = backupSettingsSchema.parse(input.settings),
    actor = operator(input.operator);
  const operationKey = z.string().min(8).max(200).parse(input.operationKey),
    now = input.now ?? new Date();
  const requestHash = sha256Hex(canonicalJson(settings));
  const reserved = await db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const previous = await tx
      .selectFrom("ops.database_backup")
      .selectAll()
      .where("operation_key", "=", operationKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== requestHash) throw errors.idempotencyMismatch();
      return previous;
    }
    const row = await tx
      .insertInto("ops.database_backup")
      .values({
        operation_key: operationKey,
        request_hash: requestHash,
        key_id: settings.keyId,
        created_at: now,
        expires_at: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: actor.actorId,
      reason: actor.reason,
      action: "ops.backup_requested",
      subjectType: "database_backup",
      subjectId: row.id,
    });
    return row;
  });
  let stagedId: string | undefined;
  try {
    if (reserved.state === "ready") return getDatabaseBackupMetadata(db, reserved.id);
    if (reserved.state === "deleted" || reserved.expires_at <= now) throw errors.conflict();
    // The native snapshot is independently consistent. Avoid holding the backup/journal
    // lock while pg_dump reads, so an active deletion can durably journal without waiting.
    const ciphertext = await encryptBackupArchive(chunks, input.key, {
      keyId: settings.keyId,
      createdAt: reserved.created_at,
      maxBytes: settings.maxEncryptedBytes,
    });
    const destination = await db.transaction().execute(async (tx) => {
      await lockBackups(tx);
      const current = await tx
        .selectFrom("ops.database_backup")
        .selectAll()
        .where("id", "=", reserved.id)
        .executeTakeFirstOrThrow();
      if (current.state === "ready") return null;
      if (current.state === "deleted" || current.expires_at <= now) throw errors.conflict();
      if (current.object_id) await deleteObject(tx, store, "system", current.object_id, now);
      const target = await createObject(tx, {
        module: "ops",
        ownerUserId: null,
        retention: "durable",
        contentType: "application/octet-stream",
        sizeBytes: ciphertext.length,
        now,
      });
      await tx
        .updateTable("ops.database_backup")
        .set({ object_id: target.id })
        .where("id", "=", current.id)
        .execute();
      return target.id;
    });
    if (!destination) return getDatabaseBackupMetadata(db, reserved.id);
    await db.transaction().execute(async (tx) => {
      await lockBackups(tx);
      const current = await tx
        .selectFrom("ops.database_backup")
        .selectAll()
        .where("id", "=", reserved.id)
        .executeTakeFirstOrThrow();
      if (current.state === "ready") return;
      if (current.state === "deleted" || current.expires_at <= now) throw errors.conflict();
      if (current.object_id !== destination) throw errors.conflict();
      stagedId = destination;
      const objectId = await writeOwnedObject(tx, store, "system", {
        targetObjectId: destination,
        module: "ops",
        retention: "durable",
        contentType: "application/octet-stream",
        bytes: ciphertext,
        now,
      });
      await tx
        .updateTable("ops.database_backup")
        .set({
          state: "ready",
          object_id: objectId,
          encrypted_size_bytes: ciphertext.length,
          encrypted_sha256: sha256Hex(ciphertext),
          last_error: null,
        })
        .where("id", "=", current.id)
        .execute();
      await recordAudit(tx, {
        actorKind: "operator",
        actorId: actor.actorId,
        reason: actor.reason,
        action: "ops.backup_verified",
        subjectType: "database_backup",
        subjectId: current.id,
      });
    });
  } catch (failure) {
    if (stagedId) await deleteObject(db, store, "system", stagedId, now);
    await db
      .updateTable("ops.database_backup")
      .set({ state: "failed", last_error: "backup_failed" })
      .where("id", "=", reserved.id)
      .where("state", "in", ["pending", "failed"])
      .execute();
    throw failure;
  }
  return getDatabaseBackupMetadata(db, reserved.id);
}
/** No database rows, provider keys, passwords or private class payloads are returned. */
export async function getDatabaseBackupMetadata(db: Database | Tx, id: string) {
  z.uuid().parse(id);
  const row = await db
    .selectFrom("ops.database_backup")
    .select([
      "id",
      "state",
      "key_id as keyId",
      "created_at as createdAt",
      "expires_at as expiresAt",
      "encrypted_size_bytes as encryptedBytes",
      "restore_drilled_at as restoreDrilledAt",
    ])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  return {
    ...row,
    encryptedBytes: row.encryptedBytes === null ? null : Number(row.encryptedBytes),
  };
}
export async function readDatabaseBackup(
  db: Database,
  store: ObjectStore,
  id: string,
  actor: BackupOperator,
  now = new Date(),
  retention: BackupRetentionSettings = readBackupRetentionSettings(),
) {
  z.uuid().parse(id);
  const trusted = operator(actor);
  return db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const row = await tx
      .selectFrom("ops.database_backup")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (row?.state !== "ready" || !row.object_id) throw errors.notFound();
    // A lapsed copy stays readable only while retention keeps it as one of the newest ready.
    if (
      row.expires_at <= now &&
      !retainedReadyBackupIds(await liveBackupRows(tx), retention.keepReady).includes(row.id)
    )
      throw errors.notFound();
    const bytes = await readOwnedObject(tx, store, "system", row.object_id);
    const header = backupArchiveHeader(bytes);
    if (
      sha256Hex(bytes) !== row.encrypted_sha256 ||
      header.keyId !== row.key_id ||
      header.archiveFormat !== "postgres-custom"
    )
      throw new Error("backup_integrity_failed");
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: trusted.actorId,
      reason: trusted.reason,
      action: "ops.backup_restore_read",
      subjectType: "database_backup",
      subjectId: id,
    });
    return { keyId: row.key_id, ciphertext: bytes };
  });
}
const restoreMetadataSchema = z.strictObject({
  isolatedLocal: z.literal(true),
  tables: z.number().int().nonnegative(),
  constraintsValidated: z.literal(true),
  milliseconds: z.number().int().nonnegative(),
  publicServiceOpened: z.literal(false),
});
export async function recordBackupRestoreDrill(
  db: Database,
  id: string,
  metadata: unknown,
  actor: BackupOperator,
  now = new Date(),
) {
  const value = restoreMetadataSchema.parse(metadata),
    trusted = operator(actor);
  await db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const backup = await getDatabaseBackupMetadata(tx, id);
    if (backup.state !== "ready") throw errors.conflict();
    await tx
      .updateTable("ops.database_backup")
      .set({ restore_drilled_at: now, restore_metadata: JSON.stringify(value) })
      .where("id", "=", id)
      .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: trusted.actorId,
      reason: trusted.reason,
      action: "ops.backup_restore_drill",
      subjectType: "database_backup",
      subjectId: id,
    });
  });
}
export async function maintainDatabaseBackups(
  db: Database,
  store: ObjectStore,
  now = new Date(),
  retention: BackupRetentionSettings = readBackupRetentionSettings(),
) {
  return db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const rows = await liveBackupRows(tx);
    const expired = new Set(backupsToExpire(rows, now, retention.keepReady));
    for (const row of rows) {
      if (!expired.has(row.id)) continue;
      if (row.objectId) await deleteObject(tx, store, "system", row.objectId, now);
      await tx
        .updateTable("ops.database_backup")
        .set({ state: "deleted", deleted_at: now, object_id: null })
        .where("id", "=", row.id)
        .execute();
    }
    return { expired: expired.size };
  });
}
const STALE_ALERT = {
  actorKind: "system",
  actorId: "ops.backup_retention",
  action: "ops.backup_stale",
  subjectType: "database_backup",
} as const;
/**
 * OPS-01: when the newest ready backup is older than the threshold, record one audit event the
 * admin overview and audit log show, and one `backup_stale` error log. The alert is keyed by that
 * backup (or "none"), so the hourly job raises it once per stale period, never again each hour.
 */
export async function alertStaleBackups(
  db: Database,
  now = new Date(),
  options: { retention?: BackupRetentionSettings; log?: Logger } = {},
): Promise<{ stale: boolean; alerted: boolean }> {
  const retention = options.retention ?? readBackupRetentionSettings();
  const result = await db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const newest = await tx
      .selectFrom("ops.database_backup")
      .select(["id", "created_at as createdAt"])
      .where("state", "=", "ready")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    const staleness = backupStaleness(newest ?? null, now, retention.staleAfterHours);
    if (!staleness.stale) return { stale: false, alerted: false, ageMs: null };
    const earlier = await latestSubjectAudit(tx, {
      ...STALE_ALERT,
      subjectIds: [staleness.subjectId],
    });
    if (earlier) return { stale: true, alerted: false, ageMs: staleness.ageMs };
    await recordAudit(tx, { ...STALE_ALERT, subjectId: staleness.subjectId });
    return { stale: true, alerted: true, ageMs: staleness.ageMs };
  });
  if (result.alerted)
    // Allow-listed fields only (PRD-PRIV-06): no backup content, key or storage location.
    (options.log ?? createLogger())("error", "backup_stale", {
      module: "ops",
      kind: STALE_ALERT.actorId,
      reason: result.ageMs === null ? "no_ready_backup" : "newest_ready_backup_too_old",
      age_ms: result.ageMs,
    });
  return { stale: result.stale, alerted: result.alerted };
}
export function databaseBackupMaintenanceJob(
  store: ObjectStore,
  options: { log?: Logger } = {},
): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "ops.backup_retention",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, job) {
        // Read per run: an invalid override fails the job loudly and deletes nothing.
        const retention = readBackupRetentionSettings();
        await alertStaleBackups(job.db, job.now(), { retention, log: options.log });
        await maintainDatabaseBackups(job.db, store, job.now(), retention);
        await maintainDeletionJournals(job.db, store, job.now());
      },
    },
  };
}
