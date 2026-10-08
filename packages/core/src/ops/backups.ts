import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import {
  canonicalJson,
  createObject,
  deleteObject,
  errors,
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
    if (row?.state !== "ready" || row.expires_at <= now || !row.object_id) throw errors.notFound();
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
export async function maintainDatabaseBackups(db: Database, store: ObjectStore, now = new Date()) {
  return db.transaction().execute(async (tx) => {
    await lockBackups(tx);
    const rows = await tx
      .selectFrom("ops.database_backup")
      .select(["id", "object_id"])
      .where("expires_at", "<=", now)
      .execute();
    for (const row of rows) {
      if (row.object_id) await deleteObject(tx, store, "system", row.object_id, now);
      await tx
        .updateTable("ops.database_backup")
        .set({ state: "deleted", deleted_at: now, object_id: null })
        .where("id", "=", row.id)
        .execute();
    }
    return { expired: rows.length };
  });
}
export function databaseBackupMaintenanceJob(store: ObjectStore): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "ops.backup_retention",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, job) {
        await maintainDatabaseBackups(job.db, store, job.now());
        await maintainDeletionJournals(job.db, store, job.now());
      },
    },
  };
}
