import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { MemoryObjectStore } from "../plt";
import { decryptBackupArchive } from "./backup-crypto";
import {
  createDatabaseBackup,
  getDatabaseBackupMetadata,
  maintainDatabaseBackups,
  readDatabaseBackup,
  recordBackupRestoreDrill,
} from "./backups";
import {
  appendEncryptedDeletionJournal,
  maintainDeletionJournals,
  readEncryptedDeletionJournals,
} from "./deletion-journals";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());
const actor = {
  actorId: "synthetic-backup-operator",
  reason: "Isolated backup integration fixtures",
};
async function* archive() {
  yield Buffer.from("PGDMP synthetic archive fixture");
}
it("keeps backups private, idempotent and encrypted, and physically expires the 30-day copy", async () => {
  const store = new MemoryObjectStore(),
    key = randomBytes(32),
    now = new Date(),
    operationKey = randomUUID();
  const settings = {
    version: "1" as const,
    keyId: "synthetic",
    maxEncryptedBytes: 8192,
    timeoutSeconds: 30,
  };
  const input = { settings, key, operationKey, operator: actor, now };
  const saved = await createDatabaseBackup(db, store, archive(), input);
  expect(saved.state).toBe("ready");
  const repeated = await createDatabaseBackup(db, store, archive(), input);
  expect(repeated.id).toBe(saved.id);
  expect((await store.list("ops/system/")).objects).toHaveLength(1);
  await expect(
    createDatabaseBackup(db, store, archive(), {
      ...input,
      settings: { ...settings, keyId: "different" },
    }),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  const bytes = await readDatabaseBackup(db, store, saved.id, actor);
  expect(
    Buffer.from(decryptBackupArchive(bytes.ciphertext, key, bytes.keyId)).toString(),
  ).toContain("synthetic archive");
  await recordBackupRestoreDrill(
    db,
    saved.id,
    {
      isolatedLocal: true,
      tables: 3,
      constraintsValidated: true,
      milliseconds: 20,
      publicServiceOpened: false,
    },
    actor,
  );
  expect((await getDatabaseBackupMetadata(db, saved.id)).restoreDrilledAt).toBeTruthy();
  await maintainDatabaseBackups(db, store, new Date(now.getTime() + 30 * 24 * 3600 * 1000 + 1));
  expect((await store.list("ops/system/")).objects).toEqual([]);
  await expect(readDatabaseBackup(db, store, saved.id, actor)).rejects.toMatchObject({
    code: "not_found",
  });
});
it("recovers a durable deletion receipt after losing its DB manifest, rejects mutation and retains older-backup coverage", async () => {
  const store = new MemoryObjectStore(),
    key = randomBytes(32),
    now = new Date("2030-04-02T00:00:00Z");
  const deletion = {
    requestId: randomUUID(),
    userId: randomUUID(),
    kind: "session" as const,
    subjectId: randomUUID(),
    relatedSessions: [],
    requestedAt: now.toISOString(),
  };
  const config = { keyId: "synthetic-journal", key };
  const journal = await appendEncryptedDeletionJournal(db, store, config, deletion, now);
  expect(await appendEncryptedDeletionJournal(db, store, config, deletion, now)).toEqual(journal);
  expect((await store.list("priv/system/")).objects).toHaveLength(1);
  await expect(
    appendEncryptedDeletionJournal(
      db,
      store,
      config,
      { ...deletion, subjectId: randomUUID() },
      now,
    ),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  const keys = new Map([[config.keyId, key]]);
  expect(await readEncryptedDeletionJournals(store, keys)).toEqual([deletion]);
  await expect(readEncryptedDeletionJournals(store, new Map())).rejects.toThrow(
    "journal_recovery_key_required",
  );
  const pending = await db
    .insertInto("ops.database_backup")
    .values({
      operation_key: randomUUID(),
      request_hash: "0".repeat(64),
      key_id: config.keyId,
      created_at: new Date(now.getTime() - 1000),
      expires_at: new Date(now.getTime() + 29 * 24 * 3600 * 1000),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const afterRetention = new Date(now.getTime() + 31 * 24 * 3600 * 1000);
  await maintainDeletionJournals(db, store, afterRetention);
  expect((await store.list("priv/system/")).objects).toHaveLength(1);
  await maintainDatabaseBackups(db, store, afterRetention);
  expect((await getDatabaseBackupMetadata(db, pending.id)).state).toBe("deleted");
  await db.deleteFrom("ops.deletion_journal").where("id", "=", journal.journalId).execute();
  // Recovery reads only independently durable Blob entries, even with no database record.
  expect(await readEncryptedDeletionJournals(store, keys)).toEqual([deletion]);
});
