import "server-only";
import { ankiExportJob, ankiExportMaintenanceJob } from "@recalino/core/anki";
import type { Database, Tx } from "@recalino/core/db";
import { type HtmlMediaReader, htmlExportJob, htmlExportMaintenanceJob } from "@recalino/core/html";
import { getMediaAsset, readMediaBytes } from "@recalino/core/media";
import {
  type ExportMedia,
  errors,
  exportSettingsSchema,
  type LearnerContext,
  ownedObjectMetadata,
} from "@recalino/core/plt";
import { getObjectStore } from "./storage";

export function exportSettings() {
  const raw = process.env.RECALINO_EXPORT_SETTINGS_JSON;
  if (!raw) return null;
  try {
    const parsed = exportSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const htmlMediaReader: HtmlMediaReader = {
  async describe(db: Database | Tx, ctx: LearnerContext, id: string): Promise<ExportMedia> {
    const asset = await getMediaAsset(db, ctx, id);
    if (
      !asset.exportAllowed ||
      asset.state !== "ready" ||
      asset.kind !== "image" ||
      !asset.objectId ||
      !asset.mimeType
    )
      throw errors.validationFailed({ media: ["explicit_export_permission_required"] });
    const object = await ownedObjectMetadata(db, ctx, asset.objectId);
    if (object.state !== "verified" || object.contentType !== asset.mimeType)
      throw errors.conflict();
    return {
      id: asset.id,
      sessionId: asset.sessionId,
      sourceId: asset.sourceId,
      objectId: asset.objectId,
      kind: asset.kind,
      mimeType: asset.mimeType,
      byteLength: object.sizeBytes,
    };
  },
  async read(db, store, ctx, expected) {
    const { bytes, asset } = await readMediaBytes(db, store, ctx, expected.id, true);
    if (asset.objectId !== expected.objectId || asset.kind !== "image") throw errors.conflict();
    return { bytes, media: await this.describe(db, ctx, asset.id) };
  },
};
export function getExportDefinition(kind: "html" | "anki") {
  const store = getObjectStore();
  if (!store || !exportSettings()) return null;
  return kind === "html" ? htmlExportJob(store, htmlMediaReader) : ankiExportJob(store);
}
export function exportJobDefinitions() {
  return [getExportDefinition("html"), getExportDefinition("anki")].filter((job) => job !== null);
}
export function exportPeriodicJobs() {
  const store = getObjectStore();
  return store ? [htmlExportMaintenanceJob(store), ankiExportMaintenanceJob(store)] : [];
}
