import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { classProcessingHandler } from "../processing-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.classProcessing, classProcessingHandler(randomUUID()));
it("does not disclose or start processing for a foreign class", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  expect(
    (
      await orgCall(
        db,
        ROUTES.classProcessing,
        classProcessingHandler(owner.session.id),
        attacker.owner,
        `/api/classes/${owner.session.id}/processing`,
        "GET",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await orgCall(
        db,
        ROUTES.classProcessing,
        classProcessingHandler(owner.session.id),
        attacker.owner,
        `/api/classes/${owner.session.id}/processing`,
        "POST",
        { expectedFingerprint: "forged", expectedSourcesVersion: 0 },
        randomUUID(),
      )
    ).status,
  ).toBe(404);
});
