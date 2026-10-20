import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "kysely";
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
import { createSession, releaseCaptureLease, renewCaptureLease } from "../org";
import {
  beginAutomaticLearningBatch,
  cancelAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  getAutomaticLearningSession,
  listPendingAutomaticLearning,
  reconcileAutomaticLearningBatch,
  registerAutomaticLearningFile,
  requestAutomaticLearning,
  requestAutomaticProcessing,
  skipAutomaticLearningFile,
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

async function batchSource(
  x: Awaited<ReturnType<typeof studyFixture>>,
  state: "pending" | "verified" | "rejected" | "audio",
) {
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: state === "audio" ? "audio" : "text",
      declared_mime: state === "audio" ? "audio/webm" : "text/plain",
      size_bytes: 3,
      sha256: "a".repeat(64),
      display_name: "Synthetic batch file",
      contract_version: "1",
      retention: state === "audio" ? "device_only" : "persistent",
      duration_ms: state === "audio" ? 1000 : null,
      verified_at: state === "verified" ? new Date() : null,
      operation_key: randomUUID(),
      request_hash: randomUUID(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: asset.id,
      role: state === "audio" ? "class_audio" : "class_material",
      selected: state === "verified" || state === "audio",
    })
    .execute();
  if (state !== "audio")
    await db
      .insertInto("src.upload_session")
      .values({
        user_id: x.ctx.userId,
        asset_id: asset.id,
        reservation_id: randomUUID(),
        state,
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();
  return asset.id;
}

it("durably declares the immutable group, rejects missing files, and seals server receipts once without client completion", async () => {
  const x = await studyFixture(db);
  const batchId = randomUUID(),
    firstId = randomUUID(),
    secondId = randomUUID();
  const initial = await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [
    firstId,
    secondId,
  ]);
  expect(initial.batchFiles).toEqual([
    { fileId: firstId, sourceId: null, skipped: false, acknowledged: false },
    { fileId: secondId, sourceId: null, skipped: false, acknowledged: false },
  ]);
  await expect(
    beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [firstId]),
  ).rejects.toMatchObject({ code: "conflict" });
  const one = await batchSource(x, "verified"),
    two = await batchSource(x, "pending");
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
    batchId,
    fileId: firstId,
    sourceId: one,
  });
  expect((await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id))?.batchId).toBe(batchId);
  await expect(
    completeAutomaticLearningBatch(db, x.ctx, x.session.id, batchId),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
    batchId,
    fileId: secondId,
    sourceId: two,
  });
  expect((await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id))?.batchId).toBe(batchId);
  await db
    .updateTable("src.asset")
    .set({ verified_at: new Date() })
    .where("id", "=", two)
    .execute();
  await db
    .updateTable("src.upload_session")
    .set({ state: "verified" })
    .where("asset_id", "=", two)
    .execute();
  const [sealed, replay] = await Promise.all([
    reconcileAutomaticLearningBatch(db, x.ctx, x.session.id),
    reconcileAutomaticLearningBatch(db, x.ctx, x.session.id),
  ]);
  expect(sealed).toEqual(replay);
  expect(sealed).toMatchObject({ batchId: null, lastBatchId: batchId, requestVersion: 2 });
  expect(await completeAutomaticLearningBatch(db, x.ctx, x.session.id, batchId)).toEqual(sealed);
  expect(
    await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
      batchId,
      fileId: secondId,
      sourceId: two,
    }),
  ).toEqual(sealed);
});

it("retains rejected entries until the learner explicitly skips them and detaches their blocking source", async () => {
  const x = await studyFixture(db),
    batchId = randomUUID(),
    goodId = randomUUID(),
    badId = randomUUID();
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [goodId, badId]);
  const good = await batchSource(x, "verified"),
    bad = await batchSource(x, "rejected");
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
    batchId,
    fileId: goodId,
    sourceId: good,
  });
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
    batchId,
    fileId: badId,
    sourceId: bad,
  });
  expect(await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id)).toMatchObject({
    batchId,
    lastError: "upload_needs_attention",
  });
  await skipAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId: badId });
  expect(
    await db
      .selectFrom("src.session_source")
      .select("active")
      .where("asset_id", "=", bad)
      .executeTakeFirstOrThrow(),
  ).toEqual({ active: false });
  const sealed = await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id);
  expect(sealed).toMatchObject({ batchId: null, lastError: null });
  expect(
    await skipAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId: badId }),
  ).toEqual(sealed);
});

it("keeps declared batches visible to recovery and permits saved audio to enter its guarded awaiting-upload workflow", async () => {
  const x = await studyFixture(db),
    batchId = randomUUID(),
    fileId = randomUUID();
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [fileId]);
  expect(
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === x.session.id),
  ).toBe(true);
  await expect(
    skipAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  const sourceId = await batchSource(x, "audio");
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId, sourceId });
  expect(await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id)).toMatchObject({
    batchId: null,
  });
});

it("cannot acknowledge foreign or undeclared sources and bounds declared groups by the active input contract", async () => {
  const x = await studyFixture(db),
    other = await studyFixture(db),
    batchId = randomUUID(),
    fileId = randomUUID();
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [fileId]);
  const ownSource = await batchSource(x, "verified"),
    foreignSource = await batchSource(other, "verified");
  await expect(
    registerAutomaticLearningFile(db, x.ctx, x.session.id, {
      batchId,
      fileId,
      sourceId: foreignSource,
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    registerAutomaticLearningFile(db, x.ctx, x.session.id, {
      batchId,
      fileId: randomUUID(),
      sourceId: ownSource,
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    registerAutomaticLearningFile(db, other.ctx, x.session.id, {
      batchId,
      fileId,
      sourceId: foreignSource,
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    beginAutomaticLearningBatch(
      db,
      other.ctx,
      other.session.id,
      randomUUID(),
      new Date(),
      Array.from({ length: 31 }, () => randomUUID()),
    ),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

it("provisionally binds audio without authorizing upload, cancels once, and fences late receipts while allowing a new group", async () => {
  const x = await studyFixture(db),
    batchId = randomUUID(),
    fileId = randomUUID();
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [fileId]);
  const sourceId = await batchSource(x, "audio");
  await registerAutomaticLearningFile(
    db,
    x.ctx,
    x.session.id,
    { batchId, fileId, sourceId },
    new Date(),
    false,
  );
  expect((await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id))?.batchId).toBe(batchId);
  const cancelled = await cancelAutomaticLearningBatch(db, x.ctx, x.session.id, batchId);
  expect(cancelled).toMatchObject({
    batchId: null,
    lastBatchId: batchId,
    state: "blocked",
    lastError: "upload_batch_cancelled",
  });
  expect(await cancelAutomaticLearningBatch(db, x.ctx, x.session.id, batchId)).toEqual(cancelled);
  expect(await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId)).toEqual(cancelled);
  await expect(
    registerAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId, sourceId }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(
    await db
      .selectFrom("src.session_source")
      .select("active")
      .where("asset_id", "=", sourceId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ active: false });
  expect(
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === x.session.id),
  ).toBe(false);
  const replacement = await beginAutomaticLearningBatch(
    db,
    x.ctx,
    x.session.id,
    randomUUID(),
    new Date(),
    [randomUUID()],
  );
  expect(replacement).toMatchObject({ state: "waiting_sources", lastError: null });
  expect(replacement.batchId).not.toBe(batchId);
});

it("keeps a reused source attached and selected when only one of its declared file receipts is skipped", async () => {
  const x = await studyFixture(db),
    batchId = randomUUID(),
    firstId = randomUUID(),
    secondId = randomUUID();
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [
    firstId,
    secondId,
  ]);
  const sourceId = await batchSource(x, "verified");
  for (const fileId of [firstId, secondId])
    await registerAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId, sourceId });
  await skipAutomaticLearningFile(db, x.ctx, x.session.id, { batchId, fileId: firstId });
  expect(
    await db
      .selectFrom("src.session_source")
      .select(["active", "selected"])
      .where("asset_id", "=", sourceId)
      .where("session_id", "=", x.session.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ active: true, selected: true });
  expect(await reconcileAutomaticLearningBatch(db, x.ctx, x.session.id)).toMatchObject({
    batchId: null,
    lastError: null,
  });
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
  // D105: only material the learner asked to process is pending.
  await requestAutomaticProcessing(db, x.ctx, x.session.id, new Date("2020-01-01T00:00:00Z"));
  await requestAutomaticProcessing(db, y.ctx, y.session.id, new Date("2020-01-02T00:00:00Z"));
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
  const row = await requestAutomaticProcessing(
    db,
    x.ctx,
    x.session.id,
    new Date("2019-01-01T00:00:00Z"),
  );
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
    await requestAutomaticProcessing(db, fixture.ctx, fixture.session.id, new Date(date));
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

// D105 (owner decision 2026-10-20): a session is processed only after "Process this session".
it("D105: records the learner's request once, under the account lock, for the current material", async () => {
  const x = await studyFixture(db);
  const pending = async () =>
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === x.session.id);
  // Material arrives (a part, a file): the intent exists, but nothing is pending for lesson work.
  const opened = await requestAutomaticLearning(db, x.ctx, x.session.id);
  expect(opened).toMatchObject({ requestVersion: 1, requestedVersion: null, requestedAt: null });
  expect(await pending()).toBe(false);
  // An old time sorts this class before other fixtures' pending rows within the read limit.
  const now = new Date("2021-01-01T00:00:00Z");
  const [first, double] = await Promise.all([
    requestAutomaticProcessing(db, x.ctx, x.session.id, now),
    requestAutomaticProcessing(db, x.ctx, x.session.id, now),
  ]);
  expect(first).toEqual(double);
  expect(first).toMatchObject({
    requestVersion: 1,
    requestedVersion: 1,
    requestedAt: now.toISOString(),
    state: "waiting_sources",
    lastError: null,
  });
  expect(await pending()).toBe(true);
  // Pressing again later has no second effect.
  expect(await requestAutomaticProcessing(db, x.ctx, x.session.id, new Date())).toEqual(first);
  // New material reopens the session: it waits for the next press and is no longer pending.
  const reopened = await requestAutomaticLearning(db, x.ctx, x.session.id);
  expect(reopened).toMatchObject({ requestVersion: 2, requestedVersion: 1 });
  expect(await pending()).toBe(false);
  expect(await requestAutomaticProcessing(db, x.ctx, x.session.id, now)).toMatchObject({
    requestVersion: 2,
    requestedVersion: 2,
  });
  expect(await pending()).toBe(true);
});

it("D105: a first press creates the intent of a class that has none", async () => {
  const x = await studyFixture(db);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  expect(await requestAutomaticProcessing(db, x.ctx, x.session.id)).toMatchObject({
    sessionId: x.session.id,
    requestVersion: 1,
    requestedVersion: 1,
    batchId: null,
  });
});

it("D105: refuses while a recording or an upload group of the class is open, changing nothing", async () => {
  const x = await studyFixture(db);
  await renewCaptureLease(db, x.ctx, x.session.id);
  await expect(requestAutomaticProcessing(db, x.ctx, x.session.id)).rejects.toMatchObject({
    code: "conflict",
    details: { fields: { session: ["capture_in_progress"] } },
  });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
  await releaseCaptureLease(db, x.ctx, x.session.id);
  const batch = await beginAutomaticLearningBatch(db, x.ctx, x.session.id, randomUUID());
  await expect(requestAutomaticProcessing(db, x.ctx, x.session.id)).rejects.toMatchObject({
    code: "conflict",
    details: { fields: { batch: ["batch_open"] } },
  });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toEqual(batch);
  // An upload group alone stays visible to recovery without a request.
  const manifest = await studyFixture(db);
  await beginAutomaticLearningBatch(
    db,
    manifest.ctx,
    manifest.session.id,
    randomUUID(),
    new Date("2021-01-01T00:00:00Z"),
    [randomUUID()],
  );
  expect(
    (await listPendingAutomaticLearning(db, 250)).some(
      (row) => row.sessionId === manifest.session.id,
    ),
  ).toBe(true);
});

it("D105: refuses another owner's class before reading or changing its intent", async () => {
  const x = await studyFixture(db);
  const other = await studyFixture(db);
  await expect(requestAutomaticProcessing(db, other.ctx, x.session.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toBeNull();
});

it("D105: the schema keeps a request paired with its time and never ahead of the material", async () => {
  const x = await studyFixture(db);
  await requestAutomaticLearning(db, x.ctx, x.session.id);
  const write = (values: { requested_version: number | null; requested_at: Date | null }) =>
    db
      .updateTable("proc.automatic_session")
      .set(values)
      .where("session_id", "=", x.session.id)
      .execute();
  for (const values of [
    { requested_version: 1, requested_at: null },
    { requested_version: null, requested_at: new Date() },
    { requested_version: 2, requested_at: new Date() },
    { requested_version: 0, requested_at: new Date() },
  ])
    await expect(write(values)).rejects.toThrow(/check constraint/);
});

it("D105: the migration backfills every existing intent as already requested", async () => {
  const x = await studyFixture(db);
  const updatedAt = new Date("2026-10-19T08:00:00Z");
  await requestAutomaticLearning(db, x.ctx, x.session.id);
  await requestAutomaticLearning(db, x.ctx, x.session.id, { now: updatedAt });
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      "../../../../supabase/migrations/20261020120000_proc_automatic_session_learner_request.sql",
    ),
    "utf8",
  );
  const backfill = /^update proc\.automatic_session[^;]*;/m.exec(migration)?.[0];
  if (!backfill) throw new Error("The migration has no backfill statement");
  const rollback = new Error("roll back the synthetic backfill");
  // The statement runs as the migration ran it, then rolls back: other rows stay as they are.
  await expect(
    db.transaction().execute(async (tx) => {
      await sql.raw(backfill).execute(tx);
      expect(
        await tx
          .selectFrom("proc.automatic_session")
          .select(["request_version", "requested_version", "requested_at"])
          .where("session_id", "=", x.session.id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ request_version: 2, requested_version: 2, requested_at: updatedAt });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toMatchObject({
    requestVersion: 2,
    requestedVersion: null,
  });
});
