import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { sha256Hex } from "@recalino/core/plt";
import { getAutomaticLearningSession, requestAutomaticProcessing } from "@recalino/core/proc";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { recordingSourceHandler } from "./recording-routes";
import { classSourceHandler } from "./source-routes";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 2 });
afterAll(() => db.destroy());

// D105 (owner decision 2026-10-20): material added or removed after the learner's Process this
// session opens the session again. It waits for the next press; nothing regenerates on its own.
it("D105: a new recorded part or a removed source opens a processed session again; a replay does not", async () => {
  const x = await studyFixture(db);
  const ctx = { ...x.ctx, route: "probe" };
  const intent = () => getAutomaticLearningSession(db, x.ctx, x.session.id);
  const register = (key: string, displayName: string) =>
    recordingSourceHandler()({
      db,
      ctx,
      request: new Request("https://recalino.test/api/recordings", {
        method: "POST",
        headers: { "idempotency-key": key },
      }),
      input: {
        sessionId: x.session.id,
        kind: "audio",
        mimeType: "audio/webm",
        sizeBytes: 3,
        sha256: sha256Hex(displayName),
        displayName,
        durationMs: 1000,
        parts: [],
      },
    });
  // A part recorded before any press makes the intent, still waiting for the learner.
  expect((await register(randomUUID(), "Part 1")).status).toBe(201);
  expect(await intent()).toMatchObject({ requestVersion: 1, requestedVersion: null });
  await requestAutomaticProcessing(db, x.ctx, x.session.id);
  const key = randomUUID();
  const part = await register(key, "Part 2");
  expect(part.status).toBe(201);
  const reopened = await intent();
  expect(reopened).toMatchObject({ requestVersion: 2, requestedVersion: 1 });
  // A replayed registration (a lost acknowledgement) is not new material.
  expect(await register(key, "Part 2")).toMatchObject({
    status: 201,
    body: { assetId: (part.body as { assetId: string }).assetId, replayed: true },
  });
  expect(await intent()).toEqual(reopened);
  await requestAutomaticProcessing(db, x.ctx, x.session.id);
  const detach = () =>
    classSourceHandler(
      x.session.id,
      (part.body as { assetId: string }).assetId,
    )({
      db,
      ctx,
      request: new Request(`https://recalino.test/api/classes/${x.session.id}/sources/x`, {
        method: "DELETE",
      }),
      input: undefined,
    });
  expect((await detach()).body).toEqual({ removed: true });
  const removed = await intent();
  expect(removed).toMatchObject({ requestVersion: 3, requestedVersion: 2 });
  // Detaching it again changes nothing.
  expect((await detach()).body).toEqual({ removed: true });
  expect(await intent()).toEqual(removed);
});

it("D105: another learner cannot register a part into the class or reopen it", async () => {
  const x = await studyFixture(db);
  const other = await studyFixture(db);
  await requestAutomaticProcessing(db, x.ctx, x.session.id);
  const before = await getAutomaticLearningSession(db, x.ctx, x.session.id);
  await expect(
    recordingSourceHandler()({
      db,
      ctx: { ...other.ctx, route: "probe" },
      request: new Request("https://recalino.test/api/recordings", {
        method: "POST",
        headers: { "idempotency-key": randomUUID() },
      }),
      input: {
        sessionId: x.session.id,
        kind: "audio",
        mimeType: "audio/webm",
        sizeBytes: 3,
        sha256: sha256Hex("Foreign part"),
        displayName: "Foreign part",
        durationMs: 1000,
        parts: [],
      },
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(before);
});
