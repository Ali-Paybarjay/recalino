import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import { createDatabase } from "../db";
import {
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
});
