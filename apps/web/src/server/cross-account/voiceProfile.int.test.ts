import { createDatabase } from "@recalino/core/db";
import { enableVoice } from "@recalino/core/voc";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { voiceProfileHandler } from "../voice-routes";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
it("FR-PLT-002 Part6: voice profile reads are account-scoped and contain no samples or vectors", async () => {
  const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
  await enableVoice(db, { userId: alice, requestId: "voice-test" }, "voice-v1");
  const route = defineRoute(ROUTES.voiceProfile, voiceProfileHandler(), routeDeps(db));
  expect((await route(requestAs(null, "/api/me/voice", "GET"))).status).toBe(401);
  const own = await (await route(requestAs(alice, "/api/me/voice", "GET"))).json();
  const other = await (await route(requestAs(bob, `/api/me/voice?userId=${alice}`, "GET"))).json();
  expect(own.enabled).toBe(true);
  expect(other.enabled).toBe(false);
  expect(JSON.stringify(own)).not.toContain("embedding");
  expect(JSON.stringify(own)).not.toContain("sample_object");
});
