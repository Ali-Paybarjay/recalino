import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { classesHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.classes, classesHandler());
it("lists only owned classes and hides foreign course and unit filters", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const response = await orgCall(
    db,
    ROUTES.classes,
    classesHandler(),
    alice.owner,
    "/api/classes",
    "GET",
  );
  expect(response.status).toBe(200);
  expect((await response.json()).items.map((item: { id: string }) => item.id)).toEqual([
    alice.session.id,
  ]);
  for (const query of [`courseId=${bob.course.id}`, `unitId=${bob.unit.id}`]) {
    const foreign = await orgCall(
      db,
      ROUTES.classes,
      classesHandler(),
      alice.owner,
      `/api/classes?${query}`,
      "GET",
    );
    expect(foreign.status).toBe(404);
  }
  const injected = await orgCall(
    db,
    ROUTES.classes,
    classesHandler(),
    alice.owner,
    "/api/classes",
    "POST",
    { courseId: bob.course.id },
    randomUUID(),
  );
  expect(injected.status).toBe(404);
});
it("replays class creation without creating a second class", async () => {
  const alice = await orgFixture(db);
  const key = randomUUID();
  const one = await orgCall(
    db,
    ROUTES.classes,
    classesHandler(),
    alice.owner,
    "/api/classes",
    "POST",
    {},
    key,
  );
  const two = await orgCall(
    db,
    ROUTES.classes,
    classesHandler(),
    alice.owner,
    "/api/classes",
    "POST",
    {},
    key,
  );
  expect(one.status).toBe(201);
  expect(await two.json()).toEqual(await one.json());
});
