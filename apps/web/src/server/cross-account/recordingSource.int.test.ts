import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { recordingSourceHandler } from "../recording-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.recordingSource, recordingSourceHandler(), "POST");
it("refuses attaching a local recording to another account's class", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  const response = await orgCall(
    db,
    ROUTES.recordingSource,
    recordingSourceHandler(),
    attacker.owner,
    "/api/recordings",
    "POST",
    {
      sessionId: owner.session.id,
      kind: "audio",
      mimeType: "audio/webm",
      sizeBytes: 5,
      sha256: "a".repeat(64),
      displayName: "Private recording",
      durationMs: 5000,
      parts: [],
    },
    randomUUID(),
  );
  expect(response.status).toBe(404);
});
