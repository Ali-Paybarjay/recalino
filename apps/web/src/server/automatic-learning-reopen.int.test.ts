import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { sha256Hex } from "@recalino/core/plt";
import { getAutomaticLearningSession } from "@recalino/core/proc";
import { acceptSourceNotice, readInputContract } from "@recalino/core/src";
import { afterAll, expect, it, vi } from "vitest";
import { processAutomaticFixtureSession } from "../../../../packages/core/test/automatic-learning-fixture";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { readAutomaticLearning } from "./automatic-learning";
import { recordingSourceHandler } from "./recording-routes";
import {
  classSourceHandler,
  classSourcesHandler,
  sourceHandler,
  sourcesHandler,
} from "./source-routes";

// Removing a source everywhere records a privacy receipt; its journal and cleanup are fixtures here.
vi.mock("./jobs", async (original) => ({ ...(await original<object>()), runJobsSoon: vi.fn() }));
vi.mock("./privacy", () => ({
  privacyDependencies: () => ({
    hooks: [
      {
        module: "fixture",
        tombstoneSession: async () => {},
        tombstoneAccount: async () => {},
        tombstoneSource: async () => {},
        cleanupSession: async () => {},
        cleanupAccount: async () => {},
        cleanupSource: async () => {},
      },
    ],
    deletionJournal: { record: async () => {} },
  }),
}));

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
  await processAutomaticFixtureSession(db, x.ctx, x.session.id);
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
  await processAutomaticFixtureSession(db, x.ctx, x.session.id);
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
  await processAutomaticFixtureSession(db, x.ctx, x.session.id);
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

// D105: a file added or attached outside an upload group, a changed selection and a source removed
// everywhere commit the new request version with the change itself, so a processed session never
// keeps its request for material the learner did not confirm.
async function processedWithAudio() {
  const x = await studyFixture(db);
  const ctx = { ...x.ctx, route: "probe" };
  await acceptSourceNotice(db, x.ctx, (await readInputContract(db)).noticeVersion, true);
  const addAudio = async (displayName: string, key = randomUUID()) => {
    const response = await sourcesHandler()({
      db,
      ctx,
      request: new Request("https://recalino.test/api/sources", {
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
    expect(response.status).toBe(201);
    return (response.body as { assetId: string }).assetId;
  };
  const processRequest = async () =>
    (await readAutomaticLearning(db, x.ctx, x.session.id)).processRequest;
  const intent = () => getAutomaticLearningSession(db, x.ctx, x.session.id);
  const assetId = await addAudio("Class audio");
  expect(await processRequest()).toBe("not_requested");
  await processAutomaticFixtureSession(db, x.ctx, x.session.id);
  expect(await processRequest()).toBe("requested");
  return { x, ctx, assetId, addAudio, processRequest, intent };
}

it("D105: a file added to a processed session opens it again; a replayed addition does not", async () => {
  const f = await processedWithAudio();
  const key = randomUUID();
  await f.addAudio("Second audio", key);
  expect(await f.processRequest()).toBe("new_material");
  const reopened = await f.intent();
  expect(reopened).toMatchObject({ requestVersion: 2, requestedVersion: 1 });
  await f.addAudio("Second audio", key);
  expect(await f.intent()).toEqual(reopened);
});

it("D105: a source attached to a processed session opens it again", async () => {
  const f = await processedWithAudio();
  const path = `https://recalino.test/api/classes/${f.x.session.id}/sources`;
  await classSourceHandler(
    f.x.session.id,
    f.assetId,
  )({ db, ctx: f.ctx, request: new Request(`${path}/x`, { method: "DELETE" }), input: undefined });
  await processAutomaticFixtureSession(db, f.x.ctx, f.x.session.id);
  expect(await f.processRequest()).toBe("requested");
  const attached = await classSourcesHandler(f.x.session.id)({
    db,
    ctx: f.ctx,
    request: new Request(path, { method: "POST" }),
    input: { assetId: f.assetId },
  });
  expect(attached.body).toMatchObject({ linkId: expect.any(String) });
  expect(await f.processRequest()).toBe("new_material");
  expect(await f.intent()).toMatchObject({ requestVersion: 3, requestedVersion: 2 });
});

it("D105: a changed source selection opens a processed session again", async () => {
  const f = await processedWithAudio();
  const updated = await classSourceHandler(
    f.x.session.id,
    f.assetId,
  )({
    db,
    ctx: f.ctx,
    request: new Request(`https://recalino.test/api/classes/${f.x.session.id}/sources/x`, {
      method: "PATCH",
    }),
    input: {
      role: "class_audio",
      selected: false,
      ranges: [],
      timeStatus: "unknown",
      contentVersionId: null,
    },
  });
  expect(updated.body).toEqual({ updated: true });
  expect(await f.processRequest()).toBe("new_material");
  expect(await f.intent()).toMatchObject({ requestVersion: 2, requestedVersion: 1 });
});

it("D105: a source removed everywhere opens a processed session again", async () => {
  const f = await processedWithAudio();
  const removed = await sourceHandler(f.assetId)({
    db,
    ctx: f.ctx,
    request: new Request(`https://recalino.test/api/sources/${f.assetId}`, { method: "DELETE" }),
    input: { mode: "all" },
  });
  expect(removed.status).toBe(202);
  expect(await f.processRequest()).toBe("new_material");
  expect(await f.intent()).toMatchObject({ requestVersion: 2, requestedVersion: 1 });
});
