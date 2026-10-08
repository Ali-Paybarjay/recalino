import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { createSession } from "../org";
import { learnerNotifications } from "../plt";
import { reconcileProcessingNotifications, recordProcessingNotification } from "./notifications";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());
it("leaves bounded work for subsequent sweeps and advances past a failed publication", async () => {
  const x = await studyFixture(db);
  const sessions = [x.session];
  for (let index = 1; index < 3; index++)
    sessions.push(await createSession(db, x.ctx, {}, { key: randomUUID() }));
  const old = new Date(Date.now() - 60_000);
  const rows = await db
    .insertInto("proc.processing_run")
    .values(
      sessions.map((session, index) => ({
        user_id: x.ctx.userId,
        session_id: session.id,
        operation_key: randomUUID(),
        request_hash: `synthetic-limit-${index}`,
        sources_version: 0,
        source_fingerprint: "a".repeat(64),
        input_snapshot: "{}",
        settings: "{}",
        requested_amounts: "{}",
        reservation_id: randomUUID(),
        state: "failed",
        updated_at: new Date(old.getTime() + index),
      })),
    )
    .returning("id")
    .execute();
  const first = rows[0]?.id;
  expect(
    await reconcileProcessingNotifications(db, new Date(), {
      userId: x.ctx.userId,
      deadline: new Date(0),
      limit: 1,
    }),
  ).toBe(0);
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(0);
  await expect(
    reconcileProcessingNotifications(db, new Date(), {
      userId: x.ctx.userId,
      limit: 1,
      beforeRecord: async (_ctx, id) => {
        if (id === first) throw new Error("synthetic publication failure");
      },
    }),
  ).rejects.toThrow("synthetic publication failure");
  expect(
    await reconcileProcessingNotifications(db, new Date(), { userId: x.ctx.userId, limit: 1 }),
  ).toBe(1);
  const middle = await db
    .selectFrom("proc.processing_run")
    .select(["id", "notification_recorded_at"])
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(middle.find((row) => row.id === first)?.notification_recorded_at).toBeNull();
  expect(middle.filter((row) => row.notification_recorded_at)).toHaveLength(1);
  expect(
    await reconcileProcessingNotifications(db, new Date(), { userId: x.ctx.userId, limit: 2 }),
  ).toBe(2);
  expect((await learnerNotifications(db, x.ctx)).items).toHaveLength(3);
});

it("acknowledges a superseded failed run without notifying after a newer ready result", async () => {
  const x = await studyFixture(db);
  const row = (state: "failed" | "ready", at: Date) => ({
    user_id: x.ctx.userId,
    session_id: x.session.id,
    operation_key: randomUUID(),
    request_hash: "synthetic-superseded",
    sources_version: 0,
    source_fingerprint: "a".repeat(64),
    input_snapshot: "{}",
    settings: "{}",
    requested_amounts: "{}",
    reservation_id: randomUUID(),
    state,
    created_at: at,
    updated_at: at,
    output_version_id: state === "ready" ? x.knowledge.id : null,
  });
  const failed = await db
    .insertInto("proc.processing_run")
    .values(row("failed", new Date(Date.now() - 60_000)))
    .returning("id")
    .executeTakeFirstOrThrow();
  const ready = await db
    .insertInto("proc.processing_run")
    .values(row("ready", new Date()))
    .returning("id")
    .executeTakeFirstOrThrow();
  await recordProcessingNotification(db, x.ctx, ready.id);
  await recordProcessingNotification(db, x.ctx, failed.id);
  expect((await learnerNotifications(db, x.ctx)).items.map((item) => item.kind)).toEqual([
    "processing_ready",
  ]);
  expect(
    (
      await db
        .selectFrom("proc.processing_run")
        .select("notification_recorded_at")
        .where("id", "=", failed.id)
        .executeTakeFirstOrThrow()
    ).notification_recorded_at,
  ).not.toBeNull();
});
