import { getUnit } from "@recalino/core/org";
import { expect, it } from "vitest";
import { unitHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.unit, unitHandler("00000000-0000-4000-8000-000000000000"), "PATCH");
it("cannot rename, reorder or delete another learner’s unit", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  for (const method of ["PATCH", "DELETE"]) {
    const response = await orgCall(
      db,
      ROUTES.unit,
      unitHandler(bob.unit.id),
      alice.owner,
      `/api/units/${bob.unit.id}`,
      method,
      method === "PATCH" ? { name: "Intruder", position: 7 } : undefined,
    );
    expect(response.status).toBe(404);
  }
  expect(await getUnit(db, bob.actor, bob.unit.id)).toEqual(bob.unit);
});
