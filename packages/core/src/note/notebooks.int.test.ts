import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import {
  cleanupSessionKnowledge,
  getVersion,
  publishKnowledgeVersion,
  tombstoneKnowledge,
} from "../lkm";
import { getNotebook, getNotebookRevision, publishNotebook } from "./notebooks";
import { cleanupSourceNotes, tombstoneSourceNotes } from "./privacy";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
it("keeps user edits, immutable originals and history across an explicitly adopted new generation", async () => {
  const fixture = await studyFixture(db);
  const edited = await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: fixture.notebook.current.id,
      edits: {
        claims: { summary: "My corrected summary" },
        items: { "item-0": { front: "My question" } },
      },
    },
    { key: randomUUID() },
  );
  const editedAgain = await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: edited.current.id,
      edits: { items: { "item-0": { back: "My answer" } } },
    },
    { key: randomUUID() },
  );
  expect(editedAgain.current.model.learningItems[0]).toMatchObject({
    front: "My question",
    back: "My answer",
  });
  expect((await getVersion(db, fixture.ctx, fixture.knowledge.id)).model.summary[0]?.text).toBe(
    "A synthetic explanation.",
  );
  const nextModel = { ...fixture.model, title: "Regenerated title" };
  const knowledge = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, fixture.ctx, {
      sessionId: fixture.session.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "fixture-v2",
      model: nextModel,
      sources: [],
      explanationLanguage: "en",
      generation: { mode: "mock" },
    }),
  );
  expect((await getNotebook(db, fixture.ctx, fixture.session.id))?.current.id).toBe(
    editedAgain.current.id,
  );
  expect((await getNotebook(db, fixture.ctx, fixture.session.id))?.proposedKnowledgeVersionId).toBe(
    knowledge.id,
  );
  const adopted = await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    { expectedRevisionId: editedAgain.current.id, knowledgeVersionId: knowledge.id },
    { key: randomUUID() },
  );
  expect(adopted.current.model.summary[0]).toMatchObject({
    text: "My corrected summary",
    creation: "user_edit",
  });
  expect(adopted.current.model.learningItems[0]).toMatchObject({
    front: "My question",
    back: "My answer",
  });
  expect((await getNotebookRevision(db, fixture.ctx, fixture.notebook.current.id)).model).toEqual(
    fixture.model,
  );
});
it("rejects stale concurrent edits and foreign notebook identifiers", async () => {
  const [alice, bob] = await Promise.all([studyFixture(db), studyFixture(db)]);
  await expect(getNotebookRevision(db, alice.ctx, bob.notebook.current.id)).rejects.toMatchObject({
    code: "not_found",
  });
  const input = { expectedRevisionId: alice.notebook.current.id, edits: { title: "One edit" } };
  const results = await Promise.allSettled([
    publishNotebook(db, alice.ctx, alice.session.id, input, { key: randomUUID() }),
    publishNotebook(db, alice.ctx, alice.session.id, input, { key: randomUUID() }),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.find((item) => item.status === "rejected")).toMatchObject({
    reason: { code: "conflict" },
  });
});
it("republishes before source cleanup without reusing revision numbers or retaining deleted text", async () => {
  const fixture = await studyFixture(db);
  const key = randomUUID();
  const input = {
    expectedRevisionId: fixture.notebook.current.id,
    edits: { title: "Private text from the removed source" },
  };
  const edited = await publishNotebook(db, fixture.ctx, fixture.session.id, input, { key });
  await db.transaction().execute(async (tx) => {
    await tombstoneSourceNotes(tx, fixture.ctx, randomUUID(), [fixture.session.id]);
    await tombstoneKnowledge(tx, fixture.ctx, fixture.session.id);
  });
  await expect(
    publishNotebook(db, fixture.ctx, fixture.session.id, input, { key }),
  ).rejects.toMatchObject({ code: "not_found" });
  const replacement = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, fixture.ctx, {
      sessionId: fixture.session.id,
      runId: randomUUID(),
      sourcesVersion: 1,
      sourceFingerprint: "replacement-without-deleted-source",
      model: { ...fixture.model, title: "Replacement publication" },
      sources: [],
      explanationLanguage: "en",
      generation: { mode: "mock" },
    }),
  );
  const fresh = await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: null,
      knowledgeVersionId: replacement.id,
    },
    { key: randomUUID() },
  );
  expect(fresh.current.number).toBe(edited.current.number + 1);
  await cleanupSourceNotes(db, fixture.ctx, fixture.session.id);
  await cleanupSessionKnowledge(db, fixture.ctx, fixture.session.id);
  expect((await getNotebook(db, fixture.ctx, fixture.session.id))?.current.id).toBe(
    fresh.current.id,
  );
  expect(
    await db
      .selectFrom("note.revision")
      .select("id")
      .where("id", "=", edited.current.id)
      .executeTakeFirst(),
  ).toBeUndefined();
  await expect(getNotebookRevision(db, fixture.ctx, edited.current.id)).rejects.toMatchObject({
    code: "not_found",
  });
});
