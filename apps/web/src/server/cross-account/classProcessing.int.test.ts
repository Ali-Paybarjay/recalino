import { randomUUID } from "node:crypto";
import { listRuns } from "@recalino/core/proc";
import { expect, it } from "vitest";
import { classProcessingHandler } from "../processing-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.classProcessing, classProcessingHandler(randomUUID()));
it("does not disclose or start processing for a foreign class", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  expect(
    (
      await orgCall(
        db,
        ROUTES.classProcessing,
        classProcessingHandler(owner.session.id),
        attacker.owner,
        `/api/classes/${owner.session.id}/processing`,
        "GET",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await orgCall(
        db,
        ROUTES.classProcessing,
        classProcessingHandler(owner.session.id),
        attacker.owner,
        `/api/classes/${owner.session.id}/processing`,
        "POST",
        { expectedFingerprint: "forged", expectedSourcesVersion: 0 },
        randomUUID(),
      )
    ).status,
  ).toBe(404);
});

// D105 (owner decision 2026-10-20): the old manual confirmation cannot start a run around the
// learner's Process this session; it is refused for the owner too, and starts nothing.
it("refuses the legacy confirmation for the owner and starts no run", async () => {
  const owner = await orgFixture(db);
  const response = await orgCall(
    db,
    ROUTES.classProcessing,
    classProcessingHandler(owner.session.id),
    owner.owner,
    `/api/classes/${owner.session.id}/processing`,
    "POST",
    { expectedFingerprint: "a".repeat(64), expectedSourcesVersion: 0 },
    randomUUID(),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "conflict", details: { fields: { processing: ["process_session_required"] } } },
  });
  expect(await listRuns(db, owner.actor, owner.session.id)).toEqual([]);
  const listed = await orgCall(
    db,
    ROUTES.classProcessing,
    classProcessingHandler(owner.session.id),
    owner.owner,
    `/api/classes/${owner.session.id}/processing`,
    "GET",
  );
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual([]);
});
