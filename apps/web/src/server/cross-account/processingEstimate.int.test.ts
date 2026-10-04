import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { processingEstimateHandler } from "../processing-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.processingEstimate, processingEstimateHandler(randomUUID()));
it("does not disclose source estimates for a foreign class", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  expect(
    (
      await orgCall(
        db,
        ROUTES.processingEstimate,
        processingEstimateHandler(owner.session.id),
        attacker.owner,
        `/api/classes/${owner.session.id}/estimate`,
        "GET",
      )
    ).status,
  ).toBe(404);
});
