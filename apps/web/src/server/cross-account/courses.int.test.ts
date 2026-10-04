import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { coursesHandler } from "../org-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.courses, coursesHandler());
it("lists only the caller’s courses and cannot assign new courses to another account", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const response = await orgCall(
    db,
    ROUTES.courses,
    coursesHandler(),
    alice.owner,
    "/api/courses",
    "GET",
  );
  expect(response.status).toBe(200);
  expect((await response.json()).map((item: { ownerId: string }) => item.ownerId)).toEqual([
    alice.owner,
  ]);
  const injected = await orgCall(
    db,
    ROUTES.courses,
    coursesHandler(),
    alice.owner,
    "/api/courses",
    "POST",
    { name: "Injected", ownerId: bob.owner },
    randomUUID(),
  );
  expect(injected.status).toBe(400);
});
it("requires a valid key and replays course creation without duplication", async () => {
  const alice = await orgFixture(db);
  const key = randomUUID();
  const body = { name: "Repeat me" };
  const noKey = await orgCall(
    db,
    ROUTES.courses,
    coursesHandler(),
    alice.owner,
    "/api/courses",
    "POST",
    body,
  );
  expect(noKey.status).toBe(400);
  const one = await orgCall(
    db,
    ROUTES.courses,
    coursesHandler(),
    alice.owner,
    "/api/courses",
    "POST",
    body,
    key,
  );
  const two = await orgCall(
    db,
    ROUTES.courses,
    coursesHandler(),
    alice.owner,
    "/api/courses",
    "POST",
    body,
    key,
  );
  expect(one.status).toBe(201);
  expect(await two.json()).toEqual(await one.json());
});
