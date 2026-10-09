import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { changeCard } from "../card";
import { createDatabase } from "../db";
import { submitReview, undoReview } from "../srs";
import { learningMemory, practiceCandidatesForRun, recordItemFeedback } from "./memory";
import { localDate } from "./memory-rules";
import { learningOverview } from "./profile";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
const day = 86400000;

async function practised(choices: ("forgot" | "remembered")[], start = new Date()) {
  const fixture = await studyFixture(db, { autoAdd: true, now: start });
  const card = fixture.cards[0];
  if (!card) throw new Error("missing fixture card");
  let version = 0,
    at = start.getTime(),
    last: Awaited<ReturnType<typeof submitReview>> | undefined;
  for (const choice of choices) {
    at += day;
    last = await submitReview(
      db,
      fixture.ctx,
      {
        eventId: randomUUID(),
        cardId: card.id,
        expectedVersion: version,
        expectedContentVersion: card.contentVersion,
        mode: "simple",
        choice,
      },
      new Date(at),
    );
    version = last.version;
  }
  return { ...fixture, card, now: new Date(at + 1000), last };
}

describe("D49 learning memory with owned review evidence (PRD-PERS-03/05)", () => {
  it("derives a dated practice suggestion from Again answers only for its owner", async () => {
    const start = new Date(Date.now() - 6 * day);
    const owner = await practised(["forgot", "remembered", "forgot"], start);
    const other = await studyFixture(db, { autoAdd: true });
    const memory = await learningMemory(db, owner.ctx, { now: owner.now });
    expect(memory.needsPractice).toHaveLength(1);
    expect(memory.needsPractice[0]).toMatchObject({
      learningItemId: owner.card.learningItemId,
      label: "Synthetic question 0",
      sessionId: owner.session.id,
      itemId: "item-0",
      evidence: { reviews: 3, again: 2, recalledSinceLastAgain: 0 },
    });
    expect(memory.lastEvidenceAt).toBe(memory.needsPractice[0]?.evidence.lastReviewedAt);
    const overview = await learningOverview(db, owner.ctx, owner.now);
    expect(overview.supportEstimate.updatedAt).toBe(memory.lastEvidenceAt);
    expect(overview.supportEstimate.level).toBeNull();
    expect(overview.repeatedMistakes[0]?.front).toBe("Synthetic question 0");
    expect((await learningMemory(db, other.ctx)).needsPractice).toEqual([]);
    expect((await learningOverview(db, other.ctx)).supportEstimate.updatedAt).toBeNull();
  });

  it("an undone answer and a deleted card change the derived memory without rewriting history", async () => {
    const start = new Date(Date.now() - 5 * day);
    const owner = await practised(["forgot", "forgot"], start);
    if (!owner.last) throw new Error("missing receipt");
    expect((await learningMemory(db, owner.ctx, { now: owner.now })).needsPractice).toHaveLength(1);
    await undoReview(db, owner.ctx, owner.last.eventId, owner.last.version, owner.now);
    expect((await learningMemory(db, owner.ctx, { now: owner.now })).needsPractice).toEqual([]);
    const card = (await db
      .selectFrom("card.card")
      .select("content_version")
      .where("id", "=", owner.card.id)
      .executeTakeFirstOrThrow()) as { content_version: number };
    await changeCard(
      db,
      owner.ctx,
      owner.card.id,
      { expectedVersion: card.content_version, action: "delete" },
      { key: randomUUID(), now: owner.now },
    );
    const memory = await learningMemory(db, owner.ctx, { now: owner.now });
    expect(memory.lastEvidenceAt).toBeNull();
    // The review history row itself is untouched.
    expect(
      await db
        .selectFrom("srs.review_event")
        .select("id")
        .where("card_id", "=", owner.card.id)
        .execute(),
    ).toHaveLength(2);
  });

  it("records corrections idempotently, scoped to owned goals, and re-opens on new evidence", async () => {
    const start = new Date(Date.now() - 6 * day);
    const owner = await practised(["forgot", "forgot"], start);
    const other = await studyFixture(db, { autoAdd: true });
    const key = randomUUID();
    const body = {
      learningItemId: owner.card.learningItemId,
      kind: "not_a_difficulty" as const,
      active: true,
    };
    expect(await recordItemFeedback(db, owner.ctx, body, { key, now: owner.now })).toEqual({
      replayed: false,
    });
    expect(await recordItemFeedback(db, owner.ctx, body, { key, now: owner.now })).toEqual({
      replayed: true,
    });
    await expect(
      recordItemFeedback(db, owner.ctx, { ...body, active: false }, { key, now: owner.now }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    await expect(
      recordItemFeedback(db, other.ctx, body, { key: randomUUID(), now: owner.now }),
    ).rejects.toMatchObject({ code: "not_found" });
    const rows = await db
      .selectFrom("pers.item_feedback")
      .select(["user_id", "evidence_order"])
      .where("learning_item_id", "=", owner.card.learningItemId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.evidence_order).not.toBeNull();
    let memory = await learningMemory(db, owner.ctx, { now: owner.now });
    expect(memory.needsPractice).toEqual([]);
    expect(memory.dismissed).toHaveLength(1);
    const later = new Date(owner.now.getTime() + day);
    const state = await db
      .selectFrom("srs.card_state")
      .select("version")
      .where("card_id", "=", owner.card.id)
      .executeTakeFirstOrThrow();
    await submitReview(
      db,
      owner.ctx,
      {
        eventId: randomUUID(),
        cardId: owner.card.id,
        expectedVersion: state.version,
        expectedContentVersion: owner.card.contentVersion,
        mode: "simple",
        choice: "forgot",
      },
      later,
    );
    memory = await learningMemory(db, owner.ctx, { now: new Date(later.getTime() + 1000) });
    expect(memory.needsPractice).toHaveLength(1);
    expect(memory.dismissed).toEqual([]);
  });

  it("selects bounded run candidates from this class and the same course only", async () => {
    const start = new Date(Date.now() - 6 * day);
    const owner = await practised(["forgot", "forgot"], start);
    await recordItemFeedback(
      db,
      owner.ctx,
      { learningItemId: owner.card.learningItemId, kind: "explain_simpler", active: true },
      { key: randomUUID(), now: owner.now },
    );
    const candidates = await db
      .transaction()
      .execute((tx) =>
        practiceCandidatesForRun(tx, owner.ctx, { sessionId: owner.session.id, now: owner.now }),
      );
    const lastAgainAt = (await learningMemory(db, owner.ctx, { now: owner.now })).needsPractice[0]
      ?.evidence.lastAgainAt;
    if (!lastAgainAt) throw new Error("missing Again evidence");
    expect(candidates).toEqual([
      {
        target: "Synthetic question 0",
        reason: "recall_difficulty",
        scope: "this_class",
        againCount: 2,
        sourceSessionId: owner.session.id,
        // The latest Again, as the learner's calendar date (the fixture uses Europe/London).
        lastEvidenceDate: localDate(lastAgainAt, "Europe/London"),
      },
    ]);
    const other = await studyFixture(db, { autoAdd: true });
    await expect(
      db
        .transaction()
        .execute((tx) => practiceCandidatesForRun(tx, other.ctx, { sessionId: owner.session.id })),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps an explain-more-simply request for runs after its answers leave the window", async () => {
    const start = new Date(Date.now() - 70 * day);
    const owner = await practised(["remembered"], start);
    const askedAt = new Date(start.getTime() + 2 * day);
    await recordItemFeedback(
      db,
      owner.ctx,
      { learningItemId: owner.card.learningItemId, kind: "explain_simpler", active: true },
      { key: randomUUID(), now: askedAt },
    );
    const now = new Date();
    const memory = await learningMemory(db, owner.ctx, { now });
    expect(memory.lastEvidenceAt).toBeNull();
    expect(memory.simplerRequests).toEqual([
      expect.objectContaining({
        learningItemId: owner.card.learningItemId,
        label: "Synthetic question 0",
        askedAt: askedAt.toISOString(),
      }),
    ]);
    const candidates = await db
      .transaction()
      .execute((tx) =>
        practiceCandidatesForRun(tx, owner.ctx, { sessionId: owner.session.id, now }),
      );
    expect(candidates).toEqual([
      {
        target: "Synthetic question 0",
        reason: "asked_simpler",
        scope: "this_class",
        againCount: 0,
        lastEvidenceDate: localDate(askedAt.toISOString(), "Europe/London"),
        sourceSessionId: owner.session.id,
      },
    ]);
    await recordItemFeedback(
      db,
      owner.ctx,
      { learningItemId: owner.card.learningItemId, kind: "explain_simpler", active: false },
      { key: randomUUID(), now },
    );
    expect((await learningMemory(db, owner.ctx, { now })).simplerRequests).toEqual([]);
  });

  it("a dismissal from a stale page does not absorb an Again saved after it was shown", async () => {
    const start = new Date(Date.now() - 6 * day);
    const owner = await practised(["forgot", "forgot"], start);
    const shown = (await learningMemory(db, owner.ctx, { now: owner.now })).needsPractice[0];
    if (!shown?.evidence.lastAgainAt) throw new Error("missing shown evidence");
    expect(shown.evidence).not.toHaveProperty("lastOrder");
    expect(shown.evidence).not.toHaveProperty("lastAgainOrder");
    // Another tab saves a new Again before the correction arrives.
    const later = new Date(owner.now.getTime() + day);
    const state = await db
      .selectFrom("srs.card_state")
      .select("version")
      .where("card_id", "=", owner.card.id)
      .executeTakeFirstOrThrow();
    await submitReview(
      db,
      owner.ctx,
      {
        eventId: randomUUID(),
        cardId: owner.card.id,
        expectedVersion: state.version,
        expectedContentVersion: owner.card.contentVersion,
        mode: "simple",
        choice: "forgot",
      },
      later,
    );
    const now = new Date(later.getTime() + 1000);
    const dismiss = (shownLastAgainAt: string | null) =>
      recordItemFeedback(
        db,
        owner.ctx,
        {
          learningItemId: owner.card.learningItemId,
          kind: "not_a_difficulty",
          active: true,
          shownLastAgainAt,
        },
        { key: randomUUID(), now },
      );
    await dismiss(shown.evidence.lastAgainAt);
    let memory = await learningMemory(db, owner.ctx, { now });
    expect(memory.needsPractice).toHaveLength(1);
    expect(memory.dismissed).toEqual([]);
    // The same correction made from the current page covers the newer Again.
    const current = memory.needsPractice[0]?.evidence.lastAgainAt ?? null;
    expect(current).not.toBe(shown.evidence.lastAgainAt);
    await dismiss(current);
    memory = await learningMemory(db, owner.ctx, { now });
    expect(memory.needsPractice).toEqual([]);
    expect(memory.dismissed).toHaveLength(1);
    await expect(
      recordItemFeedback(
        db,
        owner.ctx,
        {
          learningItemId: owner.card.learningItemId,
          kind: "not_a_difficulty",
          active: true,
          shownLastAgainAt: "yesterday",
        },
        { key: randomUUID(), now },
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("links to the class review only when the review queue offers the goal's card", async () => {
    const start = new Date(Date.now() - 6 * day);
    const owner = await practised(["forgot", "forgot"], start);
    // Just after the latest Again the card waits for its learning step: open the card instead.
    const waiting = (await learningMemory(db, owner.ctx, { now: owner.now })).needsPractice[0];
    expect(waiting).toMatchObject({ card: { due: false }, next: { kind: "open_card" } });
    const due = (await learningMemory(db, owner.ctx, { now: new Date(owner.now.getTime() + day) }))
      .needsPractice[0];
    expect(due).toMatchObject({
      card: { id: owner.card.id, due: true },
      next: { kind: "review_class", href: `/review?sessionId=${owner.session.id}` },
    });
  });
});
