import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getNoteSourceStatus } from "@recalino/core/proc";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import { noteSourceRecoveryHandler } from "../note-recovery-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
const input = () => ({
  sourceId: randomUUID(),
  contentVersionId: randomUUID(),
  knowledgeVersionId: randomUUID(),
  expectedSourcesVersion: 0,
});

it("requires a learner session before preparing a source retry", async () => {
  const id = randomUUID();
  const request = requestAs(null, `/api/classes/${id}/notes/recovery`, "POST", input());
  request.headers.set("idempotency-key", randomUUID());
  const response = await defineRoute(
    ROUTES.noteSourceRecovery,
    noteSourceRecoveryHandler(id),
    routeDeps(db),
  )(request);
  expect(response.status).toBe(401);
});

it("does not expose or change another learner's class material", async () => {
  const fixture = await studyFixture(db);
  const other = await newLearner(db);
  const request = requestAs(other, `/api/classes/${fixture.session.id}/notes/recovery`, "POST", {
    ...input(),
    knowledgeVersionId: fixture.knowledge.id,
  });
  request.headers.set("idempotency-key", randomUUID());
  const response = await defineRoute(
    ROUTES.noteSourceRecovery,
    noteSourceRecoveryHandler(fixture.session.id),
    routeDeps(db),
  )(request);
  expect(response.status).toBe(404);
  await expect(
    getNoteSourceStatus(
      db,
      { userId: other, requestId: randomUUID() },
      fixture.session.id,
      fixture.knowledge.id,
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("renders source status for complete saved notes without requiring a retained worker run", async () => {
  const fixture = await studyFixture(db);
  await expect(
    getNoteSourceStatus(db, fixture.ctx, fixture.session.id, fixture.knowledge.id),
  ).resolves.toEqual({ issues: [], materials: [] });
});

it("rejects a version from a different class even when both belong to the same learner", async () => {
  const fixture = await studyFixture(db);
  const { createSession } = await import("@recalino/core/org");
  const otherClass = await createSession(db, fixture.ctx, {}, { key: randomUUID() });
  await expect(
    getNoteSourceStatus(db, fixture.ctx, otherClass.id, fixture.knowledge.id),
  ).rejects.toMatchObject({ code: "not_found" });
});
