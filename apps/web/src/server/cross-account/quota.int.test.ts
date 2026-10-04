import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { quotaHandler } from "../quota-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const route = defineRoute(ROUTES.quota, quotaHandler(), routeDeps(db));
afterAll(() => db.destroy());
describe("GET allowance across accounts (FR-PLT-002, FR-QUOTA-003)", () => {
  it("returns only the session owner's allowance and ignores forged owner parameters", async () => {
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    const now = new Date();
    await grantEntitlement(db, {
      userId: alice,
      startsAt: new Date(now.getTime() - 1000),
      endsAt: new Date(now.getTime() + 3600000),
      amounts: amounts({ audio: 1234 }),
      operationKey: randomUUID(),
      actorId: "test-operator",
      reason: "Synthetic API test",
    });
    const a = await route(requestAs(alice, "/api/quota", "GET"));
    expect(a.status).toBe(200);
    expect((await a.json()).remaining.audio).toBe(1234);
    const b = await route(requestAs(bob, `/api/quota?userId=${alice}`, "GET"));
    expect((await b.json()).remaining.audio).toBe(0);
  });
  it("requires authentication", async () => {
    expect((await route(requestAs(null, "/api/quota", "GET"))).status).toBe(401);
  });
});
