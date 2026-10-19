import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { listAnkiExports } from "./exports";

// PERF-04: listing a session's Anki exports checks every export's cards in a constant number of
// owner-scoped reads, not one chain of reads per export and card.
const ctx = { userId: randomUUID(), requestId: "export-list-read-budget" };
const sessionId = randomUUID();
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

describe("export listing read budget (PERF-04)", () => {
  it.each([5, 50])(
    "lists three Anki exports of %i cards each in five queries, hiding one with a deleted card",
    async (count) => {
      const decks = Array.from({ length: 3 }, () =>
        Array.from({ length: count }, () => ({ id: randomUUID() })),
      );
      const rows = decks.map((cards) => exportRow({ cards }));
      const deleted = decks[1]?.[0]?.id;
      const kept = decks.flat().filter((card) => card.id !== deleted);
      const { db, queries } = queryBudgetDatabase([
        [sessionRow()],
        rows,
        kept.map((card) => ({ id: card.id })),
        kept.map((card) => ({ card_id: card.id, session_id: sessionId })),
        [{ id: sessionId }],
      ]);
      const listed = await listAnkiExports(db, ctx, sessionId, now);
      expect(queries).toHaveLength(5);
      expect(queries[2]?.sql).toContain('from "card"."card"');
      expect(queries[2]?.sql).toContain('"deleted_at" is null');
      expect(listed.map((item) => item.id)).toEqual([rows[0]?.id, rows[2]?.id]);
    },
  );
});
