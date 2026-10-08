import { createHash } from "node:crypto";

const padding = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest();
function padded(password: string) {
  const value = Buffer.from(password, "latin1");
  return Buffer.concat([value, padding]).subarray(0, 32);
}
function rc4(key: Uint8Array, input: Uint8Array) {
  const state = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) % 256;
    const old = state[i] ?? 0;
    state[i] = state[j] ?? 0;
    state[j] = old;
  }
  let i = 0;
  j = 0;
  const out = Buffer.alloc(input.length);
  for (let n = 0; n < input.length; n++) {
    i = (i + 1) % 256;
    j = (j + (state[i] ?? 0)) % 256;
    const old = state[i] ?? 0;
    state[i] = state[j] ?? 0;
    state[j] = old;
    out[n] = (input[n] ?? 0) ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) % 256] ?? 0);
  }
  return out;
}
/** Synthetic one-page PDF with optional standard PDF revision2 encryption for parser tests. */
export function syntheticSourcePdf(password?: string) {
  const plain = Buffer.from("BT /F1 12 Tf 30 70 Td (Synthetic lesson only.) Tj ET", "latin1"),
    fileId = Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const owner = password
    ? rc4(md5(padded("synthetic-owner")).subarray(0, 5), padded(password))
    : null;
  const fileKey =
    password && owner
      ? md5(Buffer.concat([padded(password), owner, permissions, fileId])).subarray(0, 5)
      : null;
  const user = fileKey ? rc4(fileKey, padding) : null;
  const stream = fileKey
    ? rc4(md5(Buffer.concat([fileKey, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10), plain)
    : plain;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`,
  ];
  if (owner && user)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
    );
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${owner ? `/Encrypt 6 0 R /ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>]` : ""}>>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(document, "latin1"));
}
