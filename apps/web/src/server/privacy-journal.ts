import "server-only";
import { randomBytes } from "node:crypto";
import { appendEncryptedDeletionJournal, backupEncryptionKey } from "@recalino/core/ops";
import { errors, MemoryObjectStore } from "@recalino/core/plt";
import type { DeletionJournal, DeletionJournalRecordOptions } from "@recalino/core/priv";
import { getDatabase } from "./db";
import { localJournalFixtureAvailable } from "./local-test-policy";
import { getObjectStore } from "./storage";

export { localJournalFixtureAvailable } from "./local-test-policy";

// Only synthetic browser tests use this process-lifetime store. It is not a backup guarantee.
let fixture: { store: MemoryObjectStore; key: Uint8Array } | undefined;
export function privacyDeletionJournal(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DeletionJournal {
  if (localJournalFixtureAvailable(env)) {
    fixture ??= { store: new MemoryObjectStore(), key: randomBytes(32) };
    const local = fixture;
    return {
      async record(entry, options) {
        await appendEncryptedDeletionJournal(
          getDatabase(),
          local.store,
          { keyId: "local-e2e-fixture", key: local.key },
          entry,
          undefined,
          journalOptions(options),
        );
      },
    };
  }
  return {
    async record(entry, options) {
      const keyId = env.RECALINO_BACKUP_KEY_ID;
      const encoded = env.RECALINO_BACKUP_KEY_BASE64;
      if (!keyId || !encoded) throw errors.configurationMissing("deletion_journal_key_missing");
      const store = getObjectStore();
      if (!store) throw errors.configurationMissing("storage_adapter_missing");
      await appendEncryptedDeletionJournal(
        getDatabase(),
        store,
        { keyId, key: backupEncryptionKey(encoded) },
        entry,
        undefined,
        journalOptions(options),
      );
    },
  };
}

/** P12-09 AC-1: the privacy cleanup's job reaches the journal write; the API path gives none. */
function journalOptions(options: DeletionJournalRecordOptions | undefined) {
  return options?.job === undefined ? {} : { job: options.job };
}
