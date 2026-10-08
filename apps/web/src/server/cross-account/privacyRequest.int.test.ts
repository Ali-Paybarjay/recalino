import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { privacyRequestHandler } from "../privacy-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.privacyRequest, privacyRequestHandler(randomUUID()));
it("keeps deletion receipts private to their owner", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const row = await db
    .insertInto("priv.deletion_request")
    .values({
      user_id: bob.owner,
      kind: "session",
      subject_id: bob.session.id,
      operation_key: randomUUID(),
      modules: ["src"],
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  expect(
    (
      await orgCall(
        db,
        ROUTES.privacyRequest,
        privacyRequestHandler(row.id),
        alice.owner,
        `/api/privacy/${row.id}`,
        "GET",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await orgCall(
        db,
        ROUTES.privacyRequest,
        privacyRequestHandler(row.id),
        bob.owner,
        `/api/privacy/${row.id}`,
        "GET",
      )
    ).status,
  ).toBe(200);
});
