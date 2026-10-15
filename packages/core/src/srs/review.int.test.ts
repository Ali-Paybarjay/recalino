import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { generateCards, listCards } from "../card";
import { createDatabase } from "../db";
import {
  cardsOfferedForReview,
  getReviewQueue,
  getReviewSettings,
  submitReview,
  undoReview,
  updateReviewSettings,
} from "./review";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
it("undoes the last committed answer when different cards share a timestamp", async () => {
  const fixture = await studyFixture(db, { count: 2, autoAdd: true });
  const first = fixture.cards[0],
    second = fixture.cards[1];
  if (!first || !second) throw new Error("missing fixture cards");
  const now = new Date(fixture.now.getTime() + 1000);
  await submitReview(
    db,
    fixture.ctx,
    {
      eventId: `ffff${randomUUID().slice(4)}`,
      cardId: first.id,
      expectedVersion: 0,
      expectedContentVersion: 1,
      mode: "simple",
      choice: "remembered",
    },
    now,
  );
  const last = await submitReview(
    db,
    fixture.ctx,
    {
      eventId: `0000${randomUUID().slice(4)}`,
      cardId: second.id,
      expectedVersion: 0,
      expectedContentVersion: 1,
      mode: "simple",
      choice: "remembered",
    },
    now,
  );
  expect(await undoReview(db, fixture.ctx, last.eventId, last.version, now)).toMatchObject({
    version: 2,
  });
  const queue = await getReviewQueue(db, fixture.ctx, { now });
  expect(queue.hasCards).toBe(true);
  expect(queue.cards.find((item) => item.card.id === second.id)?.schedule).toMatchObject({
    version: 2,
    introducedAt: null,
  });
});
it("applies a retried review once and rejects conflicting answers from two devices", async () => {
  const fixture = await studyFixture(db, { count: 2, autoAdd: true });
  const first = fixture.cards[0],
    second = fixture.cards[1];
  if (!first || !second) throw new Error("missing fixture cards");
  const now = new Date(fixture.now.getTime() + 1000);
  const input = {
    eventId: randomUUID(),
    cardId: first.id,
    expectedVersion: 0,
    expectedContentVersion: 1,
    mode: "simple" as const,
    choice: "remembered" as const,
    durationMs: 1234,
  };
  const [a, b] = await Promise.all([
    submitReview(db, fixture.ctx, input, now),
    submitReview(db, fixture.ctx, input, now),
  ]);
  expect(a).toEqual(b);
  expect(a.rating).toBe(3);
  expect(
    await db
      .selectFrom("srs.review_event")
      .selectAll()
      .where("user_id", "=", fixture.ctx.userId)
      .execute(),
  ).toHaveLength(1);
  await expect(
    submitReview(db, fixture.ctx, { ...input, choice: "forgot" }, now),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  const other = { ...input, cardId: second.id };
  const results = await Promise.allSettled([
    submitReview(db, fixture.ctx, { ...other, eventId: randomUUID() }, now),
    submitReview(db, fixture.ctx, { ...other, eventId: randomUUID(), choice: "forgot" }, now),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.find((item) => item.status === "rejected")).toMatchObject({
    reason: { code: "conflict" },
  });
});
it("enforces the daily new cap, buries sisters and restores an undone review without erasing history", async () => {
  const fixture = await studyFixture(db, { count: 3, autoAdd: true });
  const now = new Date(fixture.now.getTime() + 1000);
  await generateCards(
    db,
    fixture.ctx,
    fixture.session.id,
    { reverse: true, autoAdd: true },
    { key: randomUUID() },
  );
  await updateReviewSettings(db, fixture.ctx, {
    ...(await getReviewSettings(db, fixture.ctx)),
    dailyNewLimit: 1,
  });
  const queue = await getReviewQueue(db, fixture.ctx, { now });
  expect(queue.cards).toHaveLength(1);
  const card = queue.cards[0]?.card;
  if (!card) throw new Error("missing queue card");
  const receipt = await submitReview(
    db,
    fixture.ctx,
    {
      eventId: randomUUID(),
      cardId: card.id,
      expectedVersion: 0,
      expectedContentVersion: 1,
      mode: "advanced",
      choice: "good",
    },
    now,
  );
  const after = await getReviewQueue(db, fixture.ctx, { now });
  expect(after.newRemaining).toBe(0);
  expect(after.buriedSiblings).toBeGreaterThan(0);
  expect(after.cards).toHaveLength(0);
  const another = fixture.cards.find((item) => item.learningItemId !== card.learningItemId);
  if (!another) throw new Error("missing different card");
  await expect(
    submitReview(
      db,
      fixture.ctx,
      {
        eventId: randomUUID(),
        cardId: another.id,
        expectedVersion: 0,
        expectedContentVersion: 1,
        mode: "simple",
        choice: "remembered",
      },
      now,
    ),
  ).rejects.toMatchObject({ code: "validation_failed" });
  const undo = await undoReview(
    db,
    fixture.ctx,
    receipt.eventId,
    receipt.version,
    new Date(now.getTime() + 100),
  );
  expect(undo.version).toBe(2);
  expect((await getReviewQueue(db, fixture.ctx, { now })).newRemaining).toBe(1);
  expect(await undoReview(db, fixture.ctx, receipt.eventId, receipt.version)).toEqual(undo);
  expect(
    await db
      .selectFrom("srs.review_event")
      .selectAll()
      .where("user_id", "=", fixture.ctx.userId)
      .execute(),
  ).toHaveLength(1);
});

it("D79: reviews every card set in one queue, core cards first, under one daily introduction quota", async () => {
  const fixture = await studyFixture(db, { count: 35, autoAdd: true });
  const now = new Date(fixture.now.getTime() + 1000);
  await db.transaction().execute(async (tx) => {
    for (const [index, card] of fixture.cards.entries()) {
      await tx
        .updateTable("card.card")
        .set({
          study_metadata: JSON.stringify({
            contentFormat: "lesson_html",
            studySet: index < 30 ? "recognition" : "production",
            studyTags: [index < 30 ? "recognition" : "production"],
            studyPosition: index,
          }),
        })
        .where("id", "=", card.id)
        .where("user_id", "=", fixture.ctx.userId)
        .execute();
    }
  });
  const settings = await getReviewSettings(db, fixture.ctx);
  await updateReviewSettings(db, fixture.ctx, { ...settings, dailyNewLimit: 100 });
  const combined = await getReviewQueue(db, fixture.ctx, { sessionId: fixture.session.id, now });
  expect(combined.cards).toHaveLength(30);
  expect(combined.cards.slice(0, 5).map((item) => item.card.studySet)).toEqual(
    Array(5).fill("production"),
  );
  expect(combined.cards.slice(5).every((item) => item.card.studySet === "recognition")).toBe(true);
  expect(combined.newRemaining).toBe(100);

  await updateReviewSettings(db, fixture.ctx, { ...settings, dailyNewLimit: 1 });
  const limited = await getReviewQueue(db, fixture.ctx, { now });
  expect(limited.cards).toHaveLength(1);
  const first = limited.cards[0];
  if (!first) throw new Error("Missing production fixture");
  expect(first.card.studySet).toBe("production");
  await submitReview(
    db,
    fixture.ctx,
    {
      eventId: randomUUID(),
      cardId: first.card.id,
      expectedVersion: first.schedule.version,
      expectedContentVersion: first.card.contentVersion,
      mode: "simple",
      choice: "remembered",
    },
    now,
  );
  const capped = await getReviewQueue(db, fixture.ctx, { now });
  expect(capped.cards).toEqual([]);
  expect(capped.newRemaining).toBe(0);
});
it("D49: offers exactly the cards the review queue shows, including sibling burying", async () => {
  const today = new Date();
  const base = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 10, 10),
  );
  const fixture = await studyFixture(db, { count: 1, autoAdd: true, now: base });
  await generateCards(
    db,
    fixture.ctx,
    fixture.session.id,
    { reverse: true, autoAdd: true },
    { key: randomUUID(), now: base },
  );
  const cards = await listCards(db, fixture.ctx, { sessionId: fixture.session.id });
  const [a, b] = cards;
  if (!a || !b || a.learningItemId !== b.learningItemId) throw new Error("missing sibling cards");
  const answer = (cardId: string, version: number, at: Date) =>
    submitReview(
      db,
      fixture.ctx,
      {
        eventId: randomUUID(),
        cardId,
        expectedVersion: version,
        expectedContentVersion: 1,
        mode: "simple",
        choice: "forgot",
      },
      at,
    );
  const hour = 3600000;
  await answer(a.id, 0, new Date(base.getTime() + 1000));
  const nextDay = new Date(base.getTime() + 24 * hour);
  await answer(b.id, 0, nextDay);
  const compare = async (now: Date) => {
    const offered = await cardsOfferedForReview(db, fixture.ctx, cards, now);
    const queue = await getReviewQueue(db, fixture.ctx, { sessionId: fixture.session.id, now });
    expect([...offered].sort()).toEqual(
      queue.cards
        .filter((item) => item.schedule.introducedAt)
        .map((item) => item.card.id)
        .sort(),
    );
    return offered;
  };
  // Same study day as B's answer: A is due but buried by its sibling; B is offered.
  const sameDay = await compare(new Date(nextDay.getTime() + 2 * hour));
  expect(sameDay.has(a.id)).toBe(false);
  expect(sameDay.has(b.id)).toBe(true);
  // A later day buries nothing.
  const later = await compare(new Date(nextDay.getTime() + 24 * hour));
  expect([...later].sort()).toEqual([a.id, b.id].sort());
  // Another account's view of these cards offers nothing.
  const other = await studyFixture(db, { autoAdd: true });
  expect((await cardsOfferedForReview(db, other.ctx, cards, nextDay)).size).toBe(0);
});
