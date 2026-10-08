export type FileHashes = {
  sha256: string;
  parts: { index: number; sizeBytes: number; sha256: string }[];
};
async function hash(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Read the original once, rather than rereading its Blob for each part. */
export async function calculateFileHashes(
  file: Blob,
  partBytes: number,
  includeParts: boolean,
): Promise<FileHashes> {
  if (!Number.isSafeInteger(partBytes) || partBytes < 1)
    throw new Error("Invalid upload part size");
  const bytes = await file.arrayBuffer();
  const sha256 = await hash(bytes);
  const parts: FileHashes["parts"] = [];
  if (includeParts)
    for (let offset = 0; offset < bytes.byteLength; offset += partBytes) {
      const part = bytes.slice(offset, offset + partBytes);
      parts.push({ index: parts.length, sizeBytes: part.byteLength, sha256: await hash(part) });
    }
  return { sha256, parts };
}
