import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { type KnowledgeModel, publishKnowledgeVersion, tombstoneKnowledge } from "../lkm";
import { createCourse, createSession, deleteSession, updateSession } from "../org";
import { listCourseMaterials } from "./course-materials";
import { publishNotebook } from "./notebooks";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
const options = () => ({ key: randomUUID() });

describe("D39 course reading on Postgres", () => {
  it("paginates by date and stable session id, keeps empty sessions and separates courses/accounts", async () => {
    const [alice, bob] = await Promise.all([studyFixture(db), studyFixture(db)]);
    const esol = await createCourse(db, alice.ctx, { name: "ESOL" }, options());
    const computing = await createCourse(db, alice.ctx, { name: "Computing" }, options());
    await updateSession(db, alice.ctx, alice.session.id, {
      courseId: esol.id,
      classDate: "2026-10-03",
    });
    const sameDay = await createSession(
      db,
      alice.ctx,
      { courseId: esol.id, classDate: "2026-10-03" },
      options(),
    );
    const first = await createSession(
      db,
      alice.ctx,
      { courseId: esol.id, classDate: "2026-09-30" },
      options(),
    );
    const separate = await createSession(
      db,
      alice.ctx,
      { courseId: computing.id, classDate: "2026-09-01" },
      options(),
    );
    const expectedIds = [first.id, ...[alice.session.id, sameDay.id].sort()];
    const page = await listCourseMaterials(db, alice.ctx, esol.id, { limit: 2 });
    const next = await listCourseMaterials(db, alice.ctx, esol.id, { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(next.total).toBe(3);
    expect([...page.items, ...next.items].map((item) => item.session.id)).toEqual(expectedIds);
    expect(page.items[0]).toMatchObject({ session: { id: first.id }, notebook: null });
    expect(
      [...page.items, ...next.items].find((item) => item.session.id === alice.session.id),
    ).toMatchObject({ notebook: { current: { id: alice.notebook.current.id } } });
    expect((await listCourseMaterials(db, alice.ctx, computing.id)).items).toMatchObject([
      { session: { id: separate.id }, notebook: null },
    ]);
    await expect(listCourseMaterials(db, bob.ctx, esol.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(listCourseMaterials(db, alice.ctx, bob.session.courseId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listCourseMaterials(db, alice.ctx, esol.id, { offset: 3 })).toEqual({
      items: [],
      total: 3,
    });
  });

  it("reads the current edited publication with source provenance while a new generation remains proposed", async () => {
    const fixture = await studyFixture(db);
    const sourceId = randomUUID();
    const contentVersionId = randomUUID();
    const sourceRef = {
      sourceId,
      contentVersionId,
      locator: { kind: "text" as const, blockId: "material", start: 0, end: 9 },
    };
    const summary = fixture.model.summary[0];
    if (!summary) throw new Error("The synthetic fixture needs a summary claim.");
    const model: KnowledgeModel = {
      ...fixture.model,
      summary: [
        {
          ...summary,
          origin: "from_class",
          creation: "machine_extraction",
          evidence: "material",
          sourceRefs: [sourceRef],
        },
      ],
    };
    const sourced = await db.transaction().execute((tx) =>
      publishKnowledgeVersion(tx, fixture.ctx, {
        sessionId: fixture.session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: "synthetic-source",
        model,
        sources: [
          {
            sourceId,
            contentVersionId,
            kind: "text",
            role: "class_material",
            units: [],
            blocks: [{ id: "material", text: "Synthetic class material" }],
          },
        ],
        explanationLanguage: "en",
        generation: { mode: "mock" },
      }),
    );
    const edited = await publishNotebook(
      db,
      fixture.ctx,
      fixture.session.id,
      {
        expectedRevisionId: fixture.notebook.current.id,
        knowledgeVersionId: sourced.id,
        edits: {
          title: "My lesson title",
          claims: { summary: "My corrected explanation" },
          items: { "item-0": { front: "My question", back: "My answer" } },
        },
      },
      options(),
    );
    const proposed = await db.transaction().execute((tx) =>
      publishKnowledgeVersion(tx, fixture.ctx, {
        sessionId: fixture.session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: "new-proposal",
        model: { ...fixture.model, title: "An unpublished replacement" },
        sources: [],
        explanationLanguage: "en",
        generation: { mode: "mock" },
      }),
    );
    const before = await db
      .selectFrom("note.revision")
      .select("id")
      .where("notebook_id", "=", fixture.notebook.id)
      .orderBy("revision_number")
      .execute();
    const read = await listCourseMaterials(db, fixture.ctx, fixture.session.courseId);
    expect(read.items[0]?.notebook?.current).toEqual(edited.current);
    expect(read.items[0]?.notebook?.proposedKnowledgeVersionId).toBe(proposed.id);
    expect(read.items[0]?.notebook?.current.model.summary[0]).toMatchObject({
      text: "My corrected explanation",
      creation: "user_edit",
      origin: "from_class",
      sourceRefs: [sourceRef],
    });
    expect(
      await db
        .selectFrom("note.revision")
        .select("id")
        .where("notebook_id", "=", fixture.notebook.id)
        .orderBy("revision_number")
        .execute(),
    ).toEqual(before);
  });

  it("moves existing publication membership, excludes deleted sessions and hides tombstoned knowledge", async () => {
    const fixture = await studyFixture(db);
    const destination = await createCourse(db, fixture.ctx, { name: "New course" }, options());
    await updateSession(db, fixture.ctx, fixture.session.id, { courseId: destination.id });
    expect(await listCourseMaterials(db, fixture.ctx, fixture.session.courseId)).toEqual({
      items: [],
      total: 0,
    });
    expect(
      (await listCourseMaterials(db, fixture.ctx, destination.id)).items[0]?.notebook?.current.id,
    ).toBe(fixture.notebook.current.id);
    // Even a publication pointer not yet cleared by PRIV cannot expose unavailable knowledge.
    await db.transaction().execute((tx) => tombstoneKnowledge(tx, fixture.ctx, fixture.session.id));
    expect((await listCourseMaterials(db, fixture.ctx, destination.id)).items).toMatchObject([
      { session: { id: fixture.session.id }, notebook: null },
    ]);
    await deleteSession(db, fixture.ctx, fixture.session.id);
    expect(await listCourseMaterials(db, fixture.ctx, destination.id)).toEqual({
      items: [],
      total: 0,
    });
  });

  it("uses the caller's transaction snapshot and fails closed for a pointer to another session's revision", async () => {
    const fixture = await studyFixture(db);
    const destination = await createCourse(db, fixture.ctx, { name: "Moved course" }, options());
    await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => {
        expect((await listCourseMaterials(tx, fixture.ctx, fixture.session.courseId)).total).toBe(
          1,
        );
        await updateSession(db, fixture.ctx, fixture.session.id, { courseId: destination.id });
        expect((await listCourseMaterials(tx, fixture.ctx, fixture.session.courseId)).total).toBe(
          1,
        );
        expect((await listCourseMaterials(tx, fixture.ctx, destination.id)).total).toBe(0);
      });
    const separate = await createSession(
      db,
      fixture.ctx,
      { courseId: destination.id, classDate: "2026-09-01" },
      options(),
    );
    const notebook = await db
      .insertInto("note.notebook")
      .values({
        user_id: fixture.ctx.userId,
        session_id: separate.id,
        current_revision_id: fixture.notebook.current.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const read = await listCourseMaterials(db, fixture.ctx, destination.id);
    expect(read.total).toBe(2);
    expect(read.items.find((item) => item.session.id === separate.id)?.notebook).toBeNull();
    expect(read.items.find((item) => item.session.id === fixture.session.id)?.notebook?.id).toBe(
      fixture.notebook.id,
    );
    await db
      .updateTable("note.notebook")
      .set({ current_revision_id: null })
      .where("id", "=", notebook.id)
      .execute();
  });
});
