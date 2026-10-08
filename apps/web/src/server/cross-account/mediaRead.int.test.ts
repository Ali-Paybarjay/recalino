import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { mediaReadHandler } from "../media-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.mediaRead, mediaReadHandler(randomUUID()));
it("denies foreign identifiers before reading storage or dispatching providers", async () => {
  const [alice, bob] = await Promise.all([orgFixture(db), orgFixture(db)]);
  const row = await db
    .insertInto("media.asset")
    .values({
      user_id: bob.owner,
      session_id: bob.session.id,
      kind: "tts",
      cache_key: randomUUID(),
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      request: "{}",
      generation: "{}",
      synthetic: true,
      state: "ready",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = row.id;
  for (const method of ["GET"]) {
    const response = await orgCall(
      db,
      ROUTES.mediaRead,
      mediaReadHandler(id),
      alice.owner,
      ROUTES.mediaRead.path.replace("[id]", id),
      method,
      method === "GET" ? undefined : { exportAllowed: true },
      randomUUID(),
    );
    expect(response.status).toBe(404);
  }
});
