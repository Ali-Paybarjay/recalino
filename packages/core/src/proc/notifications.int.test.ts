import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { publishKnowledgeVersion } from "../lkm";
import { createSession } from "../org";
import { learnerNotifications } from "../plt";
import { reconcileProcessingNotifications, recordProcessingNotification } from "./notifications";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
it("deduplicates concurrent terminal completion hooks and routes full, partial and failed results", async () => {
  const x = await studyFixture(db);
  const partialOutput = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(
      tx,
      x.ctx,
      {
        sessionId: x.session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: "synthetic-partial",
        model: x.model,
        sources: [],
        explanationLanguage: "en",
        generation: { provider: "synthetic-fixture", mode: "mock" },
      },
      new Date(),
    ),
  );
  for (const state of ["ready", "partial_ready", "failed", "needs_input"] as const) {
    const run = await db
      .insertInto("proc.processing_run")
      .values({
        user_id: x.ctx.userId,
        session_id: x.session.id,
        operation_key: randomUUID(),
        request_hash: "synthetic-notification-fixture",
        sources_version: 0,
        source_fingerprint: "a".repeat(64),
        input_snapshot: "{}",
        settings: "{}",
        requested_amounts: "{}",
        reservation_id: randomUUID(),
        state,
        output_version_id:
          state === "ready" ? x.knowledge.id : state === "partial_ready" ? partialOutput.id : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await Promise.all([
      recordProcessingNotification(db, x.ctx, run.id),
      recordProcessingNotification(db, x.ctx, run.id),
    ]);
  }
  const inbox = await learnerNotifications(db, x.ctx);
  expect(inbox.items).toHaveLength(4);
  expect(inbox.items.map((item) => item.kind).sort()).toEqual([
    "processing_failed",
    "processing_failed",
    "processing_partial",
    "processing_ready",
  ]);
  expect(
    inbox.items
      .filter((item) => item.kind === "processing_failed")
      .every((item) => item.href.endsWith("/processing")),
  ).toBe(true);
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select("notification_recorded_at")
      .where("user_id", "=", x.ctx.userId)
      .where("notification_recorded_at", "is", null)
      .execute(),
  ).toHaveLength(0);
  // Repeated runs pointing at the same committed output should not duplicate the ready alert.
  const replay = await db
    .insertInto("proc.processing_run")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      operation_key: randomUUID(),
      request_hash: "synthetic-notification-replay",
      sources_version: 0,
      source_fingerprint: "a".repeat(64),
      input_snapshot: "{}",
      settings: "{}",
      requested_amounts: "{}",
      reservation_id: randomUUID(),
      state: "ready",
      output_version_id: x.knowledge.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  // A missed completion hook is repaired without requiring the browser or page to be open.
  const beforeRecord: string[] = [];
  expect(
    await reconcileProcessingNotifications(db, new Date(), {
      userId: x.ctx.userId,
      beforeRecord: async (_ctx, id) => {
        beforeRecord.push(id);
      },
    }),
  ).toBe(1);
  expect(beforeRecord).toEqual([replay.id]);
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(4);
});

it("keeps independent completions moving and retries a failed publication before notifying it", async () => {
  const x = await studyFixture(db);
  const secondSession = await createSession(db, x.ctx, {}, { key: randomUUID() });
  const runs = await db
    .insertInto("proc.processing_run")
    .values(
      [0, 1].map((index) => ({
        user_id: x.ctx.userId,
        session_id: index === 0 ? x.session.id : secondSession.id,
        operation_key: randomUUID(),
        request_hash: `synthetic-recovery-${index}`,
        sources_version: 0,
        source_fingerprint: "a".repeat(64),
        input_snapshot: "{}",
        settings: "{}",
        requested_amounts: "{}",
        reservation_id: randomUUID(),
        state: "failed",
      })),
    )
    .returning("id")
    .execute();
  const first = runs[0]?.id;
  await expect(
    reconcileProcessingNotifications(db, new Date(), {
      userId: x.ctx.userId,
      beforeRecord: async (_ctx, id) => {
        if (id === first) throw new Error("synthetic publication failure");
      },
    }),
  ).rejects.toThrow("synthetic publication failure");
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(1);
  expect(await reconcileProcessingNotifications(db, new Date(), { userId: x.ctx.userId })).toBe(1);
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(2);
});
