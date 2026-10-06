import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  publishAutomaticFixtureVersion,
  reviewAutomaticFixtureCard,
} from "../../test/automatic-learning-fixture";
import { LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { assignGeneratedKnowledgeIds, type EvidenceSource } from "../lkm";
import {
  automaticPublishNotebook,
  getNotebookRevision,
  listNotebookRevisions,
  publishNotebook,
} from "../note";
import { createSession } from "../org";
import { synchronizeAutomaticCards } from "./automatic";
import {
  changeCard,
  editCard,
  generateCards,
  getCard,
  listCardProposals,
  listCards,
} from "./cards";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());

it("automatically saves the first notes and quality cards once, while uncertain cards stay candidates", async () => {
  const x = await studyFixture(db, { count: 0 });
  const session = await createSession(db, x.ctx, {}, { key: randomUUID() });
  const model = syntheticKnowledge(2);
  if (!model.learningItems[1]) throw new Error("Missing synthetic item");
  model.learningItems[1].claim.uncertain = true;
  const knowledge = await publishAutomaticFixtureVersion(
    db,
    x.ctx,
    session.id,
    assignGeneratedKnowledgeIds(model),
  );
  const noteKey = randomUUID();
  const [first, replay] = await Promise.all([
    automaticPublishNotebook(db, x.ctx, session.id, knowledge.id, { key: noteKey }),
    automaticPublishNotebook(db, x.ctx, session.id, knowledge.id, { key: noteKey }),
  ]);
  expect(replay.current.id).toBe(first.current.id);
  expect(first.current.number).toBe(1);
  const key = randomUUID();
  const [a, b] = await Promise.all([
    synchronizeAutomaticCards(db, x.ctx, session.id, { key }),
    synchronizeAutomaticCards(db, x.ctx, session.id, { key }),
  ]);
  expect(b).toEqual(a);
  expect(a.created).toBe(2);
  const cards = await listCards(db, x.ctx, { sessionId: session.id });
  expect(cards.map((card) => card.status).sort()).toEqual(["active", "candidate"]);
  expect(await listNotebookRevisions(db, x.ctx, session.id)).toHaveLength(1);
});

it("rebases edits across regenerated IDs, preserves unmatched edits visibly and ignores stale publication callbacks", async () => {
  const x = await studyFixture(db, { count: 2 });
  const edited = await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    {
      expectedRevisionId: x.notebook.current.id,
      edits: {
        title: "My class title",
        claims: { summary: "My class summary" },
        items: {
          "item-0": { back: "My corrected answer" },
          "item-1": { front: "My retained earlier question" },
        },
      },
    },
    { key: randomUUID() },
  );
  const model = syntheticKnowledge(1);
  if (!model.learningItems[0]) throw new Error("Missing synthetic item");
  model.learningItems[0].back = "New generated answer";
  const knowledge = await publishAutomaticFixtureVersion(
    db,
    x.ctx,
    x.session.id,
    assignGeneratedKnowledgeIds(model),
  );
  const saved = await automaticPublishNotebook(db, x.ctx, x.session.id, knowledge.id, {
    key: randomUUID(),
  });
  expect(saved.current.model.title).toBe("My class title");
  expect(saved.current.model.summary[0]?.text).toBe("My class summary");
  expect(saved.current.model.learningItems[0]?.back).toBe("My corrected answer");
  const newItemId = saved.current.model.learningItems[0]?.id;
  expect(newItemId).not.toBe("item-0");
  expect(saved.current.edits.items[newItemId ?? "missing"]?.back).toBe("My corrected answer");
  expect(saved.current.edits.items["item-1"]?.front).toBe("My retained earlier question");
  expect((await getNotebookRevision(db, x.ctx, edited.current.id)).model).toEqual(
    edited.current.model,
  );
  const manual = await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    {
      expectedRevisionId: saved.current.id,
      edits: { items: { [newItemId ?? "missing"]: { front: "My later question edit" } } },
    },
    { key: randomUUID() },
  );
  const stale = await automaticPublishNotebook(db, x.ctx, x.session.id, x.knowledge.id, {
    key: randomUUID(),
  });
  expect(stale.current.id).toBe(manual.current.id);
  expect(stale.current.model.learningItems[0]?.front).toBe("My later question edit");
});

it("updates unchanged learning goals in place and preserves review history, media and discarded or edited card choices", async () => {
  const x = await studyFixture(db, { count: 4, autoAdd: true });
  const [reviewed, edited, rejected, deleted] = x.cards;
  if (!reviewed || !edited || !rejected || !deleted) throw new Error("Missing fixture cards");
  await reviewAutomaticFixtureCard(
    db,
    x.ctx,
    reviewed.id,
    reviewed.contentVersion,
    new Date(x.now.getTime() + 1000),
  );
  const known = await changeCard(
    db,
    x.ctx,
    reviewed.id,
    { expectedVersion: 1, action: "know" },
    { key: randomUUID() },
  );
  if ("deleted" in known) throw new Error("Known-card action unexpectedly deleted the card");
  await editCard(
    db,
    x.ctx,
    edited.id,
    {
      expectedVersion: 1,
      front: edited.front,
      back: "My card-specific answer",
      newLearningGoal: false,
    },
    { key: randomUUID() },
  );
  await changeCard(
    db,
    x.ctx,
    rejected.id,
    { expectedVersion: 1, action: "reject" },
    { key: randomUUID() },
  );
  await changeCard(
    db,
    x.ctx,
    deleted.id,
    { expectedVersion: 1, action: "delete" },
    { key: randomUUID() },
  );
  const media = await db
    .insertInto("media.asset")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      kind: "image",
      state: "queued",
      synthetic: false,
      cache_key: randomUUID(),
      generation: "{}",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      request: "{}",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .updateTable("card.card")
    .set({ front_media_id: media.id })
    .where("id", "=", reviewed.id)
    .execute();
  const state = await db
    .selectFrom("srs.card_state")
    .selectAll()
    .where("card_id", "=", reviewed.id)
    .executeTakeFirstOrThrow();
  const events = await db
    .selectFrom("srs.review_event")
    .selectAll()
    .where("card_id", "=", reviewed.id)
    .execute();
  const model = syntheticKnowledge(5);
  for (const item of model.learningItems) item.back = `Updated answer for ${item.front}`;
  const knowledge = await publishAutomaticFixtureVersion(
    db,
    x.ctx,
    x.session.id,
    assignGeneratedKnowledgeIds(model),
  );
  await automaticPublishNotebook(db, x.ctx, x.session.id, knowledge.id, { key: randomUUID() });
  const result = await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() });
  expect(result).toMatchObject({ created: 1, updated: 1, proposed: 1, retained: 2 });
  const after = await getCard(db, x.ctx, reviewed.id);
  expect(after).toMatchObject({
    id: reviewed.id,
    learningItemId: reviewed.learningItemId,
    status: "known",
    frontMediaId: media.id,
  });
  expect(after.contentVersion).toBe(known.contentVersion + 1);
  expect(after.back).toContain("Updated answer");
  expect((await getCard(db, x.ctx, edited.id)).back).toBe("My card-specific answer");
  expect(await listCardProposals(db, x.ctx, edited.id)).toHaveLength(1);
  expect((await getCard(db, x.ctx, rejected.id)).status).toBe("rejected");
  expect(
    await db.selectFrom("card.card").select("id").where("user_id", "=", x.ctx.userId).execute(),
  ).toHaveLength(5);
  expect(
    await db
      .selectFrom("srs.card_state")
      .selectAll()
      .where("card_id", "=", reviewed.id)
      .executeTakeFirstOrThrow(),
  ).toEqual(state);
  expect(
    await db
      .selectFrom("srs.review_event")
      .selectAll()
      .where("card_id", "=", reviewed.id)
      .execute(),
  ).toEqual(events);
  const rerun = await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() });
  expect(rerun.created).toBe(0);
  expect(rerun.updated).toBe(0);
  expect(await listCardProposals(db, x.ctx, edited.id)).toHaveLength(1);
  const manual = await generateCards(
    db,
    x.ctx,
    x.session.id,
    { itemIds: [knowledge.model.learningItems[0]?.id ?? "missing"] },
    { key: randomUUID() },
  );
  // Existing manual generation cannot mint a second card for the already synchronized content.
  expect(manual.cards[0]?.id).toBe(reviewed.id);
});

it("rejects foreign sessions and knowledge before automatic note/card effects", async () => {
  const [x, foreign] = await Promise.all([studyFixture(db), studyFixture(db)]);
  await expect(
    automaticPublishNotebook(db, x.ctx, x.session.id, foreign.knowledge.id, { key: randomUUID() }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    synchronizeAutomaticCards(db, x.ctx, foreign.session.id, { key: randomUUID() }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(await listNotebookRevisions(db, x.ctx, x.session.id)).toHaveLength(1);
});

it("keeps card goals and note corrections when additional sources corroborate the same questions", async () => {
  const x = await studyFixture(db, { count: 0 });
  const session = await createSession(db, x.ctx, {}, { key: randomUUID() });
  const sources: EvidenceSource[] = Array.from({ length: 2 }, () => ({
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    kind: "text",
    role: "class_material",
    units: [{ id: "document", kind: "document", start: 1 }],
    blocks: [{ id: "paragraph", unitId: "document", text: "A verified learning explanation." }],
  }));
  const model = (evidence: EvidenceSource[], answer: string) => {
    const value = syntheticKnowledge(2);
    for (const item of value.learningItems) {
      item.back = `${answer} ${item.front}`;
      item.claim.origin = "from_class";
      item.claim.evidence = "material";
      item.claim.sourceRefs = evidence.map((source) => ({
        sourceId: source.sourceId,
        contentVersionId: source.contentVersionId ?? "",
        locator: { kind: "text", blockId: "paragraph", start: 0, end: 10 },
      }));
    }
    return assignGeneratedKnowledgeIds(value);
  };
  const first = await publishAutomaticFixtureVersion(
    db,
    x.ctx,
    session.id,
    model(sources.slice(0, 1), "Original answer"),
    sources.slice(0, 1),
  );
  const notebook = await automaticPublishNotebook(db, x.ctx, session.id, first.id, {
    key: randomUUID(),
  });
  await synchronizeAutomaticCards(db, x.ctx, session.id, { key: randomUUID() });
  const cards = await listCards(db, x.ctx, { sessionId: session.id });
  const reviewed = cards.find((card) => card.front === "Synthetic question 0");
  const rejected = cards.find((card) => card.front === "Synthetic question 1");
  const editedItem = first.model.learningItems[1];
  if (!reviewed || !rejected || !editedItem) throw new Error("Missing expanded-source fixture");
  await reviewAutomaticFixtureCard(db, x.ctx, reviewed.id, reviewed.contentVersion, new Date());
  const state = await db
    .selectFrom("srs.card_state")
    .selectAll()
    .where("card_id", "=", reviewed.id)
    .executeTakeFirstOrThrow();
  await changeCard(
    db,
    x.ctx,
    rejected.id,
    { expectedVersion: rejected.contentVersion, action: "reject" },
    { key: randomUUID() },
  );
  await publishNotebook(
    db,
    x.ctx,
    session.id,
    {
      expectedRevisionId: notebook.current.id,
      edits: { items: { [editedItem.id]: { back: "My retained answer" } } },
    },
    { key: randomUUID() },
  );
  const latest = await publishAutomaticFixtureVersion(
    db,
    x.ctx,
    session.id,
    model(sources, "More complete answer"),
    sources,
  );
  const saved = await automaticPublishNotebook(db, x.ctx, session.id, latest.id, {
    key: randomUUID(),
  });
  expect(saved.current.model.learningItems[1]?.id).not.toBe(editedItem.id);
  expect(saved.current.model.learningItems[1]?.back).toBe("My retained answer");
  expect(
    await synchronizeAutomaticCards(db, x.ctx, session.id, { key: randomUUID() }),
  ).toMatchObject({
    created: 0,
    updated: 1,
    retained: 1,
  });
  expect(await getCard(db, x.ctx, reviewed.id)).toMatchObject({
    learningItemId: reviewed.learningItemId,
    back: "More complete answer Synthetic question 0",
  });
  expect((await getCard(db, x.ctx, rejected.id)).status).toBe("rejected");
  expect(await listCards(db, x.ctx, { sessionId: session.id })).toHaveLength(2);
  expect(
    await db
      .selectFrom("srs.card_state")
      .selectAll()
      .where("card_id", "=", reviewed.id)
      .executeTakeFirstOrThrow(),
  ).toEqual(state);
});
