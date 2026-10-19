import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { ankiSnapshotSchema, listAnkiExports } from "./exports";

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
  it("fails a listing with a controlled error instead of reading a malformed row", async () => {
    const { db } = queryBudgetDatabase([
      [
        {
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
        },
      ],
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
          snapshot: { cards: [{ front: "no id" }] },
        },
      ],
    ]);
    await expect(
      listAnkiExports(db, ctx, sessionId, new Date("2026-10-19T12:00:00Z")),
    ).rejects.toMatchObject({ code: "internal", reason: "snapshot_invalid" });
  });
});
