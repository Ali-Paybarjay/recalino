import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import { createDatabase, type Database } from "../db";
import { createSession } from "../org";
import {
  beginAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  getAutomaticLearningSession,
  listPendingAutomaticLearning,
  requestAutomaticLearning,
  updateAutomaticLearningProgress,
} from "./automatic-state";

// These writes are synthetic and deliberately cannot inherit a cloud DATABASE_URL.
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());

// Intent state needs an account/class, and does not depend on note/card generation.
async function studyFixture(database: Database) {
  const userId = await createAuthUser();
  const ctx = { userId, requestId: randomUUID() };
  const now = new Date();
  const intent = await createSignupIntent(database, {
    versions: CURRENT_VERSIONS,
    ttlSeconds: 60,
    now,
  });
  await completeSignIn(database, { userId, intentId: intent.id, now });
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(database, ctx, change, { now });
  await acceptDocuments(
    database,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  return { ctx, session: await createSession(database, ctx, {}, { key: randomUUID(), now }) };
}

it("leaves historical classes disabled until a learner expresses intent", async () => {
  const x = await studyFixture(db);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  expect(
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === x.session.id),
  ).toBe(false);
  const first = await requestAutomaticLearning(db, x.ctx, x.session.id, { changed: false });
  const poll = await requestAutomaticLearning(db, x.ctx, x.session.id, { changed: false });
  expect(first.requestVersion).toBe(1);
  expect(poll).toEqual(first);
});

it("serializes a batch, replays lost acknowledgements and cannot silently seal another batch", async () => {
  const x = await studyFixture(db);
  const batch = randomUUID();
  const started = await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batch);
  expect(await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batch)).toEqual(started);
  await expect(
    beginAutomaticLearningBatch(db, x.ctx, x.session.id, randomUUID()),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    completeAutomaticLearningBatch(db, x.ctx, x.session.id, randomUUID()),
  ).rejects.toMatchObject({ code: "conflict" });
  const changed = await requestAutomaticLearning(db, x.ctx, x.session.id);
  expect(changed).toMatchObject({ requestVersion: started.requestVersion + 1, batchId: batch });
  expect(await requestAutomaticLearning(db, x.ctx, x.session.id, { changed: false })).toEqual(
    changed,
  );
  const complete = await completeAutomaticLearningBatch(db, x.ctx, x.session.id, batch);
  expect(complete).toMatchObject({
    requestVersion: changed.requestVersion + 1,
    batchId: null,
    batchStartedAt: null,
    lastBatchId: batch,
  });
  expect(await completeAutomaticLearningBatch(db, x.ctx, x.session.id, batch)).toEqual(complete);
  expect(await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batch)).toEqual(complete);
});

it("fences an open upload batch from ready/processing progress", async () => {
  const x = await studyFixture(db);
  const batch = await beginAutomaticLearningBatch(db, x.ctx, x.session.id, randomUUID());
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, batch.requestVersion, {
      state: "processing",
    }),
  ).toBeNull();
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, batch.requestVersion, {
      state: "ready",
    }),
  ).toBeNull();
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(batch);
  expect(
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === x.session.id),
  ).toBe(false);
});

it("does not let an old worker overwrite a newer learner mutation or its error", async () => {
  const x = await studyFixture(db);
  const initial = await requestAutomaticLearning(db, x.ctx, x.session.id);
  const blocked = await updateAutomaticLearningProgress(
    db,
    x.ctx,
    x.session.id,
    initial.requestVersion,
    { state: "blocked", lastError: "quota_insufficient" },
  );
  expect(blocked?.lastError).toBe("quota_insufficient");
  const newer = await requestAutomaticLearning(db, x.ctx, x.session.id);
  expect(newer.lastError).toBeNull();
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, initial.requestVersion, {
      state: "ready",
      lastError: null,
    }),
  ).toBeNull();
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(newer);
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, newer.requestVersion, {
      state: "ready",
      lastError: null,
    }),
  ).toMatchObject({ state: "ready", lastError: null });
});

it("makes concurrent initialization and batch replays one durable intent", async () => {
  const x = await studyFixture(db);
  const initialized = await Promise.all(
    [1, 2].map(() => requestAutomaticLearning(db, x.ctx, x.session.id, { changed: false })),
  );
  expect(initialized[0]).toEqual(initialized[1]);
  const batchId = randomUUID();
  const started = await Promise.all(
    [1, 2].map(() => beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId)),
  );
  expect(started[0]).toEqual(started[1]);
  const complete = await Promise.all(
    [1, 2].map(() => completeAutomaticLearningBatch(db, x.ctx, x.session.id, batchId)),
  );
  expect(complete[0]).toEqual(complete[1]);
  expect(complete[0]?.requestVersion).toBe(3);
});

it("rejects another owner's class before reading or changing intent", async () => {
  const x = await studyFixture(db);
  const other = await studyFixture(db);
  const row = await requestAutomaticLearning(db, x.ctx, x.session.id);
  for (const action of [
    () => getAutomaticLearningSession(db, other.ctx, x.session.id),
    () => requestAutomaticLearning(db, other.ctx, x.session.id),
    () => beginAutomaticLearningBatch(db, other.ctx, x.session.id, randomUUID()),
    () => completeAutomaticLearningBatch(db, other.ctx, x.session.id, randomUUID()),
    () =>
      updateAutomaticLearningProgress(db, other.ctx, x.session.id, row.requestVersion, {
        state: "ready",
      }),
  ])
    await expect(action()).rejects.toMatchObject({ code: "not_found" });
  await expect(
    updateAutomaticLearningProgress(db, x.ctx, x.session.id, row.requestVersion, {
      state: "processing",
      runId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(row);
});

it("reconciles pending intent only while its class and owner are live", async () => {
  const x = await studyFixture(db);
  const y = await studyFixture(db);
  await requestAutomaticLearning(db, x.ctx, x.session.id, {
    now: new Date("2020-01-01T00:00:00Z"),
  });
  await requestAutomaticLearning(db, y.ctx, y.session.id, {
    now: new Date("2020-01-02T00:00:00Z"),
  });
  expect((await listPendingAutomaticLearning(db, 250)).map((row) => row.sessionId)).toContain(
    x.session.id,
  );
  await db
    .updateTable("org.class_session")
    .set({ deleted_at: new Date(), deletion_request_id: randomUUID() })
    .where("id", "=", x.session.id)
    .execute();
  await db
    .updateTable("acc.user_account")
    .set({ deleted_at: new Date() })
    .where("id", "=", y.ctx.userId)
    .execute();
  const pending = (await listPendingAutomaticLearning(db, 250)).map((row) => row.sessionId);
  expect(pending).not.toContain(x.session.id);
  expect(pending).not.toContain(y.session.id);
  await expect(requestAutomaticLearning(db, x.ctx, x.session.id)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("reconciles temporary service blocks without automatically retrying quota or uncertain provider outcomes", async () => {
  const x = await studyFixture(db);
  const row = await requestAutomaticLearning(db, x.ctx, x.session.id, {
    now: new Date("2019-01-01T00:00:00Z"),
  });
  for (const code of [
    "configuration_unavailable",
    "storage_unavailable",
    "settings_changed",
    "quota_insufficient",
    "provider_outcome_unresolved",
    "processing_failed",
  ]) {
    await updateAutomaticLearningProgress(
      db,
      x.ctx,
      x.session.id,
      row.requestVersion,
      { state: "blocked", lastError: code },
      new Date("2019-01-01T00:00:00Z"),
    );
    const pending = (await listPendingAutomaticLearning(db, 250)).some(
      (item) => item.sessionId === x.session.id,
    );
    expect(pending).toBe(
      ["configuration_unavailable", "storage_unavailable", "settings_changed"].includes(code),
    );
  }
});

it("filters deleted classes and accounts before applying the reconciliation limit", async () => {
  const deletedClass = await studyFixture(db);
  const deletedOwner = await studyFixture(db);
  const live = await studyFixture(db);
  for (const [fixture, date] of [
    [deletedClass, "2001-01-01T00:00:00Z"],
    [deletedOwner, "2001-01-02T00:00:00Z"],
    [live, "2001-01-03T00:00:00Z"],
  ] as const)
    await requestAutomaticLearning(db, fixture.ctx, fixture.session.id, { now: new Date(date) });
  await db
    .updateTable("org.class_session")
    .set({ deleted_at: new Date(), deletion_request_id: randomUUID() })
    .where("id", "=", deletedClass.session.id)
    .execute();
  await db
    .updateTable("acc.user_account")
    .set({ deleted_at: new Date() })
    .where("id", "=", deletedOwner.ctx.userId)
    .execute();
  expect(await listPendingAutomaticLearning(db, 1)).toEqual([
    expect.objectContaining({ sessionId: live.session.id, userId: live.ctx.userId }),
  ]);
  await updateAutomaticLearningProgress(db, live.ctx, live.session.id, 1, { state: "ready" });
});

it("rejects a late progress write for an older run even when explicit retry kept the same intent version", async () => {
  const x = await studyFixture(db);
  const intent = await requestAutomaticLearning(db, x.ctx, x.session.id);
  const syntheticRun = async (createdAt: Date) =>
    db
      .insertInto("proc.processing_run")
      .values({
        user_id: x.ctx.userId,
        session_id: x.session.id,
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        source_fingerprint: randomUUID(),
        sources_version: 0,
        input_snapshot: "{}",
        settings: "{}",
        requested_amounts: "{}",
        reservation_id: randomUUID(),
        state: "failed",
        created_at: createdAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  const old = await syntheticRun(new Date("2020-01-01T00:00:00Z"));
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, intent.requestVersion, {
      state: "blocked",
      runId: old.id,
    }),
  ).toMatchObject({ runId: old.id });
  const newer = await syntheticRun(new Date("2020-01-01T00:00:01Z"));
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, intent.requestVersion, {
      state: "processing",
      runId: newer.id,
    }),
  ).toMatchObject({ runId: newer.id });
  expect(
    await updateAutomaticLearningProgress(db, x.ctx, x.session.id, intent.requestVersion, {
      state: "ready",
      runId: old.id,
    }),
  ).toBeNull();
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toMatchObject({
    requestVersion: intent.requestVersion,
    state: "processing",
    runId: newer.id,
  });
});
