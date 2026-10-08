import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { learnerNotifications } from "../plt";
import { readClassProcessingReview, recordProcessingNotification } from "../proc";
import { readAdminSnapshot } from "./admin-read";
import { requestClassProcessingReview } from "./processing-review";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
async function fixture() {
  const x = await studyFixture(db);
  const base = {
    user_id: x.ctx.userId,
    session_id: x.session.id,
    operation_key: randomUUID(),
    request_hash: "synthetic-review",
    sources_version: 0,
    source_fingerprint: "a".repeat(64),
    input_snapshot: "{}",
    settings: "{}",
    requested_amounts: "{}",
    reservation_id: randomUUID(),
    kind: "class",
    state: "failed",
    last_error: "processing_budget_session",
  };
  const run = await db
    .insertInto("proc.processing_run")
    .values(base)
    .returning("id")
    .executeTakeFirstOrThrow();
  return {
    ...x,
    base,
    runId: run.id,
    request: { sessionId: x.session.id, runId: run.id, requestId: randomUUID() },
  };
}

it("records one linked review across concurrent requests and reopens the existing task without reserving allowance or dispatching work", async () => {
  const x = await fixture();
  await sql`insert into ops.task_preference(task_id,state,reason) values(${`run:${x.runId}`},'dismissed','Synthetic prior decision')`.execute(
    db,
  );
  const counts = async () => ({
    jobs: await db
      .selectFrom("plt.job")
      .select("id")
      .where("payload", "@>", JSON.stringify({ userId: x.ctx.userId }))
      .execute(),
    reserves: await db
      .selectFrom("quota.reservation")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
    costs: await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
    messages: await db
      .selectFrom("support.thread")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  });
  const before = await counts();
  const results = await Promise.all([
    requestClassProcessingReview(db, x.ctx, x.request),
    requestClassProcessingReview(db, x.ctx, x.request),
    requestClassProcessingReview(db, x.ctx, { ...x.request, requestId: randomUUID() }),
  ]);
  for (const result of results)
    expect(result).toMatchObject({ state: "awaiting_review", runId: x.runId, canRequest: false });
  expect(await counts()).toEqual(before);
  const audit = await db
    .selectFrom("plt.audit_event")
    .select("id")
    .where("actor_id", "=", x.ctx.userId)
    .where("action", "=", "processing.review_requested")
    .execute();
  expect(audit).toHaveLength(1);
  expect(
    (
      await sql<{
        state: string;
      }>`select state from ops.task_preference where task_id=${`run:${x.runId}`}`.execute(db)
    ).rows[0]?.state,
  ).toBe("open");
});

it("hides other learners' classes, rejects a different run and binds an idempotency key to this class and run", async () => {
  const x = await fixture(),
    other = await fixture();
  await expect(requestClassProcessingReview(db, other.ctx, x.request)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    requestClassProcessingReview(db, x.ctx, { ...x.request, runId: other.runId }),
  ).rejects.toMatchObject({ code: "conflict" });
  await requestClassProcessingReview(db, x.ctx, x.request);
  await expect(
    requestClassProcessingReview(db, x.ctx, { ...x.request, runId: other.runId }),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  expect(await readClassProcessingReview(db, other.ctx, other.session.id)).toMatchObject({
    state: "not_requested",
  });
});

it("tracks the class's actual continuation and final notification while ignoring auxiliary runs", async () => {
  const x = await fixture();
  await requestClassProcessingReview(db, x.ctx, x.request);
  await db
    .insertInto("proc.processing_run")
    .values({
      ...x.base,
      kind: "auxiliary",
      state: "ready",
      last_error: null,
      operation_key: randomUUID(),
    })
    .execute();
  expect(await readClassProcessingReview(db, x.ctx, x.session.id)).toMatchObject({
    state: "awaiting_review",
    runId: x.runId,
  });
  const retry = await db
    .insertInto("proc.processing_run")
    .values({ ...x.base, state: "processing", last_error: null, operation_key: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  expect(await readClassProcessingReview(db, x.ctx, x.session.id)).toMatchObject({
    state: "retrying",
    runId: retry.id,
    requestedRunId: x.runId,
  });
  await db
    .updateTable("proc.processing_run")
    .set({ state: "ready", output_version_id: x.knowledge.id, updated_at: new Date() })
    .where("id", "=", retry.id)
    .execute();
  await Promise.all([
    recordProcessingNotification(db, x.ctx, retry.id),
    recordProcessingNotification(db, x.ctx, retry.id),
  ]);
  expect(await readClassProcessingReview(db, x.ctx, x.session.id)).toMatchObject({
    state: "resolved",
    runId: retry.id,
  });
  const inbox = await learnerNotifications(db, x.ctx);
  expect(inbox.items.filter((item) => item.kind === "processing_ready")).toHaveLength(1);
  expect(inbox.items[0]?.href).toBe(`/classes/${x.session.id}/notes`);
});

it("loads the explicitly selected old run before the admin's 50-run limit and returns only its class metadata and costs", async () => {
  const x = await fixture();
  for (let n = 0; n < 51; n++)
    await db
      .insertInto("proc.processing_run")
      .values({ ...x.base, operation_key: randomUUID() })
      .execute();
  const result = await readAdminSnapshot(
    db,
    { view: "processing", actorId: x.ctx.userId, runId: x.runId },
    {
      getUser: async () => ({ name: "Synthetic", email: "synthetic@example.test", language: "en" }),
    },
    {
      approvedPilot: {
        pilotId: "synthetic",
        version: "1",
        maximumParticipants: 10,
        periodDays: 30,
        amounts: { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 },
      },
      email: { configured: false, sender: null, replyTo: null, appLink: null },
      aiConfigured: false,
    },
  );
  expect(result.runs).toHaveLength(1);
  expect(result.runs?.[0]).toMatchObject({
    id: x.runId,
    sessionId: x.session.id,
    title: x.session.displayTitle,
  });
  expect(result.runs?.[0]?.costs?.actualMicros).toBe(0);
  for (const forbidden of ["input_snapshot", "settings", "blocks", "sourceRefs", "reservation_id"])
    expect(JSON.stringify(result)).not.toContain(forbidden);
});

it("keeps an old failed task readable but disallows retry after a newer class finishes, ignoring auxiliary runs", async () => {
  const x = await fixture();
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 20,
      sha256: "a".repeat(64),
      display_name: "Synthetic handout",
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: "synthetic-source",
      verified_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const content = await db
    .insertInto("src.content_version")
    .values({
      asset_id: asset.id,
      user_id: x.ctx.userId,
      origin_key: randomUUID(),
      sha256: "b".repeat(64),
      schema_version: "1",
      provenance: "machine_extraction",
      extraction_settings: "{}",
      units: JSON.stringify([{ id: "doc", kind: "document", start: 1 }]),
      blocks: JSON.stringify([
        { id: "text", kind: "paragraph", unitId: "doc", text: "Synthetic handout" },
      ]),
      request_hash: "synthetic-content",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
      selected_content_version_id: content.id,
    })
    .execute();
  await requestClassProcessingReview(db, x.ctx, x.request);
  const target = () =>
    readAdminSnapshot(
      db,
      { view: "processing", actorId: x.ctx.userId, runId: x.runId },
      {
        getUser: async () => ({
          name: "Synthetic",
          email: "synthetic@example.test",
          language: "en",
        }),
      },
      {
        approvedPilot: {
          pilotId: "synthetic",
          version: "1",
          maximumParticipants: 10,
          periodDays: 30,
          amounts: { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 },
        },
        email: { configured: false, sender: null, replyTo: null, appLink: null },
        aiConfigured: false,
      },
    );
  expect((await target()).runs?.[0]?.retryAllowed).toBe(true);
  await db
    .insertInto("proc.processing_run")
    .values({
      ...x.base,
      kind: "auxiliary",
      state: "ready",
      last_error: null,
      operation_key: randomUUID(),
    })
    .execute();
  expect((await target()).runs?.[0]?.retryAllowed).toBe(true);
  const complete = await db
    .insertInto("proc.processing_run")
    .values({
      ...x.base,
      state: "ready",
      last_error: null,
      output_version_id: x.knowledge.id,
      operation_key: randomUUID(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  expect((await target()).runs?.[0]).toMatchObject({
    id: x.runId,
    retryAllowed: false,
    review: { state: "resolved", runId: complete.id },
  });
  expect(await readClassProcessingReview(db, x.ctx, x.session.id)).toMatchObject({
    state: "resolved",
    runId: complete.id,
  });
});

it("resolves published partial class output with limitations while preserving source diagnostics and avoiding another provider attempt", async () => {
  const x = await fixture();
  await requestClassProcessingReview(db, x.ctx, x.request);
  const snapshot = JSON.stringify({
    sources: [
      {
        units: [
          { id: "audio-unit", kind: "audio", status: "partial", reason: "timestamps_unavailable" },
        ],
        blocks: [{ id: "audio-text", text: "Fully retained synthetic class transcript." }],
      },
    ],
  });
  const partial = await db
    .insertInto("proc.processing_run")
    .values({
      ...x.base,
      state: "partial_ready",
      last_error: null,
      input_snapshot: snapshot,
      output_version_id: x.knowledge.id,
      operation_key: randomUUID(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("proc.automatic_session")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      state: "blocked",
      run_id: x.runId,
      last_error: "processing_budget_session",
    })
    .execute();
  expect(await readClassProcessingReview(db, x.ctx, x.session.id)).toMatchObject({
    state: "awaiting_review",
    runId: partial.id,
    partialResult: true,
  });
  await db
    .updateTable("proc.automatic_session")
    .set({ state: "ready", last_error: null })
    .where("session_id", "=", x.session.id)
    .execute();
  expect((await readClassProcessingReview(db, x.ctx, x.session.id))?.state).toBe("awaiting_review");
  await db
    .updateTable("proc.automatic_session")
    .set({ state: "ready", run_id: partial.id, last_error: null })
    .where("session_id", "=", x.session.id)
    .execute();
  const counts = async () => ({
    audit: await db
      .selectFrom("plt.audit_event")
      .select("id")
      .where("actor_id", "=", x.ctx.userId)
      .where("action", "=", "processing.review_requested")
      .execute(),
    jobs: await db
      .selectFrom("plt.job")
      .select("id")
      .where("payload", "@>", JSON.stringify({ userId: x.ctx.userId }))
      .execute(),
    attempts: await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
    costs: await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  });
  const before = await counts();
  expect(before.audit).toHaveLength(1);
  for (const result of [
    await readClassProcessingReview(db, x.ctx, x.session.id),
    await requestClassProcessingReview(db, x.ctx, x.request),
  ])
    expect(result).toMatchObject({
      state: "resolved",
      runId: partial.id,
      requestedRunId: x.runId,
      partialResult: true,
      canRequest: false,
    });
  expect(await counts()).toEqual(before);
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select(["state", "input_snapshot", "output_version_id"])
      .where("id", "=", partial.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({
    state: "partial_ready",
    input_snapshot: JSON.parse(snapshot),
    output_version_id: x.knowledge.id,
  });
});
