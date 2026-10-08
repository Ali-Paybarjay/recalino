import "server-only";
import { createHash } from "node:crypto";
import type { LearningSession } from "@recalino/core/note";

/** A refreshed first page must replace the browser's previous pagination snapshot. */
export function classDirectoryRevision(sessions: { items: LearningSession[]; total: number }) {
  return createHash("sha256").update(JSON.stringify(sessions)).digest("hex");
}
