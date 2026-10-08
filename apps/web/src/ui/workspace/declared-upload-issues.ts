import type { SourceRow } from "./source-types";
import type { UploadBatch } from "./upload-store";

/** Verification failures need explicit manifest actions after transport has handed off. */
export function declaredUploadIssues(
  batch: UploadBatch | undefined,
  sources: Pick<SourceRow, "assetId" | "rejectionReason" | "uploadState" | "originalDeletedAt">[],
  batchProblem: string | null,
) {
  if (batch?.phase !== "received") return [];
  return batch.entries.filter((entry) => {
    if (entry.phase === "skipped" || !entry.source) return false;
    const source = sources.find((row) => row.assetId === entry.source?.assetId);
    return source
      ? !!source.rejectionReason ||
          !!source.originalDeletedAt ||
          ["rejected", "abandoned", "deleted"].includes(source.uploadState ?? "")
      : batchProblem === "upload_needs_attention";
  });
}
