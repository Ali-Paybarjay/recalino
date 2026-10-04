import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const MAGIC = Buffer.from("RCBK0001", "ascii");
const headerSchema = z.strictObject({
  version: z.literal("1"),
  keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  createdAt: z.iso.datetime(),
  archiveFormat: z.enum(["postgres-custom", "deletion-journal"]),
  algorithm: z.literal("aes-256-gcm"),
});
export type BackupHeader = z.infer<typeof headerSchema>;
export function backupEncryptionKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("backup_key_invalid");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("backup_key_invalid");
  return key;
}
/** Encrypt each native dump stdout chunk immediately; no plaintext file is created. */
export async function encryptBackupArchive(
  chunks: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  input: { keyId: string; createdAt: Date; maxBytes: number },
): Promise<Uint8Array> {
  return encryptEnvelope(chunks, key, { ...input, archiveFormat: "postgres-custom" });
}
async function encryptEnvelope(
  chunks: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  input: {
    keyId: string;
    createdAt: Date;
    maxBytes: number;
    archiveFormat: BackupHeader["archiveFormat"];
  },
): Promise<Uint8Array> {
  if (key.length !== 32 || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1024)
    throw new Error("backup_configuration_invalid");
  const header = Buffer.from(
    JSON.stringify(
      headerSchema.parse({
        version: "1",
        keyId: input.keyId,
        createdAt: input.createdAt.toISOString(),
        archiveFormat: input.archiveFormat,
        algorithm: "aes-256-gcm",
      }),
    ),
    "utf8",
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const prefix = Buffer.concat([MAGIC, length, header]);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(prefix);
  const encrypted: Buffer[] = [prefix, nonce];
  let size = prefix.length + nonce.length + 16;
  let signature = Buffer.alloc(0);
  for await (const chunk of chunks) {
    if (signature.length < 5)
      signature = Buffer.concat([signature, Buffer.from(chunk.subarray(0, 5 - signature.length))]);
    size += chunk.length;
    if (size > input.maxBytes) throw new Error("backup_size_limit");
    encrypted.push(cipher.update(chunk));
  }
  if (input.archiveFormat === "postgres-custom" && signature.toString("ascii") !== "PGDMP")
    throw new Error("backup_archive_invalid");
  encrypted.push(cipher.final(), cipher.getAuthTag());
  return Buffer.concat(encrypted);
}
export function backupArchiveHeader(bytes: Uint8Array): BackupHeader {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 44 || !data.subarray(0, 8).equals(MAGIC))
    throw new Error("backup_integrity_failed");
  const length = data.readUInt32BE(8);
  if (length < 1 || length > 2048 || data.length < 12 + length + 28)
    throw new Error("backup_integrity_failed");
  try {
    return headerSchema.parse(JSON.parse(data.subarray(12, 12 + length).toString("utf8")));
  } catch {
    throw new Error("backup_integrity_failed");
  }
}
/** Authentication must succeed before an operator passes any plaintext to pg_restore. */
export function decryptBackupArchive(
  bytes: Uint8Array,
  key: Uint8Array,
  expectedKeyId: string,
): Uint8Array {
  const archive = decryptEnvelope(bytes, key, expectedKeyId, "postgres-custom");
  if (Buffer.from(archive.subarray(0, 5)).toString("ascii") !== "PGDMP")
    throw new Error("backup_integrity_failed");
  return archive;
}
function decryptEnvelope(
  bytes: Uint8Array,
  key: Uint8Array,
  expectedKeyId: string,
  archiveFormat: BackupHeader["archiveFormat"],
): Uint8Array {
  try {
    const header = backupArchiveHeader(bytes);
    if (
      key.length !== 32 ||
      header.keyId !== expectedKeyId ||
      header.archiveFormat !== archiveFormat
    )
      throw new Error();
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const prefixLength = 12 + data.readUInt32BE(8);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      data.subarray(prefixLength, prefixLength + 12),
    );
    decipher.setAAD(data.subarray(0, prefixLength));
    decipher.setAuthTag(data.subarray(-16));
    const archive = Buffer.concat([
      decipher.update(data.subarray(prefixLength + 12, -16)),
      decipher.final(),
    ]);
    return archive;
  } catch {
    throw new Error("backup_integrity_failed");
  }
}
export async function encryptDeletionJournal(
  bytes: Uint8Array,
  key: Uint8Array,
  keyId: string,
  now: Date,
): Promise<Uint8Array> {
  return encryptEnvelope(
    (async function* () {
      yield bytes;
    })(),
    key,
    { keyId, createdAt: now, maxBytes: 1024 * 1024, archiveFormat: "deletion-journal" },
  );
}
export function decryptDeletionJournal(
  bytes: Uint8Array,
  key: Uint8Array,
  keyId: string,
): Uint8Array {
  return decryptEnvelope(bytes, key, keyId, "deletion-journal");
}
