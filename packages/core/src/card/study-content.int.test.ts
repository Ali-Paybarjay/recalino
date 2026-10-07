import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { lexicalFrameModel } from "../../test/lexical-frame-fixture";
import { LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../test/multilingual-study-fixture";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { studyFixture } from "../../test/study-fixture";
import { updateProfile } from "../acc";
import { createDatabase } from "../db";
import { buildStudyAnkiText, publishKnowledgeVersion, renderStudyCard } from "../lkm";
import { publishNotebook } from "../note";
import { createSession } from "../org";
import { synchronizeAutomaticCards } from "./automatic";
import {
  changeCard,
  editCard,
  generateCards,
  getCard,
  listCardProposals,
  listCards,
  resolveCardProposal,
} from "./cards";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 3 });
afterAll(() => db.destroy());

it("AC-D46-01 never publishes a complement-only cloze and saves the lexical pronunciation of a valid frame", async () => {
  const x = await studyFixture(db, { count: 0 });
  const publish = (model: ReturnType<typeof lexicalFrameModel>) =>
    db.transaction().execute((tx) =>
      publishKnowledgeVersion(tx, x.ctx, {
        sessionId: x.session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: "lexical-frame-regression",
        model,
        sources: [],
        explanationLanguage: "en",
        generation: { mode: "mock", provider: "synthetic-frame-regression" },
      }),
    );
  await expect(
    publish(lexicalFrameModel({ gapSentence: "I look forward to ______ my new neighbours." })),
  ).rejects.toMatchObject({ details: { fields: { output: ["study_answer_exposed"] } } });
  const valid = await publish(lexicalFrameModel());
  await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    { expectedRevisionId: x.notebook.current.id, knowledgeVersionId: valid.id },
    { key: randomUUID() },
  );
  const generated = await generateCards(
    db,
    x.ctx,
    x.session.id,
    { autoAdd: true },
    { key: randomUUID() },
  );
  expect(generated.cards[0]?.pronunciationTarget).toBe("look forward to");
  expect(generated.cards[0]?.pronunciationTarget).not.toBe("meeting");
  const card = generated.cards[0];
  if (!card) throw new Error("Missing frame card");
  expect((await getCard(db, x.ctx, card.id)).pronunciationTarget).toBe("look forward to");
});

it("stores one reference card per shared item, preserves rich metadata through sync/proposal/undo, and keeps edits plain", async () => {
  const x = await studyFixture(db, { count: 0 });
  const model = referenceStudyModel();
  const firstItem = model.learningItems[0];
  if (!firstItem) throw new Error("Missing reference item");
  // The UI reference contains an oral example; this synthetic integration source has no teacher evidence.
  model.learningItems.forEach((item) => {
    if (item.study?.set === "recognition") item.study.spoken = false;
  });
  if (model.classNotes) delete model.classNotes.mistakes;
  const knowledge = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, x.ctx, {
      sessionId: x.session.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "rich-fixture",
      model,
      sources: [],
      explanationLanguage: "fa",
      generation: { mode: "mock", provider: "reference-test" },
    }),
  );
  let note = await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    {
      expectedRevisionId: x.notebook.current.id,
      knowledgeVersionId: knowledge.id,
    },
    { key: randomUUID() },
  );
  const first = await generateCards(
    db,
    x.ctx,
    x.session.id,
    { autoAdd: true },
    { key: randomUUID() },
  );
  expect(first.cards).toHaveLength(model.learningItems.length);
  expect(first.cards.map((card) => card.studyPosition)).toEqual(
    model.learningItems.map((_, index) => index),
  );
  expect(first.cards[0]).toMatchObject({
    ...renderStudyCard(firstItem),
    contentFormat: "lesson_html",
    studySet: "production",
    pronunciationTarget: "wear and tear",
    direction: "forward",
  });
  expect(first.cards.find((card) => card.studySet === "recognition")?.studyTags).toContain(
    "recognition",
  );
  const reverse = await generateCards(
    db,
    x.ctx,
    x.session.id,
    { reverse: true },
    { key: randomUUID() },
  );
  expect(reverse.cards.map((card) => card.id)).toEqual(first.cards.map((card) => card.id));
  expect((await listCards(db, x.ctx, { sessionId: x.session.id })).map((card) => card.id)).toEqual(
    first.cards.map((card) => card.id),
  );
  const card = first.cards[0];
  if (!card) throw new Error("Missing generated card");
  const { pronunciationTarget: _, ...legacyMetadata } = card;
  await db
    .updateTable("card.card")
    .set({
      study_metadata: JSON.stringify({
        contentFormat: legacyMetadata.contentFormat,
        studySet: legacyMetadata.studySet,
        studyTags: legacyMetadata.studyTags,
        studyPosition: legacyMetadata.studyPosition,
      }),
    })
    .where("id", "=", card.id)
    .execute();
  expect((await getCard(db, x.ctx, card.id)).pronunciationTarget).toBe("wear and tear");
  expect((await listCards(db, x.ctx, { sessionId: x.session.id }))[0]?.pronunciationTarget).toBe(
    "wear and tear",
  );
  const edited = await editCard(
    db,
    x.ctx,
    card.id,
    {
      expectedVersion: card.contentVersion,
      front: "My edited question",
      back: "My edited answer",
      newLearningGoal: false,
    },
    { key: randomUUID() },
  );
  expect(edited.contentFormat).toBeUndefined();
  expect(edited.pronunciationTarget).toBeUndefined();
  const undone = await changeCard(
    db,
    x.ctx,
    card.id,
    { expectedVersion: edited.contentVersion, action: "undo" },
    { key: randomUUID() },
  );
  expect(undone).toMatchObject({
    contentFormat: "lesson_html",
    studySet: "production",
    front: card.front,
    pronunciationTarget: "wear and tear",
  });
  note = await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    {
      expectedRevisionId: note.current.id,
      edits: { items: { [firstItem.id]: { front: "A saved note edit" } } },
    },
    { key: randomUUID() },
  );
  await generateCards(db, x.ctx, x.session.id, {}, { key: randomUUID() });
  const proposals = await listCardProposals(db, x.ctx, card.id);
  const proposal = proposals[0];
  if (!proposal) throw new Error("Missing proposed edit");
  expect(proposals[0]?.contentFormat).toBeUndefined();
  const current = await getCard(db, x.ctx, card.id);
  const applied = await resolveCardProposal(
    db,
    x.ctx,
    card.id,
    proposal.id,
    { expectedVersion: current.contentVersion, action: "apply", newLearningGoal: false },
    { key: randomUUID() },
  );
  expect(applied.front).toBe("A saved note edit");
  expect(applied.contentFormat).toBeUndefined();
  await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() });
  expect((await listCards(db, x.ctx, { sessionId: x.session.id })).length).toBe(first.cards.length);
  const synced = await listCards(db, x.ctx, { sessionId: x.session.id });
  expect(synced.find((entry) => entry.id === first.cards[1]?.id)).toMatchObject({
    contentFormat: "lesson_html",
    front: first.cards[1]?.front,
  });
});

it("automatic publication creates rich faces directly and keeps recognition separate", async () => {
  const x = await studyFixture(db, { count: 0 });
  const model = referenceStudyModel();
  if (model.classNotes) delete model.classNotes.mistakes;
  const knowledge = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, x.ctx, {
      sessionId: x.session.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "automatic-rich",
      model,
      sources: [],
      explanationLanguage: "fa",
      generation: { mode: "mock", provider: "reference-test" },
    }),
  );
  await publishNotebook(
    db,
    x.ctx,
    x.session.id,
    { expectedRevisionId: x.notebook.current.id, knowledgeVersionId: knowledge.id },
    { key: randomUUID() },
  );
  const result = await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() });
  expect(result.created).toBe(model.learningItems.length);
  const cards = await listCards(db, x.ctx, { sessionId: x.session.id });
  const item = model.learningItems[0];
  if (!item) throw new Error("Missing reference item");
  expect(cards[0]).toMatchObject({
    ...renderStudyCard(item),
    contentFormat: "lesson_html",
    studySet: "production",
  });
  expect(cards.filter((card) => card.studySet === "recognition")).toHaveLength(7);
  expect(
    (await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() })).retained,
  ).toBe(cards.length);
  const secondSession = await createSession(db, x.ctx, {}, { key: randomUUID() });
  if (model.classNotes) model.classNotes.date = "2026-10-06";
  const nextKnowledge = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, x.ctx, {
      sessionId: secondSession.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "same-items-new-lesson",
      model,
      sources: [],
      explanationLanguage: "fa",
      generation: { mode: "mock", provider: "reference-test" },
    }),
  );
  const secondNote = await publishNotebook(
    db,
    x.ctx,
    secondSession.id,
    { expectedRevisionId: null, knowledgeVersionId: nextKnowledge.id },
    { key: randomUUID() },
  );
  await synchronizeAutomaticCards(db, x.ctx, secondSession.id, { key: randomUUID() });
  const nextCards = await listCards(db, x.ctx, { sessionId: secondSession.id });
  expect(nextCards[0]?.id).not.toBe(cards[0]?.id);
  expect(nextCards[0]?.front).toBe(cards[0]?.front);
  expect(nextCards[0]?.studyTags).toContain("2026-10-06");
  expect(nextCards[0]?.studyTags).not.toContain("2026-10-05");
  model.learningItems = [
    ...model.learningItems.slice(0, 3).reverse(),
    ...model.learningItems.slice(3),
  ];
  if (model.classNotes) model.classNotes.course = "Updated course";
  const reordered = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, x.ctx, {
      sessionId: secondSession.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "reordered-rich-items",
      model,
      sources: [],
      explanationLanguage: "fa",
      generation: { mode: "mock", provider: "reference-test" },
    }),
  );
  await publishNotebook(
    db,
    x.ctx,
    secondSession.id,
    { expectedRevisionId: secondNote.current.id, knowledgeVersionId: reordered.id },
    { key: randomUUID() },
  );
  const updated = await synchronizeAutomaticCards(db, x.ctx, secondSession.id, {
    key: randomUUID(),
  });
  expect(updated.created).toBe(0);
  const reorderedCards = await listCards(db, x.ctx, { sessionId: secondSession.id });
  expect(reorderedCards[0]?.id).toBe(nextCards[2]?.id);
  expect(reorderedCards[0]?.studyTags).toContain("Updated_course");
});

it.each(MULTILINGUAL_STUDY_CASES)(
  "persists $language rich cards for both goals and keeps historical language after preference changes",
  async (value) => {
    const x = await studyFixture(db, { count: 0 });
    await updateProfile(
      db,
      x.ctx,
      { field: "first_language", firstLanguage: value.firstLanguage },
      { now: x.now },
    );
    await updateProfile(
      db,
      x.ctx,
      {
        field: "explanation_language",
        explanationLanguage: value.language === "en" ? "english" : "first_language",
      },
      { now: x.now },
    );
    const model = multilingualStudyModel(value);
    const knowledge = await db.transaction().execute((tx) =>
      publishKnowledgeVersion(tx, x.ctx, {
        sessionId: x.session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: `synthetic-${value.language}`,
        model,
        sources: [],
        explanationLanguage: value.language,
        generation: { mode: "mock", provider: "multilingual-consumer-test" },
      }),
    );
    await publishNotebook(
      db,
      x.ctx,
      x.session.id,
      { expectedRevisionId: x.notebook.current.id, knowledgeVersionId: knowledge.id },
      { key: randomUUID() },
    );
    await generateCards(db, x.ctx, x.session.id, { autoAdd: true }, { key: randomUUID() });
    const saved = await listCards(db, x.ctx, { sessionId: x.session.id });
    expect(saved).toHaveLength(2);
    for (const entry of saved) {
      const face = entry.studySet === "production" ? entry.front : entry.back;
      expect(entry.contentFormat).toBe("lesson_html");
      expect(face).toContain(value.meaning);
      expect(face).toContain(`lang="${value.language}"`);
      expect(face).toContain(`dir="${value.dir}"`);
    }
    for (const set of ["production", "recognition"] as const) {
      const text = buildStudyAnkiText(saved, { set, deckName: "Synthetic multilingual class" });
      expect(text).toContain(value.meaning);
      expect(text).toContain(`lang="${value.language}"`);
      expect(text).not.toMatch(/معنی|استهلاک|فارسی/);
    }
    await updateProfile(
      db,
      x.ctx,
      { field: "first_language", firstLanguage: "de" },
      { now: x.now },
    );
    await updateProfile(
      db,
      x.ctx,
      {
        field: "explanation_language",
        explanationLanguage: "english",
      },
      { now: x.now },
    );
    await synchronizeAutomaticCards(db, x.ctx, x.session.id, { key: randomUUID() });
    expect(
      (await listCards(db, x.ctx, { sessionId: x.session.id })).map(({ id, front, back }) => ({
        id,
        front,
        back,
      })),
    ).toEqual(saved.map(({ id, front, back }) => ({ id, front, back })));
  },
);
