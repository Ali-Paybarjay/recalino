import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { classMediaHandler } from "../media-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.classMedia, classMediaHandler(randomUUID()));
it("denies foreign identifiers before reading storage or dispatching providers", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const id = bob.session.id;
  for (const method of ["GET", "POST"]) {
    const response = await orgCall(
      db,
      ROUTES.classMedia,
      classMediaHandler(id),
      alice.owner,
      ROUTES.classMedia.path.replace("[id]", id),
      method,
      method === "GET"
        ? undefined
        : { kind: "tts", text: "A synthetic phrase.", exportAllowed: false },
      randomUUID(),
    );
    expect(response.status).toBe(404);
  }
});
