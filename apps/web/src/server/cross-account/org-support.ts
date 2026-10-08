import { randomUUID } from "node:crypto";
import { acceptDocuments, CURRENT_VERSIONS, updateProfile } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import {
  type ClassSession,
  type Course,
  createCourse,
  createSession,
  createUnit,
  type Unit,
} from "@recalino/core/org";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute, type Handler } from "../api";
import type { RouteMeta } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

export function orgTestDatabase() {
  const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
  afterAll(() => db.destroy());
  return db;
}
export async function orgFixture(db: ReturnType<typeof orgTestDatabase>) {
  const owner = await newLearner(db);
  const actor = { userId: owner, requestId: randomUUID() };
  const now = new Date();
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(db, actor, change, { now });
  await acceptDocuments(
    db,
    actor,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const course: Course = await createCourse(
    db,
    actor,
    { name: `Private ${randomUUID()}` },
    { key: randomUUID() },
  );
  const unit: Unit = await createUnit(
    db,
    actor,
    { courseId: course.id, name: "Unit one" },
    { key: randomUUID() },
  );
  const session: ClassSession = await createSession(
    db,
    actor,
    { courseId: course.id, unitId: unit.id, title: "Private lesson" },
    { key: randomUUID() },
  );
  return { owner, actor, course, unit, session };
}
export async function orgCall(
  db: ReturnType<typeof orgTestDatabase>,
  meta: RouteMeta,
  handler: Handler,
  userId: string | null,
  path: string,
  method: string,
  body?: unknown,
  key?: string,
) {
  const request = requestAs(userId, path, method, body);
  if (key) request.headers.set("idempotency-key", key);
  return defineRoute(
    { ...meta, ...(method === "POST" ? { idempotency: "handler" as const } : {}) },
    handler,
    routeDeps(db),
  )(request);
}
export function unauthenticatedOrg(
  db: ReturnType<typeof orgTestDatabase>,
  meta: RouteMeta,
  handler: Handler,
  method = "GET",
) {
  it("requires a learner session", async () => {
    const response = await orgCall(
      db,
      meta,
      handler,
      null,
      meta.path,
      method,
      method === "GET" ? undefined : {},
      randomUUID(),
    );
    expect(response.status).toBe(401);
  });
}
