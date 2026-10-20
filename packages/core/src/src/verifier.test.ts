import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { syntheticSourcePdf } from "../../test/source-fixtures";
import type { InputContract } from "./contracts";
import { DefaultSourceVerifier, extractPdfText } from "./verifier";

function syntheticPdf() {
  const stream = "BT /F1 12 Tf 30 70 Td (Synthetic lesson only.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = document.length;
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(document);
}
describe("bounded media inspection (FR-SRC-005)", () => {
  it("keeps a protected PDF pending until a correct request-local password is provided", async () => {
    const bytes = syntheticSourcePdf("test-password"),
      contract = { formats: { pdf: { maxPages: 10 } } } as InputContract;
    expect(await new DefaultSourceVerifier().inspect(bytes, "application/pdf", contract)).toEqual({
      passwordRequired: true,
    });
    await expect(extractPdfText(bytes, 10, "wrong-password")).rejects.toMatchObject({
      name: "PasswordException",
    });
    expect((await extractPdfText(bytes, 10, "test-password")).blocks[0]?.text).toContain(
      "Synthetic lesson only.",
    );
  });
  it("extracts a real synthetic PDF text layer and page locator", async () => {
    const result = await extractPdfText(syntheticPdf(), 10);
    expect(result.pageCount).toBe(1);
    expect(result.blocks[0]?.text).toContain("Synthetic lesson only.");
    expect(result.units[0]).toMatchObject({ kind: "page", start: 1, status: "extracted" });
  });
  it("parses uploaded PDFs with a pdf.js build that has no code-generation path (SEC-06)", () => {
    // pdf.js 6 removed eval-compiled glyphs together with the isEvalSupported option. If an
    // upgrade brings either back, every getDocument call must pass isEvalSupported: false.
    const resolve = createRequire(import.meta.url).resolve;
    for (const entry of [
      "pdfjs-dist/legacy/build/pdf.mjs",
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    ]) {
      const code = readFileSync(resolve(entry), "utf8");
      expect(code, entry).not.toMatch(/\bnew Function\(/);
      expect(code, entry).not.toMatch(/(^|[^\w.$])eval\(/);
      expect(code, entry).not.toMatch(/\bisEvalSupported\b/);
    }
  });
  it("rejects a valid PDF over the page limit", async () => {
    await expect(extractPdfText(syntheticPdf(), 0)).rejects.toMatchObject({
      code: "payload_too_large",
    });
  });
  it("decodes an image and rejects its forged huge dimensions before decompression", async () => {
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: "white" } })
        .png()
        .toBuffer(),
      verifier = new DefaultSourceVerifier(),
      contract = { formats: { image: { maxPixels: 20 }, pdf: { maxPages: 1 } } } as InputContract;
    expect(await verifier.inspect(bytes, "image/png", contract)).toEqual({ width: 2, height: 3 });
    const bomb = Buffer.from(bytes);
    bomb.writeUInt32BE(100000, 16);
    bomb.writeUInt32BE(100000, 20);
    await expect(verifier.inspect(bomb, "image/png", contract)).rejects.toThrow();
  });
  it("rejects truncated data with a superficially valid signature", async () => {
    const verifier = new DefaultSourceVerifier();
    await expect(
      verifier.inspect(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
        { formats: { image: { maxPixels: 20 } } } as InputContract,
      ),
    ).rejects.toThrow();
  });
});
