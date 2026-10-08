import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { publishNotebook } from "../note";
import { createSession } from "../org";
import {
  changeCard,
  editCard,
  generateCards,
  getCard,
  listCardProposals,
  resolveCardProposal,
} from "./cards";
import { cleanupSessionCards, tombstoneSourceCards } from "./privacy";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
it("creates candidates, separate sister directions, no duplicate replay and explicit update proposals", async () => {
  const fixture = await studyFixture(db, { count: 1 });
  const card = fixture.cards[0];
  if (!card) throw new Error("missing fixture card");
  expect(card.status).toBe("candidate");
  const reverse = await generateCards(
    db,
    fixture.ctx,
    fixture.session.id,
    { reverse: true },
    { key: randomUUID() },
  );
  expect(reverse.cards[0]?.id).not.toBe(card.id);
  expect(reverse.cards[0]?.learningItemId).toBe(card.learningItemId);
  expect(
    (await generateCards(db, fixture.ctx, fixture.session.id, {}, { key: randomUUID() }))
      .duplicates,
  ).toBe(1);
  const accepted = await changeCard(
    db,
    fixture.ctx,
    card.id,
    { expectedVersion: card.contentVersion, action: "activate" },
    { key: randomUUID() },
  );
  expect(accepted).toMatchObject({ status: "active" });
  await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: fixture.notebook.current.id,
      edits: { items: { "item-0": { front: "Updated question" } } },
    },
    { key: randomUUID() },
  );
  expect(
    (await generateCards(db, fixture.ctx, fixture.session.id, {}, { key: randomUUID() }))
      .proposedUpdates,
  ).toBe(1);
  expect((await getCard(db, fixture.ctx, card.id)).front).toBe(card.front);
  expect((await listCardProposals(db, fixture.ctx, card.id))[0]?.front).toBe("Updated question");
});
it("preserves the old learning goal when a new one is chosen, and Undo restores suspension", async () => {
  const fixture = await studyFixture(db, { count: 1, autoAdd: true });
  const card = fixture.cards[0];
  if (!card) throw new Error("missing fixture card");
  const newGoal = await editCard(
    db,
    fixture.ctx,
    card.id,
    {
      expectedVersion: 1,
      front: "A different goal",
      back: "A different answer",
      newLearningGoal: true,
    },
    { key: randomUUID() },
  );
  expect(newGoal.id).not.toBe(card.id);
  expect((await getCard(db, fixture.ctx, card.id)).contentVersion).toBe(1);
  const suspended = await changeCard(
    db,
    fixture.ctx,
    card.id,
    { expectedVersion: 1, action: "suspend" },
    { key: randomUUID() },
  );
  expect(suspended).toMatchObject({ status: "suspended", contentVersion: 2 });
  const undone = await changeCard(
    db,
    fixture.ctx,
    card.id,
    { expectedVersion: 2, action: "undo" },
    { key: randomUUID() },
  );
  expect(undone).toMatchObject({ status: "active", contentVersion: 3 });
  await expect(
    changeCard(
      db,
      fixture.ctx,
      card.id,
      { expectedVersion: 1, action: "know" },
      { key: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "conflict" });
});
it("hides a shared card when an old revision can restore a fully deleted source, including cached responses", async () => {
  const fixture = await studyFixture(db, { count: 1, autoAdd: true });
  const card = fixture.cards[0];
  if (!card) throw new Error("missing card");
  const sourceId = randomUUID();
  const imported = await db
    .insertInto("card.proposal")
    .values({
      user_id: fixture.ctx.userId,
      card_id: card.id,
      note_revision_id: fixture.notebook.current.id,
      front: "Imported source evidence",
      back: "Imported source answer",
      fingerprint: "synthetic-source-evidence",
      provenance: JSON.stringify({
        ...card.provenance,
        sourceRefs: [
          {
            sourceId,
            contentVersionId: randomUUID(),
            locator: { kind: "page", page: 1, blockId: null },
          },
        ],
      }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await resolveCardProposal(
    db,
    fixture.ctx,
    card.id,
    imported.id,
    { expectedVersion: 1, action: "apply", newLearningGoal: false },
    { key: randomUUID() },
  );
  await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: fixture.notebook.current.id,
      edits: { items: { "item-0": { front: "Replacement evidence", back: "Replacement answer" } } },
    },
    { key: randomUUID() },
  );
  await generateCards(db, fixture.ctx, fixture.session.id, {}, { key: randomUUID() });
  const proposal = (await listCardProposals(db, fixture.ctx, card.id))[0];
  if (!proposal) throw new Error("missing replacement proposal");
  const key = randomUUID();
  const input = {
    expectedVersion: 2,
    action: "apply" as const,
    newLearningGoal: false,
  };
  const edited = await resolveCardProposal(db, fixture.ctx, card.id, proposal.id, input, { key });
  expect(edited.provenance.sourceRefs).toHaveLength(0);
  const otherClass = await createSession(db, fixture.ctx, {}, { key: randomUUID() });
  await db
    .insertInto("card.session_link")
    .values({ card_id: card.id, user_id: fixture.ctx.userId, session_id: otherClass.id })
    .execute();
  await db
    .transaction()
    .execute((tx) => tombstoneSourceCards(tx, fixture.ctx, sourceId, [fixture.session.id]));
  await expect(getCard(db, fixture.ctx, card.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(
    changeCard(
      db,
      fixture.ctx,
      card.id,
      { expectedVersion: edited.contentVersion, action: "undo" },
      { key: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    resolveCardProposal(db, fixture.ctx, card.id, proposal.id, input, { key }),
  ).rejects.toMatchObject({
    code: "not_found",
  });
  await cleanupSessionCards(db, fixture.ctx, fixture.session.id);
  expect(
    await db.selectFrom("card.revision").select("id").where("card_id", "=", card.id).execute(),
  ).toHaveLength(0);
});
it("physically removes a source-bearing proposal while preserving an unrelated shared card", async () => {
  const fixture = await studyFixture(db, { count: 1 });
  const card = fixture.cards[0];
  if (!card) throw new Error("missing card");
  const sourceId = randomUUID();
  await db
    .insertInto("card.proposal")
    .values({
      user_id: fixture.ctx.userId,
      card_id: card.id,
      note_revision_id: fixture.notebook.current.id,
      front: "Deleted proposal",
      back: "Deleted source text",
      fingerprint: "synthetic",
      provenance: JSON.stringify({
        ...card.provenance,
        sourceRefs: [
          {
            sourceId,
            contentVersionId: randomUUID(),
            locator: { kind: "page", page: 1, blockId: null },
          },
        ],
      }),
    })
    .execute();
  await db.transaction().execute((tx) => tombstoneSourceCards(tx, fixture.ctx, sourceId, []));
  expect((await getCard(db, fixture.ctx, card.id)).id).toBe(card.id);
  expect(
    await db.selectFrom("card.proposal").select("id").where("card_id", "=", card.id).execute(),
  ).toHaveLength(0);
});
