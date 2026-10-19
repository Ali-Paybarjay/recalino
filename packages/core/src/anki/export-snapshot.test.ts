import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { createLogger, type ObjectStore, type PltSettings } from "../plt";
import { ankiExportReadLink, ankiSnapshotSchema, getAnkiExport, listAnkiExports } from "./exports";

// QUA-05: anki.export_artifact.snapshot is read through its schema.
const ctx = { userId: randomUUID(), requestId: "anki-export-snapshot" };
const sessionId = randomUUID();
const card = {
  id: randomUUID(),
  template: "vocabulary",
  direction: "forward",
  front: "Synthetic front",
  back: "Synthetic back",
  provenance: { text: "Synthetic claim", origin: "from_class", sourceRefs: [] },
  contentVersion: 3,
  frontMediaId: null,
  backMediaId: randomUUID(),
  contentFormat: "lesson_html",
  studySet: "production",
  studyTags: ["synthetic"],
};
const written = {
  sessionId,
  title: "Synthetic session",
  cards: [card],
  tags: ["recalino"],
  createdAt: "2026-10-19T11:00:00.000Z",
  media: [
    {
      id: card.backMediaId,
      sessionId,
      objectId: randomUUID(),
      sourceId: null,
      kind: "tts",
      mimeType: "audio/mpeg",
      byteLength: 2048,
    },
  ],
};

const now = new Date("2026-10-19T12:00:00Z");
function sessionRow() {
  return {
    id: sessionId,
    owner_id: ctx.userId,
    course_id: randomUUID(),
    unit_id: null,
    title: "Synthetic session",
    class_date: "2026-10-18",
    sources_version: 1,
    created_at: new Date(0),
    updated_at: new Date(0),
    deleted_at: null,
  };
}
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

describe("Anki export snapshot (QUA-05)", () => {
  it("accepts a snapshot as requestAnkiExport writes it, and cards without study metadata", () => {
    expect(ankiSnapshotSchema.parse(written)).toEqual(written);
    const { contentFormat: _f, studySet: _s, studyTags: _t, ...plain } = card;
    expect(ankiSnapshotSchema.parse({ ...written, cards: [plain] }).cards).toEqual([plain]);
  });
  it("rejects a card or media item that lost what the package needs", () => {
    const { front: _front, ...noFront } = card;
    expect(ankiSnapshotSchema.safeParse({ ...written, cards: [noFront] }).success).toBe(false);
    expect(ankiSnapshotSchema.safeParse({ ...written, media: [{}] }).success).toBe(false);
  });
  // D100: one corrupt row is left out of the list (logged by its id only); the others still list.
  it("leaves a malformed export out of the list, logs only its id, and lists the others", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const broken = exportRow({ cards: [{ front: "Synthetic class text" }] });
    const valid = exportRow(written);
    const { db, queries } = queryBudgetDatabase([
      [sessionRow()],
      [broken, valid],
      [{ id: card.id }],
      [{ card_id: card.id, session_id: sessionId }],
      [{ id: sessionId }],
    ]);
    const listed = await listAnkiExports(db, ctx, sessionId, now, log);
    expect(listed.map((item) => item.id)).toEqual([valid.id]);
    expect(queries).toHaveLength(5);
    expect(lines).toHaveLength(1);
    const { time: _time, ...line } = JSON.parse(lines[0] as string);
    expect(line).toEqual({
      level: "error",
      event: "anki_export_snapshot_invalid",
      export_id: broken.id,
    });
    expect(lines[0]).not.toContain("Synthetic");
  });
  it("still fails reading or downloading one malformed export with a controlled error", async () => {
    const broken = exportRow({ cards: [{ front: "no id" }] });
    const read = queryBudgetDatabase([[broken], [sessionRow()]]);
    await expect(getAnkiExport(read.db, ctx, broken.id, now)).rejects.toMatchObject({
      code: "internal",
      reason: "snapshot_invalid",
    });
    const download = queryBudgetDatabase([[{ id: ctx.userId }], [broken], [sessionRow()]]);
    const settings = { readLinkSeconds: 300 } as PltSettings["storage"];
    await expect(
      ankiExportReadLink(download.db, {} as ObjectStore, ctx, broken.id, settings, now),
    ).rejects.toMatchObject({ code: "internal", reason: "snapshot_invalid" });
  });
});
