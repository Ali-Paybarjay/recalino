import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { htmlSnapshotSchema, listHtmlExports } from "./exports";

// QUA-05: html.export_artifact.snapshot is read through its schema.
const ctx = { userId: randomUUID(), requestId: "html-export-snapshot" };
const sessionId = randomUUID();
const media = {
  id: randomUUID(),
  sessionId,
  objectId: randomUUID(),
  sourceId: null,
  kind: "image",
  mimeType: "image/png",
  byteLength: 120,
};
const written = {
  revisionId: randomUUID(),
  revisionNumber: 2,
  model: { schemaVersion: "synthetic", title: "Synthetic class", summary: [] },
  createdAt: "2026-10-19T11:00:00.000Z",
  media: [media],
};

describe("HTML export snapshot (QUA-05)", () => {
  it("accepts a snapshot as requestHtmlExport writes it, unchanged", () => {
    expect(htmlSnapshotSchema.parse(written)).toEqual(written);
    expect(htmlSnapshotSchema.parse({ ...written, media: [] })).toEqual({ ...written, media: [] });
  });
  it("rejects a snapshot that lost what rendering needs", () => {
    for (const key of ["revisionId", "revisionNumber", "model", "media"] as const) {
      const { [key]: _removed, ...rest } = written;
      expect(htmlSnapshotSchema.safeParse(rest).success, key).toBe(false);
    }
    expect(htmlSnapshotSchema.safeParse({ ...written, media: [{ id: media.id }] }).success).toBe(
      false,
    );
  });
  it("fails a listing with a controlled error instead of reading a malformed row", async () => {
    const { db } = queryBudgetDatabase([
      [
        {
          id: randomUUID(),
          user_id: ctx.userId,
          session_id: sessionId,
          state: "ready",
          estimated_bytes: "100",
          actual_bytes: "90",
          sha256: "0".repeat(64),
          created_at: new Date("2026-10-19T11:00:00Z"),
          expires_at: new Date("2026-10-20T11:00:00Z"),
          last_error: null,
          tombstoned_at: null,
          snapshot: { revisionNumber: 1 },
        },
      ],
    ]);
    await expect(
      listHtmlExports(db, ctx, sessionId, new Date("2026-10-19T12:00:00Z")),
    ).rejects.toMatchObject({ code: "internal", reason: "snapshot_invalid" });
  });
});
