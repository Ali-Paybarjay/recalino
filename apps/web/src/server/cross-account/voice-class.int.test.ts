import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { changeClassVoiceIdentity, changeVoiceLine, getClassVoice } from "@recalino/core/voc";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { voiceFixture } from "../../../../../packages/core/test/voice-fixture";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { classVoiceHandler } from "../voice-routes";
import { requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());

it("FR-PLT-002 D64 audit: only the owner can decide a class voice or a line; the same request never applies twice", async () => {
  const [x, y] = await Promise.all([voiceFixture(db), voiceFixture(db)]);
  const path = `/api/classes/${x.session.id}/voice`,
    route = defineRoute(ROUTES.classVoice, classVoiceHandler(x.session.id), routeDeps(db));
  const classBody = {
    scope: "class",
    action: "confirm",
    classVoiceId: "learner",
    expected: [{ analysisId: x.analysis.id, version: 1 }],
  };
  const post = (userId: string, body: unknown, key: string) => {
    const r = requestAs(userId, path, "POST", body);
    r.headers.set("idempotency-key", key);
    return r;
  };
  // Another account: not found at the route and in the core functions alike.
  const classKey = randomUUID();
  expect((await route(post(y.ctx.userId, classBody, classKey))).status).toBe(404);
  await expect(
    changeClassVoiceIdentity(db, y.ctx, x.session.id, classBody as never),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    changeVoiceLine(db, y.ctx, x.session.id, {
      scope: "line",
      analysisId: x.analysis.id,
      expectedVersion: 1,
      utteranceId: "u1",
      choice: "mine",
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses[0]?.version).toBe(1);

  // The owner: once, and the replay of the same key is answered without a second effect.
  expect((await route(post(x.ctx.userId, classBody, classKey))).status).toBe(200);
  expect((await route(post(x.ctx.userId, classBody, classKey))).status).toBe(200);
  let view = await getClassVoice(db, x.ctx, x.session.id);
  expect(view.analyses[0]).toMatchObject({
    version: 2,
    status: "verified",
    verifiedSpeakerId: "learner",
  });
  // A stale class view is refused (409), never applied.
  expect((await route(post(x.ctx.userId, classBody, randomUUID()))).status).toBe(409);

  const lineBody = {
    scope: "line",
    analysisId: x.analysis.id,
    expectedVersion: 2,
    utteranceId: "u2",
    choice: "mine",
  };
  const lineKey = randomUUID();
  expect((await route(post(y.ctx.userId, lineBody, lineKey))).status).toBe(404);
  expect((await route(post(x.ctx.userId, lineBody, lineKey))).status).toBe(200);
  expect((await route(post(x.ctx.userId, lineBody, lineKey))).status).toBe(200);
  view = await getClassVoice(db, x.ctx, x.session.id);
  expect(view.analyses[0]?.version).toBe(3);
  expect(view.analyses[0]?.lines?.find((line) => line.utteranceId === "u2")?.choice).toBe("mine");
  // The other account still sees nothing of this class.
  expect((await route(requestAs(y.ctx.userId, path, "GET"))).status).toBe(404);
  const data = await (await route(requestAs(x.ctx.userId, path, "GET"))).json();
  expect(JSON.stringify(data)).not.toContain("embedding");
  expect(JSON.stringify(data)).not.toContain("vector");
});
