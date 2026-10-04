import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "../acc";
import { createDatabase } from "../db";
import { amounts, emptyAmounts } from "./amounts";
import {
  adjustAllowance,
  allowance,
  closeEntitlement,
  grantEntitlement,
  releaseStorage,
  reserveAllowance,
  settleAllowance,
} from "./ledger";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return { userId, requestId: randomUUID() };
}
async function grant(ctx: { userId: string }, audio = 3600) {
  const now = new Date();
  return grantEntitlement(db, {
    userId: ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ audio, storage: 10000 }),
    operationKey: randomUUID(),
    actorId: "test-operator",
    reason: "Synthetic verification",
  });
}

describe("allowance ledger on Postgres (FR-QUOTA-001, 005, 006, 011)", () => {
  it("returns physically deleted storage once and keeps AI consumption charged", async () => {
    const ctx = await learner();
    await grant(ctx);
    const reservation = await db
      .transaction()
      .execute((tx) =>
        reserveAllowance(tx, ctx, randomUUID(), amounts({ storage: 4000, audio: 60 })),
      );
    await db
      .transaction()
      .execute((tx) =>
        settleAllowance(tx, ctx, reservation.id, amounts({ storage: 4000, audio: 60 })),
      );
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, reservation.id));
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, reservation.id));
    const balance = await allowance(db, ctx);
    expect(balance.remaining.storage).toBe(10000);
    expect(balance.consumed.storage).toBe(0);
    expect(balance.consumed.audio).toBe(60);
    expect(balance.reserved.storage).toBe(0);
  });
  it("grants no allowance implicitly and reads only the learner's entries", async () => {
    const a = await learner();
    const b = await learner();
    await grant(a);
    expect((await allowance(db, b)).remaining).toEqual(emptyAmounts());
    expect((await allowance(db, a)).remaining.audio).toBe(3600);
  });
  it("allows only one of two concurrent reservations and rolls back failed transactions", async () => {
    const ctx = await learner();
    await grant(ctx);
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        db
          .transaction()
          .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 2400 }))),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await allowance(db, ctx)).remaining.audio).toBe(1200);
    await expect(
      db.transaction().execute(async (tx) => {
        await reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 1000 }));
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toThrow("Synthetic rollback");
    expect((await allowance(db, ctx)).remaining.audio).toBe(1200);
  });
  it("makes retries idempotent and charges only published output", async () => {
    const ctx = await learner();
    await grant(ctx);
    const key = randomUUID();
    const reserve = () =>
      db.transaction().execute((tx) => reserveAllowance(tx, ctx, key, amounts({ audio: 3000 })));
    const first = await reserve();
    expect((await reserve()).id).toBe(first.id);
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, first.id, amounts({ audio: 1500 })));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, first.id, amounts({ audio: 1500 })));
    expect(await allowance(db, ctx)).toMatchObject({
      remaining: { audio: 2100 },
      reserved: { audio: 0 },
      consumed: { audio: 1500 },
    });
    await expect(
      db.transaction().execute((tx) => reserveAllowance(tx, ctx, key, amounts({ audio: 100 }))),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    await expect(
      db.transaction().execute((tx) => settleAllowance(tx, ctx, first.id, emptyAmounts())),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  });
  it("keeps open reservations valid after closure and releases all failed work", async () => {
    const ctx = await learner();
    const entitlementId = await grant(ctx);
    const held = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 3600 })));
    await closeEntitlement(db, {
      userId: ctx.userId,
      entitlementId,
      actorId: "test-operator",
      reason: "End synthetic period",
    });
    expect((await allowance(db, ctx)).remaining.audio).toBe(0);
    await db.transaction().execute((tx) => settleAllowance(tx, ctx, held.id, emptyAmounts()));
    const row = await db
      .selectFrom("quota.reservation")
      .select("closed_at")
      .where("id", "=", held.id)
      .executeTakeFirstOrThrow();
    expect(row.closed_at).not.toBeNull();
  });
  it("refuses cross-account settlement, over-settlement and reductions below commitments", async () => {
    const a = await learner();
    const b = await learner();
    const id = await grant(a);
    const held = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, a, randomUUID(), amounts({ audio: 3000 })));
    await expect(
      db.transaction().execute((tx) => settleAllowance(tx, b, held.id, emptyAmounts())),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      db.transaction().execute((tx) => settleAllowance(tx, a, held.id, amounts({ audio: 3001 }))),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      adjustAllowance(db, {
        userId: a.userId,
        entitlementId: id,
        dimension: "audio",
        delta: -601,
        operationKey: randomUUID(),
        actorId: "test-operator",
        reason: "Synthetic reduction",
      }),
    ).rejects.toMatchObject({ code: "quota_insufficient" });
  });
  it("does not expose the ledger to browser roles or permit application rewrites", async () => {
    const ctx = await learner();
    await grant(ctx);
    await expect(
      db.updateTable("quota.ledger").set({ amount: 0 }).where("user_id", "=", ctx.userId).execute(),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.deleteFrom("quota.ledger").where("user_id", "=", ctx.userId).execute(),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
