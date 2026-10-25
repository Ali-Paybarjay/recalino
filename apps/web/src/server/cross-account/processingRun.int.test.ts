import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { processingRunHandler } from "../processing-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.processingRun, processingRunHandler(randomUUID()));
it("treats missing and foreign run identifiers as not found without dispatching AI", async () => {
  const attacker = await orgFixture(db),
    id = randomUUID();
  const owner = await orgFixture(db);
  const foreignId = randomUUID();
  await db
    .insertInto("proc.processing_run")
    .values({
      id: foreignId,
      user_id: owner.owner,
      session_id: owner.session.id,
      operation_key: randomUUID(),
      request_hash: "synthetic-owner-fixture",
      sources_version: 0,
      source_fingerprint: "a".repeat(64),
      input_snapshot: "{}",
      settings: "{}",
      requested_amounts: "{}",
      reservation_id: randomUUID(),
      state: "failed",
    })
    .execute();
  for (const runId of [id, foreignId])
    for (const method of ["GET", "DELETE", "POST"]) {
      expect(
        (
          await orgCall(
            db,
            ROUTES.processingRun,
            processingRunHandler(runId),
            attacker.owner,
            `/api/runs/${runId}`,
            method,
            method === "POST" ? { action: "activate" } : undefined,
            randomUUID(),
          )
        ).status,
      ).toBe(404);
    }
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select("state")
      .where("id", "=", foreignId)
      .executeTakeFirst(),
  ).toEqual({ state: "failed" });
  for (const runId of [id, foreignId]) {
    const response = await orgCall(
      db,
      ROUTES.processingRun,
      processingRunHandler(runId),
      attacker.owner,
      `/api/runs/${runId}?includeSnapshot=1`,
      "GET",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("snapshot");
  }
});
