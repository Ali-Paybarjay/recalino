import { CURRENT_VERSIONS, getAccountState, updateProfile } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { consentsHandler } from "../account-routes";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

// FR-PLT-002 / NFR-01 for POST /api/consents: acceptances belong to the caller only.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const route = defineRoute(ROUTES.consents, consentsHandler(), routeDeps(db));

afterAll(async () => {
  await db.destroy();
});

async function readyForConsent(userId: string) {
  const ctx = { userId, requestId: "test" };
  const now = new Date();
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
}

describe("POST /api/consents across accounts", () => {
  it("finishes the caller's setup and never another learner's", async () => {
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    await Promise.all([readyForConsent(alice), readyForConsent(bob)]);
    const response = await route(
      requestAs(alice, "/api/consents", "POST", {
        acceptances: [
          { document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect((await getAccountState(db, alice))?.setupComplete).toBe(true);
    expect((await getAccountState(db, bob))?.setupComplete).toBe(false);
  });

  it("refuses a request without a session, and an outdated version", async () => {
    const alice = await newLearner(db);
    const body = { acceptances: [{ document: "terms", version: CURRENT_VERSIONS.terms }] };
    expect((await route(requestAs(null, "/api/consents", "POST", body))).status).toBe(401);
    const outdated = await route(
      requestAs(alice, "/api/consents", "POST", {
        acceptances: [{ document: "terms", version: "0.0" }],
      }),
    );
    expect(outdated.status).toBe(400);
  });
});
