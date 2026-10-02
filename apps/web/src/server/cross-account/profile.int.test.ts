import { createDatabase } from "@recalino/core/db";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { profileHandler } from "../account-routes";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { newLearner, profileOf, requestAs } from "./learners";

// FR-PLT-002 / NFR-01 for PATCH /api/profile: a learner changes only their own profile.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const route = defineRoute(ROUTES.profile, profileHandler(), routeDeps(db));

afterAll(async () => {
  await db.destroy();
});

describe("PATCH /api/profile across accounts", () => {
  it("changes the caller's profile and never another learner's", async () => {
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    const response = await route(
      requestAs(alice, "/api/profile", "PATCH", { field: "first_language", firstLanguage: "ja" }),
    );
    expect(response.status).toBe(200);
    expect((await profileOf(db, alice))?.firstLanguage).toBe("ja");
    expect((await profileOf(db, bob))?.firstLanguage).toBeNull();
  });

  it("refuses a request without a session", async () => {
    const response = await route(
      requestAs(null, "/api/profile", "PATCH", { field: "first_language", firstLanguage: "ja" }),
    );
    expect(response.status).toBe(401);
  });

  it("names no other account: a user id in the body is not part of the contract", async () => {
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    const response = await route(
      requestAs(alice, "/api/profile", "PATCH", {
        field: "first_language",
        firstLanguage: "ru",
        userId: bob,
      }),
    );
    expect(response.status).toBe(200);
    expect((await profileOf(db, bob))?.firstLanguage).toBeNull();
  });
});
