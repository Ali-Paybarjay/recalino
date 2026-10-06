import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getClassVoice } from "@recalino/core/voc";
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
it("FR-PLT-002 Part6: only the owner can read/confirm candidates; retries do not confirm twice", async () => {
  const [x, y] = await Promise.all([voiceFixture(db), voiceFixture(db)]);
  const path = `/api/classes/${x.session.id}/voice`,
    route = defineRoute(ROUTES.classVoice, classVoiceHandler(x.session.id), routeDeps(db));
  expect((await route(requestAs(null, path, "GET"))).status).toBe(401);
  expect((await route(requestAs(y.ctx.userId, path, "GET"))).status).toBe(404);
  const body = {
      action: "confirm",
      analysisId: x.analysis.id,
      expectedVersion: 1,
      speakerId: "learner",
    },
    key = randomUUID();
  const request = (userId: string) => {
    const r = requestAs(userId, path, "POST", body);
    r.headers.set("idempotency-key", key);
    return r;
  };
  expect((await route(request(y.ctx.userId))).status).toBe(404);
  expect((await route(request(x.ctx.userId))).status).toBe(200);
  expect((await route(request(x.ctx.userId))).status).toBe(200);
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses[0]?.version).toBe(2);
  const response = await route(requestAs(x.ctx.userId, path, "GET"));
  const data = await response.json();
  expect(JSON.stringify(data)).not.toContain("whyFa");
  expect(JSON.stringify(data)).not.toContain("embedding");
});
