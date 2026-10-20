import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { deleteObject, MemoryObjectStore } from "../plt";
import { decryptBackupArchive } from "./backup-crypto";
import {
  alertStaleBackups,
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
const settings = {
  version: "1" as const,
  keyId: "synthetic",
  maxEncryptedBytes: 8192,
  timeoutSeconds: 30,
};
const strict = { keepReady: 0, staleAfterHours: 30 };
const hour = 3600 * 1000,
  day = 24 * hour;
/** The retention floor and the stale alert read the whole table; leave no ready fixture behind. */
async function retire(store: MemoryObjectStore, ids: string[]) {
  const now = new Date();
  for (const id of ids) {
    const row = await db
      .selectFrom("ops.database_backup")
      .select("object_id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (row?.object_id) await deleteObject(db, store, "system", row.object_id, now);
    await db
      .updateTable("ops.database_backup")
      .set({ state: "deleted", deleted_at: now, object_id: null })
      .where("id", "=", id)
      .execute();
  }
}
it("keeps backups private, idempotent and encrypted, and physically expires the 30-day copy", async () => {
  const store = new MemoryObjectStore(),
    key = randomBytes(32),
    now = new Date(),
    operationKey = randomUUID();
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
  // keepReady 0 is the strict 30-day lifecycle; the default floor is covered below (OPS-01).
  await maintainDatabaseBackups(
    db,
    store,
    new Date(now.getTime() + 30 * 24 * 3600 * 1000 + 1),
    strict,
  );
  expect((await store.list("ops/system/")).objects).toEqual([]);
  await expect(readDatabaseBackup(db, store, saved.id, actor)).rejects.toMatchObject({
    code: "not_found",
  });
});
// OPS-01: nightly failures must never let retention delete the last restorable copies.
it("keeps the newest three ready backups past expiry, still readable, and expires the rest", async () => {
  const store = new MemoryObjectStore(),
    key = randomBytes(32);
  // Later than any fixture of an earlier run, so these are the newest ready backups in the table.
  const base = new Date(Date.now() + 40 * 365 * day);
  const ids: string[] = [];
  try {
    for (let index = 0; index < 4; index++) {
      const saved = await createDatabaseBackup(db, store, archive(), {
        settings,
        key,
        operationKey: randomUUID(),
        operator: actor,
        now: new Date(base.getTime() + index * day),
      });
      ids.push(saved.id);
    }
    const failed = await db
      .insertInto("ops.database_backup")
      .values({
        operation_key: randomUUID(),
        request_hash: "0".repeat(64),
        key_id: settings.keyId,
        state: "failed",
        last_error: "backup_failed",
        created_at: new Date(base.getTime() + 4 * day),
        expires_at: new Date(base.getTime() + 34 * day),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(failed.id);
    const allExpired = new Date(base.getTime() + 60 * day);
    const retention = { keepReady: 3, staleAfterHours: 30 };
    await maintainDatabaseBackups(db, store, allExpired, retention);
    const state = async (id: string) => (await getDatabaseBackupMetadata(db, id)).state;
    expect(await state(ids[0] as string)).toBe("deleted");
    expect(await state(failed.id)).toBe("deleted");
    for (const id of ids.slice(1, 4)) expect(await state(id)).toBe("ready");
    expect((await store.list("ops/system/")).objects).toHaveLength(3);
    const newest = await readDatabaseBackup(
      db,
      store,
      ids[3] as string,
      actor,
      allExpired,
      retention,
    );
    expect(
      Buffer.from(decryptBackupArchive(newest.ciphertext, key, newest.keyId)).toString(),
    ).toContain("synthetic archive");
    // Repeating the hourly job changes nothing while no newer ready backup exists.
    await maintainDatabaseBackups(db, store, new Date(allExpired.getTime() + hour), retention);
    for (const id of ids.slice(1, 4)) expect(await state(id)).toBe("ready");
  } finally {
    await retire(store, ids);
  }
});
it("raises one stale-backup alert after 30 hours without a ready backup, not one per hour", async () => {
  const store = new MemoryObjectStore();
  const base = new Date(Date.now() + 40 * 365 * day);
  const ids: string[] = [];
  const lines: string[] = [];
  const log = (level: string, event: string) => lines.push(`${level}:${event}`);
  const retention = { keepReady: 3, staleAfterHours: 30 };
  try {
    const saved = await createDatabaseBackup(db, store, archive(), {
      settings,
      key: randomBytes(32),
      operationKey: randomUUID(),
      operator: actor,
      now: base,
    });
    ids.push(saved.id);
    const alerts = () =>
      db
        .selectFrom("plt.audit_event")
        .select("id")
        .where("action", "=", "ops.backup_stale")
        .where("subject_id", "=", saved.id)
        .execute();
    expect(
      await alertStaleBackups(db, new Date(base.getTime() + 29 * hour), { retention, log }),
    ).toEqual({ stale: false, alerted: false });
    expect(
      await alertStaleBackups(db, new Date(base.getTime() + 31 * hour), { retention, log }),
    ).toEqual({
      stale: true,
      alerted: true,
    });
    expect(
      await alertStaleBackups(db, new Date(base.getTime() + 32 * hour), { retention, log }),
    ).toEqual({
      stale: true,
      alerted: false,
    });
    expect(await alerts()).toHaveLength(1);
    expect(lines).toEqual(["error:backup_stale"]);
  } finally {
    await retire(store, ids);
  }
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
  await maintainDatabaseBackups(db, store, afterRetention, strict);
  expect((await getDatabaseBackupMetadata(db, pending.id)).state).toBe("deleted");
  await db.deleteFrom("ops.deletion_journal").where("id", "=", journal.journalId).execute();
  // Recovery reads only independently durable Blob entries, even with no database record.
  expect(await readEncryptedDeletionJournals(store, keys)).toEqual([deletion]);
});
