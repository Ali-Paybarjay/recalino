import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  tombstoneAccount,
  updateProfile,
} from "../acc";
import { createDatabase } from "../db";
import {
  cleanupAccountOrg,
  cleanupSessionOrg,
  createCourse,
  createSession,
  createUnit,
  deleteCourse,
  deleteSession,
  deleteUnit,
  getSession,
  listCourses,
  listSessions,
  listUnits,
  renameCourse,
  updateSession,
  updateUnit,
} from "./index";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  return ctx;
}
const options = () => ({ key: randomUUID() });

describe("ORG ownership, default creation and deletion on Postgres", () => {
  it("AC-01 and AC-13: concurrent first classes share one default and duplicate requests replay", async () => {
    const ctx = await learner();
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      createSession(db, ctx, {}, { key }),
      createSession(db, ctx, {}, { key }),
    ]);
    expect(replay).toEqual(first);
    await Promise.all([
      createSession(db, ctx, {}, options()),
      createSession(db, ctx, {}, options()),
    ]);
    expect(await listCourses(db, ctx)).toHaveLength(1);
    expect((await listSessions(db, ctx)).total).toBe(3);
    await expect(createSession(db, ctx, { title: "Different" }, { key })).rejects.toMatchObject({
      code: "idempotency_mismatch",
    });
  });
  it("FR-ORG-001..006: scopes names, validates destinations and protects nonempty/default courses", async () => {
    const ctx = await learner();
    const course = await createCourse(db, ctx, { name: " Course " }, options());
    await expect(createCourse(db, ctx, { name: "course" }, options())).rejects.toMatchObject({
      code: "validation_failed",
    });
    const unit = await createUnit(db, ctx, { courseId: course.id, name: "Unit" }, options());
    const other = await createCourse(db, ctx, { name: "Other" }, options());
    await expect(
      createSession(db, ctx, { courseId: other.id, unitId: unit.id }, options()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const item = await createSession(
      db,
      ctx,
      { courseId: course.id, unitId: unit.id, classDate: "2026-10-04" },
      options(),
    );
    await expect(deleteCourse(db, ctx, course.id)).rejects.toMatchObject({
      code: "validation_failed",
    });
    await expect(deleteUnit(db, ctx, unit.id)).rejects.toMatchObject({ code: "validation_failed" });
    await updateSession(db, ctx, item.id, { unitId: null });
    await deleteUnit(db, ctx, unit.id);
    expect(await listUnits(db, ctx, course.id)).toHaveLength(0);
    expect(
      (await updateSession(db, ctx, item.id, { courseId: other.id, title: "New title" })).courseId,
    ).toBe(other.id);
    await deleteCourse(db, ctx, course.id);
    const implicit = await createSession(db, ctx, {}, options());
    await expect(deleteCourse(db, ctx, implicit.courseId)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
  it("FR-ORG-003: units without an order follow the last unit and equal orders keep creation order", async () => {
    const ctx = await learner();
    const course = await createCourse(db, ctx, { name: "Ordered course" }, options());
    const create = (name: string, extra: { position?: number; now?: Date } = {}) =>
      createUnit(
        db,
        ctx,
        {
          courseId: course.id,
          name,
          ...(extra.position === undefined ? {} : { position: extra.position }),
        },
        { key: randomUUID(), ...(extra.now ? { now: extra.now } : {}) },
      );
    expect((await create("Unit 1")).position).toBe(1);
    expect((await create("Unit 2")).position).toBe(2);
    const third = await create("Unit 3");
    expect(third.position).toBe(3);
    expect((await create("Intro", { position: 0 })).position).toBe(0);
    await updateUnit(db, ctx, third.id, { position: 10 });
    expect((await create("Unit 4")).position).toBe(11);
    await create("Review B", { position: 20, now: new Date("2026-10-02T00:00:00.000Z") });
    await create("Review A", { position: 20, now: new Date("2026-10-01T00:00:00.000Z") });
    expect((await listUnits(db, ctx, course.id)).map((row) => row.name)).toEqual([
      "Intro",
      "Unit 1",
      "Unit 2",
      "Unit 3",
      "Unit 4",
      "Review A",
      "Review B",
    ]);
    const other = await createCourse(db, ctx, { name: "Separate order" }, options());
    expect(
      (await createUnit(db, ctx, { courseId: other.id, name: "Unit 1" }, options())).position,
    ).toBe(1);
  });
  it("FR-PLT-002 and AC-17: foreign identities cannot read, move or delete; tombstones replay", async () => {
    const a = await learner();
    const b = await learner();
    const item = await createSession(db, a, {}, options());
    expect((await listSessions(db, b)).total).toBe(0);
    for (const operation of [
      () => getSession(db, b, item.id),
      () => updateSession(db, b, item.id, { title: "Foreign" }),
      () => deleteSession(db, b, item.id),
      () => renameCourse(db, b, item.courseId, { name: "Foreign" }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "not_found" });
    const receipt = await deleteSession(db, a, item.id);
    expect(await deleteSession(db, a, item.id)).toEqual(receipt);
    await expect(getSession(db, a, item.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listSessions(db, a)).total).toBe(0);
    expect(
      await db.selectFrom("org.outbox").select("id").where("session_id", "=", item.id).execute(),
    ).toHaveLength(1);
  });
  it("PRD-DEL-01 and FR-PLT-002: queued session cleanup erases personal context only after its tombstone", async () => {
    const a = await learner();
    const b = await learner();
    const course = await createCourse(db, a, { name: "Private synthetic course" }, options());
    const unit = await createUnit(
      db,
      a,
      { courseId: course.id, name: "Private synthetic unit" },
      options(),
    );
    const item = await createSession(
      db,
      a,
      {
        courseId: course.id,
        unitId: unit.id,
        title: "Private class title",
        classDate: "2026-10-01",
      },
      options(),
    );
    const other = await createSession(
      db,
      b,
      { title: "Other learner title", classDate: "2026-10-02" },
      options(),
    );
    await expect(cleanupSessionOrg(db, a, item.id)).rejects.toMatchObject({ code: "conflict" });
    const receipt = await deleteSession(db, a, item.id);
    await expect(cleanupSessionOrg(db, b, item.id)).rejects.toMatchObject({ code: "not_found" });
    await cleanupSessionOrg(db, a, item.id);
    await cleanupSessionOrg(db, a, item.id);
    expect(
      await db
        .selectFrom("org.class_session")
        .select([
          "title",
          "course_id",
          "unit_id",
          "deletion_request_id",
          sql<string>`class_date::text`.as("classDate"),
        ])
        .where("id", "=", item.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      title: null,
      course_id: null,
      unit_id: null,
      deletion_request_id: receipt.id,
      classDate: "1970-01-01",
    });
    expect(await deleteSession(db, a, item.id)).toEqual(receipt);
    expect((await getSession(db, b, other.id)).title).toBe("Other learner title");
    expect((await listCourses(db, a)).map((row) => row.name)).toContain(course.name);
    expect((await listUnits(db, a, course.id)).map((row) => row.name)).toContain(unit.name);
  });
  it("PRD-DEL-01: account cleanup removes personal container names while preserving deletion receipts", async () => {
    const a = await learner();
    const b = await learner();
    const course = await createCourse(db, a, { name: "Private account course" }, options());
    const unit = await createUnit(
      db,
      a,
      { courseId: course.id, name: "Private account unit" },
      options(),
    );
    await createCourse(db, a, { name: "Private empty course" }, options());
    const item = await createSession(
      db,
      a,
      {
        courseId: course.id,
        unitId: unit.id,
        title: "Private account title",
        classDate: "2026-10-01",
      },
      options(),
    );
    const other = await createSession(db, b, { title: "Keep other owner context" }, options());
    const now = new Date();
    const receipt = await deleteSession(db, a, item.id);
    await expect(cleanupAccountOrg(db, a)).rejects.toMatchObject({ code: "conflict" });
    await db.transaction().execute((tx) => tombstoneAccount(tx, a, now));
    await cleanupAccountOrg(db, a, now);
    await cleanupAccountOrg(db, a, now);
    expect(await listCourses(db, a)).toHaveLength(0);
    expect(
      await db.selectFrom("org.unit").select("id").where("owner_id", "=", a.userId).execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("org.class_session")
        .select(["title", "course_id", "unit_id", sql<string>`class_date::text`.as("classDate")])
        .where("id", "=", item.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ title: null, course_id: null, unit_id: null, classDate: "1970-01-01" });
    expect(
      await db
        .selectFrom("org.deletion_request")
        .select("id")
        .where("session_id", "=", item.id)
        .execute(),
    ).toEqual([{ id: receipt.id }]);
    expect((await getSession(db, b, other.id)).title).toBe("Keep other owner context");
    expect(await listCourses(db, b)).toHaveLength(1);
  });
});
