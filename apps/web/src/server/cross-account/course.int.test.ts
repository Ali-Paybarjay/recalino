import { getCourse } from "@recalino/core/org";
import { expect, it } from "vitest";
import { courseHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.course, courseHandler("00000000-0000-4000-8000-000000000000"));
it("returns the same not-found result for foreign course reads, updates and deletion", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const response = await orgCall(
      db,
      ROUTES.course,
      courseHandler(bob.course.id),
      alice.owner,
      `/api/courses/${bob.course.id}`,
      method,
      method === "PATCH" ? { name: "Intruder" } : undefined,
    );
    expect(response.status).toBe(404);
  }
  expect((await getCourse(db, bob.actor, bob.course.id)).name).toBe(bob.course.name);
});
