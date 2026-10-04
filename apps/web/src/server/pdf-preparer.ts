import "server-only";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { errors, readOwnedObject, writeOwnedObject } from "@recalino/core/plt";
import { type PdfPagePreparer, registerProcessingTemporaryObject } from "@recalino/core/proc";
import { getSource, readInputContract } from "@recalino/core/src";
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

// Webpack supplies the native CommonJS require; genuine ESM execution uses createRequire.
declare const __non_webpack_require__: NodeRequire | undefined;

// Only installed, traced parser resources are read by NodeBinaryDataFactory.
// Missing decoder assets can otherwise silently turn a JPX image into a blank OCR page.
let installedPdfRoot: string | undefined;
function pdfResourceRoot() {
  // Importing the job registry must not resolve renderer assets on unrelated API routes.
  if (!installedPdfRoot) {
    const nativeRequire =
      typeof __non_webpack_require__ === "function"
        ? __non_webpack_require__
        : createRequire(import.meta.url);
    const resolveInstalledPackage = nativeRequire.resolve.bind(nativeRequire);
    installedPdfRoot = dirname(resolveInstalledPackage("pdfjs-dist/package.json"));
  }
  return installedPdfRoot;
}
const resourceDirectory = (name: string) =>
  `${join(pdfResourceRoot(), name).replaceAll("\\", "/")}/`;
function assertInstalledResources() {
  try {
    const root = pdfResourceRoot();
    // next.config traces only the installed PDF assets; runtime checks must not trace the project.
    for (const name of ["cmaps", "standard_fonts"])
      if (
        !statSync(
          /* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, name),
        ).isDirectory()
      )
        throw new Error("Missing resource");
    for (const name of ["openjpeg.wasm", "jbig2.wasm", "qcms_bg.wasm"])
      if (
        !statSync(
          /* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, "wasm", name),
        ).isFile()
      )
        throw new Error("Missing decoder");
  } catch {
    throw errors.validationFailed({ pdf: ["renderer_resources_missing"] });
  }
}

const renderSettings = z.strictObject({
  maxSide: z.number().int().min(128).max(4096),
  maxPixels: z.number().int().positive().max(16777216),
  maxBytes: z.number().int().positive(),
  maxDecodedImagePixels: z.number().int().positive(),
  timeoutMs: z.number().int().min(1000).max(180000),
});
/** Technical render bounds, separate from configured commercial document quotas. */
export function readPdfRenderSettings(env: Record<string, string | undefined> = process.env) {
  const defaults = {
    maxSide: 2048,
    maxPixels: 4194304,
    maxBytes: 5000000,
    maxDecodedImagePixels: 16777216,
    timeoutMs: 60000,
  };
  return renderSettings.parse(
    env.PDF_RENDER_SETTINGS_JSON
      ? { ...defaults, ...JSON.parse(env.PDF_RENDER_SETTINGS_JSON) }
      : defaults,
  );
}
/** Passive owned PDF rasterization: no URLs, scripting, attachments, annotation actions or fonts fetched. */
export const preparePdfPage: PdfPagePreparer = async ({
  db,
  store,
  ctx,
  runId,
  source,
  page,
  now,
}) => {
  const settings = readPdfRenderSettings();
  assertInstalledResources();
  if (
    source.kind !== "pdf" ||
    !source.objectId ||
    !source.pageCount ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > source.pageCount ||
    (source.ranges.length &&
      !source.ranges.some((range) => page >= range.start && page <= range.end))
  )
    throw errors.validationFailed({ pdf: ["selected_owned_page_required"] });
  const asset = await getSource(db, ctx, source.sourceId);
  const contract = await readInputContract(db, asset.contract_version);
  if (asset.kind !== "pdf" || source.pageCount > (contract.formats.pdf.maxPages ?? 0))
    throw errors.payloadTooLarge();
  const bytes = await readOwnedObject(db, store, ctx, source.objectId);
  if (
    bytes.length > contract.formats.pdf.maxBytes ||
    createHash("sha256").update(bytes).digest("hex") !== source.sha256
  )
    throw errors.validationFailed({ pdf: ["integrity_mismatch"] });
  let task: PDFDocumentLoadingTask | undefined;
  let render: RenderTask | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => {
        render?.cancel();
        void task?.destroy();
        reject(errors.validationFailed({ pdf: ["render_timeout"] }));
      }, settings.timeoutMs);
    });
    task = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      useWorkerFetch: false,
      wasmUrl: resourceDirectory("wasm"),
      cMapUrl: resourceDirectory("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: resourceDirectory("standard_fonts"),
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      maxImageSize: settings.maxDecodedImagePixels,
    });
    const document = await Promise.race([task.promise, timeout]);
    if (document.numPages !== source.pageCount)
      throw errors.validationFailed({ pdf: ["page_count_changed"] });
    const pdfPage = await Promise.race([document.getPage(page), timeout]);
    try {
      const initial = pdfPage.getViewport({ scale: 1 });
      if (
        !Number.isFinite(initial.width) ||
        !Number.isFinite(initial.height) ||
        initial.width <= 0 ||
        initial.height <= 0
      )
        throw errors.unsupportedMedia();
      const scale = Math.min(
        settings.maxSide / Math.max(initial.width, initial.height),
        Math.sqrt(settings.maxPixels / (initial.width * initial.height)),
      );
      const viewport = pdfPage.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      if (width * height > settings.maxPixels) throw errors.payloadTooLarge();
      const canvas = createCanvas(width, height);
      render = pdfPage.render({
        canvas: null,
        canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
        viewport,
        annotationMode: 0,
        background: "rgb(255,255,255)",
      });
      await Promise.race([render.promise, timeout]);
      const image = await canvas.encode("jpeg", 85);
      if (!image.length || image.length > settings.maxBytes) throw errors.payloadTooLarge();
      const objectId = await writeOwnedObject(db, store, ctx, {
        module: "proc",
        retention: "temporary",
        contentType: "image/jpeg",
        bytes: image,
        now,
        onRegistered: (id) => registerProcessingTemporaryObject(db, ctx, runId, id, now),
      });
      return { page, objectId, mimeType: "image/jpeg" };
    } finally {
      pdfPage.cleanup();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw errors.validationFailed({ pdf: ["password_render_required"] });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    await task?.destroy();
  }
};
