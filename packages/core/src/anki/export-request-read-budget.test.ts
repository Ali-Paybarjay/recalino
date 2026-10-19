import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { getAnkiExport, requestAnkiExport } from "./exports";

// PERF-04: an Anki export reads and locks its cards in a constant number of statements, in the
// order the learner chose them, and checks each card in that order as before.
const ctx = { userId: randomUUID(), requestId: "export-request-read-budget" };
const sessionId = randomUUID();
const now = new Date("2026-10-19T12:00:00Z");
const settings = {
  version: "test-1",
  maxBytes: 10_000_000,
  maxItems: 1000,
  retentionSeconds: 3600,
};

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
function cardRow(id: string, contentVersion = 1) {
  return {
    id,
    user_id: ctx.userId,
    learning_item_id: randomUUID(),
    template: "basic",
    direction: "forward",
    front: `front ${id}`,
    back: "back",
    provenance: {
      id: "claim-1",
      text: "Synthetic claim.",
      origin: "from_class",
      creation: "ai_generation",
      evidence: "material",
      sourceRefs: [],
      speakerRole: "unknown",
      uncertain: false,
    },
    status: "active",
    content_version: contentVersion,
    important: false,
    quality_confirmed: false,
    front_media_id: null,
    back_media_id: null,
    study_metadata: null,
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
    state: "queued",
    estimated_bytes: "100",
    actual_bytes: null,
    sha256: null,
    created_at: now,
    expires_at: new Date(now.getTime() + 3_600_000),
    last_error: null,
    tombstoned_at: null,
    object_id: null,
    snapshot,
  };
}
const request = (cardIds: string[], expectedVersions?: Record<string, number>) => ({
  sessionId,
  cardIds,
  tags: [],
  includeMedia: false,
  ...(expectedVersions ? { expectedVersions } : {}),
});

describe("Anki export request read budget (PERF-04)", () => {
  it.each([5, 50])("reads and locks %i cards in a fixed number of statements", async (count) => {
    const ids = Array.from({ length: count }, () => randomUUID());
    const rows = ids.map((id) => cardRow(id));
    const { db, queries } = queryBudgetDatabase([
      [{ id: ctx.userId }],
      [],
      [sessionRow()],
      // The database may return the rows in any order; the export keeps the learner's order.
      [...rows].reverse(),
      ids.map((id) => ({ card_id: id, session_id: sessionId })),
      [{ id: sessionId }],
      [exportRow({})],
    ]);
    await requestAnkiExport(db, ctx, request(ids), { key: randomUUID(), settings, now });
    expect(queries).toHaveLength(7);
    const cards = queries[3];
    expect(cards?.sql).toContain('from "card"."card"');
    expect(cards?.sql).toContain("order by array_position($");
    expect(cards?.sql.endsWith("for update")).toBe(true);
    expect(cards?.parameters).toContainEqual(ids);
    const insert = queries[6];
    expect(insert?.sql).toContain('insert into "anki"."export_artifact"');
    const snapshot = JSON.parse(insert?.parameters[5] as string);
    expect(snapshot.cards.map((card: { id: string }) => card.id)).toEqual(ids);
    expect(snapshot.cards[0]).toEqual({
      id: ids[0],
      template: "basic",
      direction: "forward",
      front: `front ${ids[0]}`,
      back: "back",
      provenance: cardRow(ids[0] as string).provenance,
      contentVersion: 1,
      frontMediaId: null,
      backMediaId: null,
    });
  });

  it("checks the cards in the learner's order, as one read per card did", async () => {
    const [first, second] = [randomUUID(), randomUUID()];
    const rows = (included: string[]) =>
      queryBudgetDatabase([
        [{ id: ctx.userId }],
        [],
        [sessionRow()],
        included.map((id) => cardRow(id)),
        included.map((id) => ({ card_id: id, session_id: sessionId })),
        [{ id: sessionId }],
      ]).db;
    // The first card's changed version is reported before the second card's deletion.
    await expect(
      requestAnkiExport(rows([first]), ctx, request([first, second], { [first]: 2 }), {
        key: randomUUID(),
        settings,
        now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    // A deleted first card is reported before the second card's changed version.
    await expect(
      requestAnkiExport(rows([second]), ctx, request([first, second], { [second]: 2 }), {
        key: randomUUID(),
        settings,
        now,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    // A card of another learner is refused as getCard refuses it.
    const foreign = queryBudgetDatabase([
      [{ id: ctx.userId }],
      [],
      [sessionRow()],
      [{ ...cardRow(first), user_id: randomUUID() }],
      [],
    ]).db;
    await expect(
      requestAnkiExport(foreign, ctx, request([first]), { key: randomUUID(), settings, now }),
    ).rejects.toMatchObject({ code: "not_found", securitySignal: "ownership_denied" });
  });

  it.each([5, 50])("checks an export of %i cards in a fixed number of reads", async (count) => {
    const ids = Array.from({ length: count }, () => randomUUID());
    const row = exportRow({ cards: ids.map((id) => ({ id })) });
    const { db, queries } = queryBudgetDatabase([
      [row],
      [sessionRow()],
      ids.map((id) => cardRow(id)),
      ids.map((id) => ({ card_id: id, session_id: sessionId })),
      [{ id: sessionId }],
    ]);
    expect((await getAnkiExport(db, ctx, row.id, now)).id).toBe(row.id);
    expect(queries).toHaveLength(5);
    expect(queries[2]?.sql).not.toContain("for update");
  });
});
