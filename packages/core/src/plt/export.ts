import { z } from "zod";
import { errors } from "./errors";

/** Technical export bounds are supplied by versioned operator configuration. */
export const exportSettingsSchema = z.strictObject({
  version: z.string().min(1).max(100),
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxItems: z.number().int().positive().max(10000),
  retentionSeconds: z.number().int().positive(),
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export interface ExportArtifact {
  id: string;
  sessionId: string;
  schemaVersion: "1";
  state: "queued" | "ready" | "failed" | "deleted";
  estimatedBytes: number;
  actualBytes: number | null;
  sha256: string | null;
  createdAt: string;
  expiresAt: string;
  lastError: string | null;
}
/** One media item copied into an export snapshot; read back with this schema (QUA-05). */
export const exportMediaSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  objectId: z.string().min(1),
  sourceId: z.string().min(1).nullable(),
  kind: z.enum(["image", "tts"]),
  mimeType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
});
export type ExportMedia = z.infer<typeof exportMediaSchema>;
export interface ExportMediaBytes {
  media: ExportMedia;
  bytes: Uint8Array;
}
export function escapeExportHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function assertExportSize(bytes: number, settings: ExportSettings): void {
  if (!Number.isSafeInteger(bytes) || bytes > settings.maxBytes) throw errors.payloadTooLarge();
}
