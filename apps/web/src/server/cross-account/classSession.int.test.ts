import { getSession } from "@recalino/core/org";
import { expect, it } from "vitest";
import { classSessionHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(
  db,
  ROUTES.classSession,
  classSessionHandler("00000000-0000-4000-8000-000000000000"),
);
it("refuses foreign class read, move and delete without modifying the owner’s class", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const response = await orgCall(
      db,
      ROUTES.classSession,
      classSessionHandler(bob.session.id),
      alice.owner,
      `/api/classes/${bob.session.id}`,
      method,
      method === "PATCH" ? { courseId: alice.course.id, title: "Intruder" } : undefined,
    );
    expect(response.status).toBe(404);
  }
  expect(await getSession(db, bob.actor, bob.session.id)).toEqual(bob.session);
  const moveToForeign = await orgCall(
    db,
    ROUTES.classSession,
    classSessionHandler(alice.session.id),
    alice.owner,
    `/api/classes/${alice.session.id}`,
    "PATCH",
    { courseId: bob.course.id },
  );
  expect(moveToForeign.status).toBe(404);
});
