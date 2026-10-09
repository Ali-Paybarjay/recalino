import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import { createDatabase } from "../db";
import {
  listLatestAvailableKnowledgeVersions,
  publishKnowledgeVersion,
  tombstoneKnowledge,
} from "../lkm";
import {
  bumpSessionSourcesVersion,
  createCourse,
  createSession,
  deleteSession,
  getSession,
  updateSession,
} from "../org";
import type { LearnerContext } from "../plt";
import { listCourseMaterials } from "./course-materials";
import {
  enrichLearningSessions,
  getLearningSession,
  listLearningSessions,
} from "./learning-sessions";
import { publishNotebook } from "./notebooks";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
const options = () => ({ key: randomUUID() });
function propose(
  ctx: LearnerContext,
  sessionId: string,
  title: string,
  topics: string[] = ["Present perfect", "Past simple"],
  sourcesVersion = 0,
) {
  const model = {
    ...syntheticKnowledge(),
    title,
    topics: topics.map((label, index) => ({ id: `topic-${index}`, title: label, claims: [] })),
  };
  return db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, ctx, {
      sessionId,
      runId: randomUUID(),
      sourcesVersion,
      sourceFingerprint: "synthetic-overview",
      model,
      sources: [],
      explanationLanguage: "en",
      generation: { mode: "mock" },
    }),
  );
}

describe("D40 content-derived session titles and topic overviews", () => {
  it("starts from the date, then shows processed material before publication without storing a title", async () => {
    const fixture = await studyFixture(db);
    const session = await createSession(
      db,
      fixture.ctx,
      { courseId: fixture.session.courseId, classDate: "2026-10-01" },
      options(),
    );
    expect(await getLearningSession(db, fixture.ctx, session.id)).toMatchObject({
      displayTitle: "Session — 1 Oct 2026",
      titleSource: "date",
      topics: [],
    });
    await propose(fixture.ctx, session.id, "Comparing Past Simple and Present Perfect", [
      "  Present perfect ",
      "PRESENT PERFECT",
      " ",
      " Past simple ",
    ]);
    expect(await getLearningSession(db, fixture.ctx, session.id)).toMatchObject({
      title: null,
      displayTitle: "Comparing Past Simple and Present Perfect",
      titleSource: "material",
      topics: ["Present perfect", "Past simple"],
      courseId: session.courseId,
      classDate: "2026-10-01",
      updatedAt: session.updatedAt,
    });
    expect(await getSession(db, fixture.ctx, session.id)).toEqual(session);
    const read = await listCourseMaterials(db, fixture.ctx, session.courseId);
    expect(read.items.find((item) => item.session.id === session.id)).toMatchObject({
      session: { titleSource: "material", topics: ["Present perfect", "Past simple"] },
      notebook: null,
    });
  });

  it("keeps the edited publication above newer proposals and supports manual title override and clearing", async () => {
    const fixture = await studyFixture(db);
    const knowledge = await propose(
      fixture.ctx,
      fixture.session.id,
      "Using the Present Perfect for Experience",
    );
    await publishNotebook(
      db,
      fixture.ctx,
      fixture.session.id,
      {
        expectedRevisionId: fixture.notebook.current.id,
        knowledgeVersionId: knowledge.id,
        edits: { title: "My corrected present perfect lesson" },
      },
      options(),
    );
    await propose(fixture.ctx, fixture.session.id, "Unpublished future tense lesson", ["Future"]);
    await updateSession(db, fixture.ctx, fixture.session.id, { title: "My ESOL lesson" });
    expect(await getLearningSession(db, fixture.ctx, fixture.session.id)).toMatchObject({
      displayTitle: "My ESOL lesson",
      titleSource: "manual",
      topics: ["Present perfect", "Past simple"],
    });
    await updateSession(db, fixture.ctx, fixture.session.id, { title: null });
    await db
      .transaction()
      .execute((tx) => bumpSessionSourcesVersion(tx, fixture.ctx, fixture.session.id, new Date()));
    const learned = await getLearningSession(db, fixture.ctx, fixture.session.id);
    expect(learned).toMatchObject({
      title: null,
      displayTitle: "My corrected present perfect lesson",
      titleSource: "material",
      topics: ["Present perfect", "Past simple"],
      sourcesVersion: 1,
    });
    expect((await listLearningSessions(db, fixture.ctx)).items).toEqual([learned]);
    expect(
      (await listCourseMaterials(db, fixture.ctx, fixture.session.courseId)).items[0]?.session,
    ).toEqual(learned);
  });

  it("rejects stale generated fallback and removes metadata after tombstones while keeping a manual label", async () => {
    const fixture = await studyFixture(db);
    const session = await createSession(db, fixture.ctx, {}, options());
    await propose(fixture.ctx, session.id, "Outdated generated title");
    await db
      .transaction()
      .execute((tx) => bumpSessionSourcesVersion(tx, fixture.ctx, session.id, new Date()));
    expect(await getLearningSession(db, fixture.ctx, session.id)).toMatchObject({
      displayTitle: session.displayTitle,
      titleSource: "date",
      topics: [],
    });
    await propose(fixture.ctx, session.id, "Current source lesson", ["Current topic"], 1);
    expect(await getLearningSession(db, fixture.ctx, session.id)).toMatchObject({
      displayTitle: "Current source lesson",
      titleSource: "material",
      topics: ["Current topic"],
    });
    await updateSession(db, fixture.ctx, session.id, { title: "Personal lesson" });
    await db.transaction().execute((tx) => tombstoneKnowledge(tx, fixture.ctx, session.id));
    expect(await getLearningSession(db, fixture.ctx, session.id)).toMatchObject({
      displayTitle: "Personal lesson",
      titleSource: "manual",
      topics: [],
    });
    await db.transaction().execute((tx) => tombstoneKnowledge(tx, fixture.ctx, fixture.session.id));
    expect(await getLearningSession(db, fixture.ctx, fixture.session.id)).toMatchObject({
      displayTitle: fixture.session.displayTitle,
      titleSource: "date",
      topics: [],
    });
  });

  it("re-reads stale enrichment input, preserves moved course/date and rejects hostile or deleted rows", async () => {
    const [alice, bob] = await Promise.all([studyFixture(db), studyFixture(db)]);
    const course = await createCourse(db, alice.ctx, { name: "Moved ESOL" }, options());
    const moved = await updateSession(db, alice.ctx, alice.session.id, {
      courseId: course.id,
      classDate: "2026-09-25",
      title: "My current class title",
    });
    const [enriched] = await enrichLearningSessions(db, alice.ctx, [
      { ...alice.session, title: "Forged stale label", displayTitle: "Forged stale label" },
    ]);
    expect(enriched).toMatchObject({
      courseId: course.id,
      classDate: "2026-09-25",
      title: "My current class title",
      displayTitle: "My current class title",
      titleSource: "manual",
      updatedAt: moved.updatedAt,
    });
    await expect(getLearningSession(db, bob.ctx, alice.session.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(enrichLearningSessions(db, alice.ctx, [bob.session])).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      enrichLearningSessions(db, alice.ctx, [{ ...bob.session, ownerId: alice.ctx.userId }]),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (
        await listLatestAvailableKnowledgeVersions(db, alice.ctx, [
          alice.session.id,
          bob.session.id,
        ])
      ).map((version) => version.sessionId),
    ).toEqual([alice.session.id]);
    await deleteSession(db, alice.ctx, alice.session.id);
    await expect(enrichLearningSessions(db, alice.ctx, [moved])).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listCourseMaterials(db, alice.ctx, course.id)).toEqual({ items: [], total: 0 });
  });
});
