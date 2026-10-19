import "server-only";
import type { Database } from "@recalino/core/db";
import {
  type AdminDirectory,
  type AdminSnapshot,
  type AdminSnapshotParameters,
  readAdminSnapshot as readCoreAdminSnapshot,
} from "@recalino/core/ops";
import { emailConfigStatus } from "@recalino/core/support";
import approvedPilot from "../../../../config/pilot-defaults.json";
import { getAiProvider } from "./ai";
import { EXPECTED_SCHEMA_VERSION } from "./schema-version.generated";

export type { AdminDirectory, AdminSnapshotParameters } from "@recalino/core/ops";

/** The owner guard belongs to the gateway; framework and environment configuration stay here. */
export function readAdminSnapshot(
  db: Database,
  params: AdminSnapshotParameters,
  directory: AdminDirectory,
  env: Record<string, string | undefined> = process.env,
): Promise<AdminSnapshot> {
  return readCoreAdminSnapshot(db, params, directory, {
    approvedPilot,
    email: emailConfigStatus(env),
    aiConfigured: !!getAiProvider(env),
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
  });
}
