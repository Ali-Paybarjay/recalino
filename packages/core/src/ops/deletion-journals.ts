import { sql } from "kysely";
import { z } from "zod";
import type { Database } from "../db";
import {
  canonicalJson,
  createObject,
  deleteObject,
  errors,
  type ObjectStore,
  readSystemJournalObjects,
  sha256Hex,
  writeOwnedObject,
} from "../plt";
import {
  backupArchiveHeader,
  decryptDeletionJournal,
  encryptDeletionJournal,
} from "./backup-crypto";

export const deletionJournalSchema = z.strictObject({
  requestId: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(["account", "session", "source"]),
  subjectId: z.uuid(),
  relatedSessions: z.array(z.uuid()).max(10000),
  requestedAt: z.iso.datetime(),
});
export type DeletionJournal = z.infer<typeof deletionJournalSchema>;
export type JournalEncryption = { keyId: string; key: Uint8Array };
/** Called before PRIV marks physical cleanup complete; a failed durable write must retry. */
export async function appendEncryptedDeletionJournal(
  db: Database,
  store: ObjectStore,
  encryption: JournalEncryption,
  raw: unknown,
  now = new Date(),
) {
  const input = deletionJournalSchema.parse(raw);
  const requestHash = sha256Hex(canonicalJson(input));
  const ciphertext = await encryptDeletionJournal(
    Buffer.from(JSON.stringify(input), "utf8"),
    encryption.key,
    encryption.keyId,
    now,
  );
  let stagedId: string | undefined;
  try {
    const registered = await db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('ops:encrypted-backups', 1))`.execute(
        tx,
      );
      const existing = await tx
        .selectFrom("ops.deletion_journal")
        .selectAll()
        .where("request_id", "=", input.requestId)
        .executeTakeFirst();
      if (existing && existing.request_hash !== requestHash) throw errors.idempotencyMismatch();
      if (existing?.state === "ready" || existing?.state === "deleted")
        return { journalId: existing.id, targetId: null };
      const row =
        existing ??
        (await tx
          .insertInto("ops.deletion_journal")
          .values({
            request_id: input.requestId,
            request_hash: requestHash,
            key_id: encryption.keyId,
            requested_at: new Date(input.requestedAt),
            created_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow());
      if (row.object_id) await deleteObject(tx, store, "system", row.object_id, now);
      const target = await createObject(tx, {
        module: "priv",
        ownerUserId: null,
        retention: "durable",
        contentType: "application/octet-stream",
        sizeBytes: ciphertext.length,
        now,
      });
      await tx
        .updateTable("ops.deletion_journal")
        .set({ object_id: target.id, key_id: encryption.keyId })
        .where("id", "=", row.id)
        .execute();
      return { journalId: row.id, targetId: target.id };
    });
    if (!registered.targetId) return { journalId: registered.journalId };
    return await db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('ops:encrypted-backups', 1))`.execute(
        tx,
      );
      const current = await tx
        .selectFrom("ops.deletion_journal")
        .selectAll()
        .where("id", "=", registered.journalId)
        .executeTakeFirstOrThrow();
      if (current.request_hash !== requestHash) throw errors.idempotencyMismatch();
      if (current.state === "ready" || current.state === "deleted")
        return { journalId: current.id };
      if (current.object_id !== registered.targetId) throw errors.conflict();
      stagedId = registered.targetId;
      const objectId = await writeOwnedObject(tx, store, "system", {
        targetObjectId: registered.targetId,
        module: "priv",
        retention: "durable",
        contentType: "application/octet-stream",
        bytes: ciphertext,
        now,
      });
      await tx
        .updateTable("ops.deletion_journal")
        .set({
          state: "ready",
          object_id: objectId,
          encrypted_sha256: sha256Hex(ciphertext),
          key_id: encryption.keyId,
        })
        .where("id", "=", current.id)
        .execute();
      return { journalId: current.id };
    });
  } catch (failure) {
    if (stagedId) await deleteObject(db, store, "system", stagedId, now);
    throw failure;
  }
}
/** Needs only the private Blob store and keyring; UUIDs are deduplicated after authenticated decryption. */
export async function readEncryptedDeletionJournals(
  store: ObjectStore,
  keys: ReadonlyMap<string, Uint8Array>,
): Promise<DeletionJournal[]> {
  const journals = new Map<string, DeletionJournal>();
  for await (const bytes of readSystemJournalObjects(store)) {
    const header = backupArchiveHeader(bytes),
      key = keys.get(header.keyId);
    if (!key || header.archiveFormat !== "deletion-journal")
      throw new Error("journal_recovery_key_required");
    let input: DeletionJournal;
    try {
      input = deletionJournalSchema.parse(
        JSON.parse(Buffer.from(decryptDeletionJournal(bytes, key, header.keyId)).toString("utf8")),
      );
    } catch {
      throw new Error("journal_integrity_failed");
    }
    const previous = journals.get(input.requestId);
    if (previous && canonicalJson(previous) !== canonicalJson(input)) throw errors.conflict();
    journals.set(input.requestId, input);
  }
  return [...journals.values()].sort(
    (a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.requestId.localeCompare(b.requestId),
  );
}
/** Journal expiry cannot precede the final retained backup that was captured before deletion. */
export async function maintainDeletionJournals(db: Database, store: ObjectStore, now = new Date()) {
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('ops:encrypted-backups', 1))`.execute(
      tx,
    );
    const rows = await tx
      .selectFrom("ops.deletion_journal")
      .selectAll()
      .where("state", "=", "ready")
      .where("requested_at", "<=", new Date(now.getTime() - 30 * 24 * 3600 * 1000))
      .execute();
    let removed = 0;
    for (const row of rows) {
      const retained = await tx
        .selectFrom("ops.database_backup")
        .select("id")
        .where("state", "in", ["pending", "ready"])
        .where("created_at", "<", row.requested_at)
        .executeTakeFirst();
      if (retained) continue;
      if (row.object_id) await deleteObject(tx, store, "system", row.object_id, now);
      await tx
        .updateTable("ops.deletion_journal")
        .set({ state: "deleted", object_id: null, deleted_at: now })
        .where("id", "=", row.id)
        .execute();
      removed++;
    }
    return { removed };
  });
}
