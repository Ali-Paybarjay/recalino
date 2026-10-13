import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { defineRoute } from "../api";
import { captureDiagnosticsHandler } from "../recording-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
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
      randomUUID(),
    );
  const accepted = await call({
    platform: "android",
    browser: "chrome",
    events: [{ ageMs: 0, event: { type: "visibility", visible: false } }],
  });
  expect(await accepted.clone().json()).toEqual({ accepted: 1 });
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

it("logs one batch once per idempotency key, however often a keepalive request repeats it", async () => {
  const owner = await orgFixture(db);
  const lines: Record<string, unknown>[] = [];
  const route = defineRoute(
    ROUTES.captureDiagnostics,
    captureDiagnosticsHandler((_level, _event, fields) => {
      lines.push(fields ?? {});
    }),
    routeDeps(db),
  );
  const body = {
    platform: "android",
    browser: "chrome",
    events: [
      {
        ageMs: 0,
        event: { type: "gap", part: 1, offsetMs: 5000, missingMs: 60000, cause: "hidden" },
      },
    ],
  };
  const key = randomUUID();
  const send = (payload: unknown) => {
    const request = requestAs(owner.owner, "/api/recordings/diagnostics", "POST", payload);
    request.headers.set("idempotency-key", key);
    return route(request);
  };
  expect((await send(body)).status).toBe(202);
  const replay = await send(body);
  expect(replay.status).toBe(202);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect(lines).toHaveLength(1);
  // The same key with other content is refused, not logged.
  const other = await send({
    ...body,
    events: [{ ageMs: 1, event: { type: "visibility", visible: true } }],
  });
  expect(other.status).toBeGreaterThanOrEqual(400);
  expect(lines).toHaveLength(1);
  // A request without a key is refused: every batch carries one.
  const bare = await route(requestAs(owner.owner, "/api/recordings/diagnostics", "POST", body));
  expect(bare.status).toBe(400);
});
