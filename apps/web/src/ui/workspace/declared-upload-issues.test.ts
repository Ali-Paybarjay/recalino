import type { InputContract } from "@recalino/core/src";
import { expect, it } from "vitest";
import { declaredUploadIssues } from "./declared-upload-issues";
import type { SourceRow } from "./source-types";
import type { UploadBatch } from "./upload-store";

function batch(): UploadBatch {
  return {
    id: "batch",
    userId: "owner",
    sessionId: "class",
    phase: "received",
    contract: {} as InputContract,
    storageConfigured: true,
    createdAt: 1,
    receipt: {
      revision: 1,
      previousRunId: null,
      sourceIds: ["source"],
      total: 1,
      failed: 0,
      startedAt: 1,
    },
    entries: [
      {
        id: "file",
        displayName: "notes.pdf",
        sizeBytes: 1,
        lastModified: 1,
        mimeType: "application/pdf",
        creationKey: "key",
        phase: "verifying",
        sentBytes: 1,
        startedAt: 1,
        serverSeen: true,
        source: { assetId: "source" } as SourceRow,
      },
    ],
  };
}
const source = {
  assetId: "source",
  uploadState: "verifying",
  rejectionReason: null,
  originalDeletedAt: null,
};
it.each(["needs_password", "wrong_password", "unsupported_media"])(
  "offers manifest recovery for a received source requiring %s",
  (rejectionReason) => {
    expect(
      declaredUploadIssues(batch(), [{ ...source, rejectionReason }], null).map(
        (entry) => entry.id,
      ),
    ).toEqual(["file"]);
  },
);
it("includes missing declarations only when server verification identifies a batch problem", () => {
  expect(declaredUploadIssues(batch(), [], "batch_open")).toEqual([]);
  expect(
    declaredUploadIssues(batch(), [], "upload_needs_attention").map((entry) => entry.id),
  ).toEqual(["file"]);
});
it("recognizes rejected and deleted sources without treating normal verification as a failure", () => {
  expect(declaredUploadIssues(batch(), [source], null)).toEqual([]);
  expect(
    declaredUploadIssues(batch(), [{ ...source, uploadState: "rejected" }], null),
  ).toHaveLength(1);
  expect(
    declaredUploadIssues(batch(), [{ ...source, originalDeletedAt: "deleted" }], null),
  ).toHaveLength(1);
});
it("does not show verification actions for cancelled, skipped or still-transferring entries", () => {
  expect(
    declaredUploadIssues({ ...batch(), phase: "cancelled" }, [], "upload_needs_attention"),
  ).toEqual([]);
  expect(
    declaredUploadIssues({ ...batch(), phase: "uploading" }, [], "upload_needs_attention"),
  ).toEqual([]);
  const skipped = batch();
  skipped.entries = skipped.entries.map((entry) => ({ ...entry, phase: "skipped" }));
  expect(declaredUploadIssues(skipped, [], "upload_needs_attention")).toEqual([]);
});
