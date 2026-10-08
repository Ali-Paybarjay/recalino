import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, recordAudit } from "../plt";

export const SOURCE_KINDS = ["audio", "image", "pdf", "html", "text"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const formats = z.strictObject({
  mimeTypes: z.array(z.string().min(1)).min(1),
  maxBytes: positive,
  maxDurationMs: positive.optional(),
  maxPixels: positive.optional(),
  maxPages: positive.optional(),
});
const ALLOWED: Record<SourceKind, readonly string[]> = {
  audio: ["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/ogg"],
  image: ["image/jpeg", "image/png", "image/webp"],
  pdf: ["application/pdf"],
  html: ["text/html"],
  text: ["text/plain"],
};
export const inputContractSchema = z
  .strictObject({
    version: z.string().min(1).max(100),
    noticeVersion: z.string().min(1).max(100),
    maxSourcesPerSession: positive,
    partBytes: positive,
    uploadTtlSeconds: positive,
    maxPartAttempts: positive,
    maxRanges: positive,
    htmlMaxNodes: positive,
    htmlMaxDepth: positive,
    formats: z.strictObject({
      audio: formats,
      image: formats,
      pdf: formats,
      html: formats,
      text: formats,
    }),
  })
  .superRefine((contract, ctx) => {
    for (const kind of SOURCE_KINDS) {
      if (contract.formats[kind].mimeTypes.some((mime) => !ALLOWED[kind].includes(mime)))
        ctx.addIssue({
          code: "custom",
          path: ["formats", kind, "mimeTypes"],
          message: "unsupported",
        });
    }
    for (const [kind, limit] of [
      ["audio", "maxDurationMs"],
      ["image", "maxPixels"],
      ["pdf", "maxPages"],
    ] as const)
      if (!contract.formats[kind][limit])
        ctx.addIssue({ code: "custom", path: ["formats", kind, limit], message: "required" });
  });
export type InputContract = z.infer<typeof inputContractSchema>;

/** Server-only operator configuration. Existing version contents are immutable. */
export async function configureInputContract(
  db: Database,
  raw: unknown,
  operator: { actorId: string; reason: string },
  now = new Date(),
): Promise<InputContract> {
  const input = inputContractSchema.parse(raw);
  z.string().min(1).max(200).parse(operator.actorId);
  z.string().min(1).max(500).parse(operator.reason);
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('src.input_contract',17))`.execute(tx);
    const prior = await tx
      .selectFrom("src.input_contract")
      .selectAll()
      .where("version", "=", input.version)
      .executeTakeFirst();
    if (prior && canonicalJson(prior.rules) !== canonicalJson(input))
      throw errors.idempotencyMismatch();
    await tx
      .updateTable("src.input_contract")
      .set({ active: false })
      .where("active", "=", true)
      .where("version", "!=", input.version)
      .execute();
    if (prior)
      await tx
        .updateTable("src.input_contract")
        .set({ active: true })
        .where("version", "=", input.version)
        .execute();
    else
      await tx
        .insertInto("src.input_contract")
        .values({
          version: input.version,
          rules: JSON.stringify(input),
          active: true,
          created_at: now,
        })
        .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: operator.actorId,
      action: "src.configure_input_contract",
      subjectType: "input_contract",
      subjectId: input.version,
      reason: operator.reason,
    });
    return input;
  });
}

/** FR-SRC-002: absence or corruption disables uploads; no invented capacity defaults. */
export async function readInputContract(
  db: Database | Tx,
  version?: string,
): Promise<InputContract> {
  const row = await db
    .selectFrom("src.input_contract")
    .select("rules")
    .$if(version !== undefined, (qb) => qb.where("version", "=", version ?? ""))
    .$if(version === undefined, (qb) => qb.where("active", "=", true))
    .executeTakeFirst();
  const result = inputContractSchema.safeParse(row?.rules);
  if (!result.success) throw errors.validationFailed({ configuration: ["unavailable"] });
  return result.data;
}

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceFileSchema = z.strictObject({
  sessionId: z.uuid(),
  kind: z.enum(SOURCE_KINDS),
  mimeType: z.string().min(1).max(100),
  sizeBytes: positive,
  sha256: sha256Schema,
  displayName: z.string().min(1).max(255),
  durationMs: positive.optional(),
  captureAnchor: z
    .strictObject({
      sourceId: z.uuid(),
      offsetMs: z.number().int().nonnegative(),
      state: z.enum(["recording", "paused"]),
    })
    .optional(),
  parts: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        sizeBytes: positive,
        sha256: sha256Schema,
      }),
    )
    .max(10000),
  operationKey: z.string().min(8).max(200),
});
export type SourceFile = z.infer<typeof sourceFileSchema>;

// FR-SRC-001: remove controls and bidirectional overrides before metadata can reach the UI.
export function cleanDisplayName(value: string): string {
  const clean = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point > 31 && (point < 127 || point > 159);
    })
    .join("")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (!clean) throw errors.validationFailed({ displayName: ["empty"] });
  return clean;
}

export function validateFileDeclaration(input: SourceFile, contract: InputContract): void {
  if (input.captureAnchor && input.kind !== "image")
    throw errors.validationFailed({ captureAnchor: ["image_only"] });
  const format = contract.formats[input.kind];
  if (!format.mimeTypes.includes(input.mimeType)) throw errors.unsupportedMedia();
  if (input.sizeBytes > format.maxBytes) throw errors.payloadTooLarge();
  if (input.kind === "audio") {
    if (!input.durationMs || input.durationMs > (format.maxDurationMs ?? 0))
      throw errors.validationFailed({ durationMs: ["out_of_range"] });
    if (input.parts.length) throw errors.validationFailed({ parts: ["audio_stays_on_device"] });
    return;
  }
  if (
    !input.parts.length ||
    input.parts.reduce((sum, p) => sum + p.sizeBytes, 0) !== input.sizeBytes
  )
    throw errors.validationFailed({ parts: ["size_mismatch"] });
  for (const [index, part] of input.parts.entries()) {
    if (
      part.index !== index ||
      part.sizeBytes > contract.partBytes ||
      (index < input.parts.length - 1 && part.sizeBytes !== contract.partBytes)
    )
      throw errors.validationFailed({ parts: ["invalid_manifest"] });
  }
}

/** FR-SRC-005: declared extensions and MIME never determine acceptance. */
export function detectBinaryMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((value, i) => bytes[i] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    return "audio/mpeg";
  if (ascii(0, 4) === "OggS" && ascii(0, Math.min(bytes.length, 256)).includes("OpusHead"))
    return "audio/ogg";
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "audio/webm";
  if (bytes.length >= 16 && ascii(4, 8) === "ftyp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let boxBytes = view.getUint32(0);
    let brandOffset = 8;
    if (boxBytes === 1) {
      // Extended-size boxes include an unsigned 64-bit size. A bounded signature
      // probe has no reason to accept a high 32-bit word or a truncated header.
      if (bytes.length < 24 || view.getUint32(8) !== 0) return null;
      boxBytes = view.getUint32(12);
      brandOffset = 16;
    }
    if (
      boxBytes < brandOffset + 8 ||
      boxBytes > Math.min(bytes.length, 4096) ||
      (boxBytes - brandOffset) % 4 !== 0
    )
      return null;
    const supportedBrands = ["M4A ", "M4B ", "isom", "mp41", "mp42", "3gp4"];
    // Mobile recordings may use 3GP as the major brand with MP4-compatible brands.
    // This identifies a container only; decoding still proves it contains audio alone.
    if (supportedBrands.includes(ascii(brandOffset, brandOffset + 4))) return "audio/mp4";
    for (let offset = brandOffset + 8; offset < boxBytes; offset += 4)
      if (supportedBrands.includes(ascii(offset, offset + 4))) return "audio/mp4";
  }
  return null;
}

/** TextDecoder is passive: bytes never become markup, a URL or executable code. */
export function decodeSourceText(bytes: Uint8Array): string {
  const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
  const utf16be = bytes[0] === 0xfe && bytes[1] === 0xff;
  try {
    const value = new TextDecoder(utf16le ? "utf-16le" : utf16be ? "utf-16be" : "utf-8", {
      fatal: true,
    }).decode(bytes);
    if (
      Array.from(value).some((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point < 32 && ![9, 10, 13].includes(point);
      })
    )
      throw errors.unsupportedMedia();
    return value;
  } catch {
    throw errors.unsupportedMedia();
  }
}
