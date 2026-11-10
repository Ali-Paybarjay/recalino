import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "../acc";
import { createDatabase } from "../db";
import { amounts } from "./amounts";
import { beginProviderStep, configureCostPolicy, finishProviderStep } from "./costs";
import { grantEntitlement, reserveAllowance } from "./ledger";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL);
const users: string[] = [];
let previous: Awaited<ReturnType<typeof originalPolicy>>;
async function originalPolicy() {
  return admin.selectFrom("quota.cost_policy").selectAll().executeTakeFirst();
}
beforeAll(async () => {
  previous = await originalPolicy();
});
afterAll(async () => {
  await admin.deleteFrom("quota.cost_policy").execute();
  if (previous)
    await admin
      .insertInto("quota.cost_policy")
      .values({ ...previous, limits: JSON.stringify(previous.limits) })
      .execute();
  for (const id of users) await admin.deleteFrom("acc.user_account").where("id", "=", id).execute();
  await db.destroy();
  await admin.destroy();
});
const operator = { actorId: "test-operator", reason: "Synthetic cost verification" };
const policy = {
  version: "test-1",
  currency: "GBP",
  killSwitch: false,
  limits: { session: 100, userMonth: 100, systemDay: 100000, systemMonth: 100000 },
};
async function caller() {
  const userId = await createAuthUser();
  users.push(userId);
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  await grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ audio: 100 }),
    operationKey: randomUUID(),
    ...operator,
  });
  const hold = await db
    .transaction()
    .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 10 })));
  return { ctx, reservationId: hold.id, sessionId: randomUUID() };
}
describe("AI cost controls (FR-QUOTA-008..010)", () => {
  it("blocks without a configured cost policy, on kill-switch and without a reservation", async () => {
    const { ctx, reservationId, sessionId } = await caller();
    await admin.deleteFrom("quota.cost_policy").execute();
    const step = {
      sessionId,
      reservationId,
      operationKey: randomUUID(),
      maximumMicros: 50,
      currency: "GBP",
    };
    await expect(
      db.transaction().execute((tx) => beginProviderStep(tx, ctx, step)),
    ).rejects.toMatchObject({
      code: "quota_insufficient",
      details: { reason: "cost_policy_missing" },
    });
    await configureCostPolicy(db, { ...policy, killSwitch: true }, operator);
    await expect(
      db.transaction().execute((tx) => beginProviderStep(tx, ctx, step)),
    ).rejects.toMatchObject({ details: { reason: "processing_paused" } });
    await configureCostPolicy(db, policy, operator);
    await expect(
      db
        .transaction()
        .execute((tx) => beginProviderStep(tx, ctx, { ...step, reservationId: randomUUID() })),
    ).rejects.toMatchObject({ details: { reason: "reservation_missing" } });
  });
  it("holds a budget atomically so concurrent provider steps cannot overspend", async () => {
    const { ctx, reservationId, sessionId } = await caller();
    await configureCostPolicy(db, policy, operator);
    const result = await Promise.allSettled(
      [1, 2].map(() =>
        db.transaction().execute((tx) =>
          beginProviderStep(tx, ctx, {
            sessionId,
            reservationId,
            operationKey: randomUUID(),
            maximumMicros: 60,
            currency: "GBP",
          }),
        ),
      ),
    );
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
  it("records measured usage once with the price version and frees the unused cost bound", async () => {
    const { ctx, reservationId, sessionId } = await caller();
    await configureCostPolicy(db, policy, operator);
    const key = randomUUID();
    const step = {
      sessionId,
      reservationId,
      operationKey: key,
      maximumMicros: 60,
      currency: "GBP",
    };
    const hold = await db.transaction().execute((tx) => beginProviderStep(tx, ctx, step));
    expect(
      (await db.transaction().execute((tx) => beginProviderStep(tx, ctx, step))).replayed,
    ).toBe(true);
    const cost = {
      operationKey: key,
      provider: "synthetic",
      model: "fixture-1",
      currency: "GBP",
      actualMicros: 20,
      estimatedMicros: 30,
      priceVersion: "fixture-1",
      usage: { audioSeconds: 10 },
    };
    await db.transaction().execute((tx) => finishProviderStep(tx, ctx, hold.id, cost));
    await db.transaction().execute((tx) => finishProviderStep(tx, ctx, hold.id, cost));
    expect(
      await db
        .selectFrom("quota.provider_cost")
        .selectAll()
        .where("operation_key", "=", key)
        .execute(),
    ).toHaveLength(1);
    expect(
      (
        await db
          .transaction()
          .execute((tx) =>
            beginProviderStep(tx, ctx, { ...step, operationKey: randomUUID(), maximumMicros: 80 }),
          )
      ).replayed,
    ).toBe(false);
  });
  // P10-02 (C9-11): the currency setting changes between the hold and its close at the maximum.
  it("closes a hold at its maximum in the hold's currency after the currency setting changed", async () => {
    const { ctx, reservationId, sessionId } = await caller();
    await configureCostPolicy(db, policy, operator);
    const key = randomUUID();
    const hold = await db.transaction().execute((tx) =>
      beginProviderStep(tx, ctx, {
        sessionId,
        reservationId,
        operationKey: key,
        maximumMicros: 60,
        currency: "GBP",
      }),
    );
    await configureCostPolicy(db, { ...policy, version: "test-2", currency: "EUR" }, operator);
    const close = {
      operationKey: key,
      provider: "synthetic",
      model: "fixture-1",
      currency: "EUR",
      actualMicros: null,
      estimatedMicros: "hold_maximum" as const,
      priceVersion: "fixture-1",
      usage: {},
    };
    // A definite settle in another currency is still refused, and leaves the hold open.
    await expect(
      db.transaction().execute((tx) =>
        finishProviderStep(tx, ctx, hold.id, {
          ...close,
          actualMicros: 20,
          estimatedMicros: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    await db.transaction().execute((tx) => finishProviderStep(tx, ctx, hold.id, close));
    await db.transaction().execute((tx) => finishProviderStep(tx, ctx, hold.id, close));
    const closed = await db
      .selectFrom("quota.cost_hold")
      .select(["closed_at", "currency"])
      .where("id", "=", hold.id)
      .executeTakeFirstOrThrow();
    expect(closed.closed_at).not.toBeNull();
    expect(closed.currency).toBe("GBP");
    const rows = await db
      .selectFrom("quota.provider_cost")
      .selectAll()
      .where("operation_key", "=", key)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: "GBP", amount_micros: null });
    expect(Number(rows[0]?.estimated_micros)).toBe(60);
  });
});
