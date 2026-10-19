import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { createLogger, type ObjectStore, type PltSettings } from "../plt";
import { getHtmlExport, htmlExportReadLink, htmlSnapshotSchema, listHtmlExports } from "./exports";

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

const now = new Date("2026-10-19T12:00:00Z");
function exportRow(snapshot: unknown) {
  return {
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
    snapshot,
  };
}

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
  // D100: one corrupt row is left out of the list (logged by its id only); the others still list.
  it("leaves a malformed export out of the list, logs only its id, and lists the others", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const broken = exportRow({ revisionNumber: 1, model: { title: "Synthetic class text" } });
    const valid = exportRow(written);
    const versionId = randomUUID();
    const { db, queries } = queryBudgetDatabase([
      [broken, valid],
      [{ id: written.revisionId, versionId, sessionId }],
      [{ id: versionId, session_id: sessionId }],
      [{ id: sessionId }],
      [{ id: sessionId }],
    ]);
    const listed = await listHtmlExports(db, ctx, sessionId, now, log);
    expect(listed.map((item) => item.id)).toEqual([valid.id]);
    expect(queries).toHaveLength(5);
    expect(lines).toHaveLength(1);
    const { time: _time, ...line } = JSON.parse(lines[0] as string);
    expect(line).toEqual({
      level: "error",
      event: "html_export_snapshot_invalid",
      export_id: broken.id,
    });
    expect(lines[0]).not.toContain("Synthetic");
  });
  it("still fails reading or downloading one malformed export with a controlled error", async () => {
    const broken = exportRow({ revisionNumber: 1 });
    const read = queryBudgetDatabase([[broken]]);
    await expect(getHtmlExport(read.db, ctx, broken.id, now)).rejects.toMatchObject({
      code: "internal",
      reason: "snapshot_invalid",
    });
    const download = queryBudgetDatabase([[{ id: ctx.userId }], [broken]]);
    const settings = { readLinkSeconds: 300 } as PltSettings["storage"];
    await expect(
      htmlExportReadLink(download.db, {} as ObjectStore, ctx, broken.id, settings, now),
    ).rejects.toMatchObject({ code: "internal", reason: "snapshot_invalid" });
  });
});
