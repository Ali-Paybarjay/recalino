import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { publishKnowledgeVersion } from "../lkm";
import { publishNotebook } from "../note";
import { createSession } from "../org";
import { submitReview, undoReview } from "../srs";
import { changeLearningPreferences, learningOverview } from "./profile";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
it("requires repeated edits across classes and does not resurface a reset suggestion from old evidence", async () => {
  const fixture = await studyFixture(db);
  await publishNotebook(
    db,
    fixture.ctx,
    fixture.session.id,
    {
      expectedRevisionId: fixture.notebook.current.id,
      edits: { items: { "item-0": { back: "Short" }, "item-1": { back: "Short" } } },
    },
    { key: randomUUID() },
  );
  expect((await learningOverview(db, fixture.ctx)).suggestion).toBeNull();
  const session = await createSession(db, fixture.ctx, {}, { key: randomUUID() });
  await db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, fixture.ctx, {
      sessionId: session.id,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: "synthetic-preference",
      sources: [],
      model: fixture.model,
      explanationLanguage: "en",
      generation: { mode: "mock" },
    }),
  );
  await publishNotebook(
    db,
    fixture.ctx,
    session.id,
    { expectedRevisionId: null, edits: { items: { "item-0": { back: "Short" } } } },
    { key: randomUUID() },
  );
  expect((await learningOverview(db, fixture.ctx)).suggestion).toMatchObject({
    evidenceCount: 3,
    classes: 2,
  });
  expect(
    (await changeLearningPreferences(db, fixture.ctx, { action: "reset_suggestions" })).suggestion,
  ).toBeNull();
  expect((await learningOverview(db, fixture.ctx)).suggestion).toBeNull();
});
it("shows only actual owner review evidence and excludes an undone answer", async () => {
  const fixture = await studyFixture(db, { autoAdd: true });
  const other = await studyFixture(db);
  const card = fixture.cards[0];
  if (!card) throw new Error("missing fixture card");
  const receipt = await submitReview(db, fixture.ctx, {
    eventId: randomUUID(),
    cardId: card.id,
    expectedVersion: 0,
    expectedContentVersion: 1,
    mode: "simple",
    choice: "forgot",
  });
  let profile = await learningOverview(db, fixture.ctx);
  expect(profile.activity.answers).toBe(1);
  expect(profile.supportEstimate.level).toBeNull();
  expect(profile.supportEstimate.speaking).toBe("unknown");
  expect((await learningOverview(db, other.ctx)).activity.answers).toBe(0);
  await undoReview(db, fixture.ctx, receipt.eventId, receipt.version);
  profile = await learningOverview(db, fixture.ctx);
  expect(profile.activity.answers).toBe(0);
});
it("preserves explicit teaching choices when inferred preferences are reset", async () => {
  const fixture = await studyFixture(db);
  let overview = await changeLearningPreferences(db, fixture.ctx, {
    action: "set_shorter_examples",
    value: true,
  });
  expect(overview.shorterExamples).toBe(true);
  overview = await changeLearningPreferences(db, fixture.ctx, { action: "reset_suggestions" });
  expect(overview.shorterExamples).toBe(true);
  expect(overview.suggestion).toBeNull();
  await expect(
    changeLearningPreferences(db, fixture.ctx, { action: "accept_shorter_examples" }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});
