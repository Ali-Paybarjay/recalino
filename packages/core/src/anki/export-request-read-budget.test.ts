import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { getAnkiExport, requestAnkiExport } from "./exports";

// PERF-04: an Anki export request still locks its cards one getCard after another, in the order
// the learner chose them; checking an export reads its cards in a constant number of statements.
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
  // The rows one locked getCard reads: the card, its class links and the live classes.
  const cardReads = (id: string) => [
    [cardRow(id)],
    [{ session_id: sessionId }],
    [{ id: sessionId }],
  ];

  it.each([5, 50])(
    "locks each of %i cards by its own statement, in the learner's order",
    async (count) => {
      const ids = Array.from({ length: count }, () => randomUUID());
      const { db, queries } = queryBudgetDatabase([
        [{ id: ctx.userId }],
        [],
        [sessionRow()],
        ...ids.flatMap(cardReads),
        [exportRow({})],
      ]);
      await requestAnkiExport(db, ctx, request(ids), { key: randomUUID(), settings, now });
      // The account first, then one card after another: an older lesson card's class lock, taken
      // while resolving its pronunciation, stays between that card's lock and the next card's.
      const locks = queries.filter((query) => query.sql.endsWith("for update"));
      expect(locks.map((query) => query.parameters[0])).toEqual([ctx.userId, ...ids]);
      expect(locks.slice(1).every((query) => query.sql.includes('from "card"."card"'))).toBe(true);
      expect(queries).toHaveLength(4 + 3 * count);
      const insert = queries.at(-1);
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
    },
  );

  it("checks the cards in the learner's order and stops at the first problem", async () => {
    const [first, second] = [randomUUID(), randomUUID()];
    const head = () => [[{ id: ctx.userId }], [], [sessionRow()]];
    // The first card's changed version is reported before the second card is read.
    const changed = queryBudgetDatabase([...head(), ...cardReads(first), ...cardReads(second)]);
    await expect(
      requestAnkiExport(changed.db, ctx, request([first, second], { [first]: 2 }), {
        key: randomUUID(),
        settings,
        now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(changed.queries.filter((query) => query.sql.endsWith("for update"))).toHaveLength(2);
    // A deleted first card is reported before the second card's changed version.
    const deleted = queryBudgetDatabase([...head(), [], ...cardReads(second)]);
    await expect(
      requestAnkiExport(deleted.db, ctx, request([first, second], { [second]: 2 }), {
        key: randomUUID(),
        settings,
        now,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    // A card of another learner is refused as getCard refuses it.
    const foreign = queryBudgetDatabase([
      ...head(),
      [{ ...cardRow(first), user_id: randomUUID() }],
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
