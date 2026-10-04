import { randomUUID } from "node:crypto";
import { accountExists } from "@recalino/core/acc";
import { expect, it } from "vitest";
import { accountDeletionHandler } from "../privacy-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.privacyAccount, accountDeletionHandler(), "DELETE");
it("rejects attempts to choose another account as the deletion target", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const response = await orgCall(
    db,
    ROUTES.privacyAccount,
    accountDeletionHandler(),
    alice.owner,
    "/api/privacy/account",
    "DELETE",
    { confirm: "DELETE", userId: bob.owner },
    randomUUID(),
  );
  expect(response.status).toBe(400);
  expect(await accountExists(db, bob.owner)).toBe(true);
  expect(await accountExists(db, alice.owner)).toBe(true);
});
