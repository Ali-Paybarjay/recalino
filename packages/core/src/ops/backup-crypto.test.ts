import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  backupArchiveHeader,
  backupEncryptionKey,
  decryptBackupArchive,
  decryptDeletionJournal,
  encryptBackupArchive,
  encryptDeletionJournal,
} from "./backup-crypto";

const now = new Date("2026-10-04T01:00:00Z");
async function* chunks(value: Uint8Array) {
  for (let i = 0; i < value.length; i += 3) yield value.subarray(i, i + 3);
}
it("authenticates ciphertext, nonce and headers, including archives split across stdout chunks", async () => {
  const key = randomBytes(32),
    original = Buffer.from("PGDMP\0synthetic فارسی private lesson");
  const bytes = await encryptBackupArchive(chunks(original), key, {
    keyId: "synthetic-1",
    createdAt: now,
    maxBytes: 4096,
  });
  expect(backupArchiveHeader(bytes).archiveFormat).toBe("postgres-custom");
  expect(Buffer.from(bytes).includes(Buffer.from("private lesson"))).toBe(false);
  expect(decryptBackupArchive(bytes, key, "synthetic-1")).toEqual(original);
  expect(() => decryptBackupArchive(bytes, randomBytes(32), "synthetic-1")).toThrow(
    "backup_integrity_failed",
  );
  for (const offset of [0, 20, bytes.length - 20, bytes.length - 1]) {
    const changed = new Uint8Array(bytes);
    changed[offset] = (changed[offset] ?? 0) ^ 1;
    expect(() => decryptBackupArchive(changed, key, "synthetic-1")).toThrow(
      "backup_integrity_failed",
    );
  }
});
it("rejects unrecognized archives, excessive output and a key ID reused for another archive kind", async () => {
  const key = randomBytes(32);
  await expect(
    encryptBackupArchive(chunks(Buffer.from("plain SQL private data")), key, {
      keyId: "test",
      createdAt: now,
      maxBytes: 4096,
    }),
  ).rejects.toThrow("backup_archive_invalid");
  await expect(
    encryptBackupArchive(chunks(Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(2000)])), key, {
      keyId: "test",
      createdAt: now,
      maxBytes: 1024,
    }),
  ).rejects.toThrow("backup_size_limit");
  const journal = await encryptDeletionJournal(Buffer.from('{"synthetic":true}'), key, "test", now);
  expect(() => decryptBackupArchive(journal, key, "test")).toThrow("backup_integrity_failed");
  expect(Buffer.from(decryptDeletionJournal(journal, key, "test")).toString()).toBe(
    '{"synthetic":true}',
  );
  expect(backupEncryptionKey(key.toString("base64"))).toEqual(key);
  expect(() => backupEncryptionKey("secret")).toThrow("backup_key_invalid");
});
