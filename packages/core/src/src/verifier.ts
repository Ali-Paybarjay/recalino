import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { errors } from "../plt";
import type { InputContract } from "./contracts";
import type { SourceVerifier } from "./service";

/** Passive PDF parser: no rendering, JavaScript, attachments, external resources or eval. */
export async function extractPdfText(bytes: Uint8Array, maxPages: number, password?: string) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    ...(password ? { password } : {}),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    useWorkerFetch: false,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) throw errors.payloadTooLarge();
    const units: {
      id: string;
      kind: "page";
      start: number;
      status: "extracted" | "failed";
      reason?: string;
    }[] = [];
    const blocks: { id: string; kind: "paragraph"; text: string; unitId: string }[] = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent({ disableNormalization: false });
        const text = content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("")
          .trim();
        length += text.length;
        // Bound decoded output independently of compressed file size.
        if (length > 5_000_000 || text.length > 100_000) throw errors.payloadTooLarge();
        units.push({
          id: `page-${number}`,
          kind: "page",
          start: number,
          status: text ? "extracted" : "failed",
          ...(text ? {} : { reason: "ocr_required" }),
        });
        if (text)
          blocks.push({
            id: `page-${number}-block-1`,
            kind: "paragraph",
            text,
            unitId: `page-${number}`,
          });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, units, blocks };
  } finally {
    await task.destroy();
  }
}

/** FR-SRC-005: decoded image pixels and PDF pages are checked before acceptance. */
export class DefaultSourceVerifier implements SourceVerifier {
  async inspect(bytes: Uint8Array, mimeType: string, contract: InputContract) {
    if (mimeType === "application/pdf") {
      try {
        const extracted = await extractPdfText(bytes, contract.formats.pdf.maxPages ?? 0);
        return { pageCount: extracted.pageCount };
      } catch (error) {
        if (error instanceof Error && error.name === "PasswordException")
          return { passwordRequired: true };
        throw error;
      }
    }
    if (mimeType.startsWith("image/")) {
      const image = sharp(bytes, {
        limitInputPixels: contract.formats.image.maxPixels ?? 0,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
        throw errors.unsupportedMedia();
      // Force a bounded decode: forged/truncated bodies cannot pass with a valid header alone.
      await image.resize(1, 1).raw().toBuffer();
      return { width: metadata.width, height: metadata.height };
    }
    throw errors.unsupportedMedia();
  }
}
