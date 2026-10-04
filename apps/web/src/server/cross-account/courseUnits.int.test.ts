import { randomUUID } from "node:crypto";
import { listUnits } from "@recalino/core/org";
import { expect, it } from "vitest";
import { courseUnitsHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(
  db,
  ROUTES.courseUnits,
  courseUnitsHandler("00000000-0000-4000-8000-000000000000"),
);
it("cannot list or create units inside another learner’s course", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  for (const method of ["GET", "POST"]) {
    const response = await orgCall(
      db,
      ROUTES.courseUnits,
      courseUnitsHandler(bob.course.id),
      alice.owner,
      `/api/courses/${bob.course.id}/units`,
      method,
      method === "POST" ? { name: "Intruder" } : undefined,
      randomUUID(),
    );
    expect(response.status).toBe(404);
  }
  expect(await listUnits(db, bob.actor, bob.course.id)).toEqual([bob.unit]);
});
