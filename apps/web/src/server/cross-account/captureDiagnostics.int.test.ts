import { expect, it } from "vitest";
import { captureDiagnosticsHandler } from "../recording-routes";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(
  db,
  ROUTES.captureDiagnostics,
  captureDiagnosticsHandler(() => {}),
  "POST",
);
it("logs capture health under the caller only and refuses any class or recording reference", async () => {
  const owner = await orgFixture(db);
  const lines: Record<string, unknown>[] = [];
  const handler = captureDiagnosticsHandler((_level, _event, fields) => {
    lines.push(fields ?? {});
  });
  const call = (body: unknown) =>
    orgCall(
      db,
      ROUTES.captureDiagnostics,
      handler,
      owner.owner,
      "/api/recordings/diagnostics",
      "POST",
      body,
    );
  const accepted = await call({
    platform: "android",
    browser: "chrome",
    events: [{ ageMs: 0, event: { type: "visibility", visible: false } }],
  });
  expect(accepted.status).toBe(202);
  expect(lines).toEqual([
    expect.objectContaining({ user_id: owner.owner, capture_event: "visibility" }),
  ]);
  const refused = await call({
    platform: "android",
    browser: "chrome",
    events: [
      { ageMs: 0, event: { type: "visibility", visible: false, sessionId: owner.session.id } },
    ],
  });
  expect(refused.status).toBe(400);
  expect(lines).toHaveLength(1);
});
