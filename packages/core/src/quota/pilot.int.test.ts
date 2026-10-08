import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent, tombstoneAccount } from "../acc";
import { createDatabase } from "../db";
import {
  allowance,
  closeEntitlement,
  grantEntitlement,
  reserveAllowance,
  settleAllowance,
} from "./ledger";
import {
  grantPilotEntitlement,
  type PilotGrantInput,
  type PilotPolicy,
  pilotGrantOperationKey,
} from "./pilot";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const second = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => Promise.all([db.destroy(), second.destroy()]));

async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return { userId, requestId: randomUUID() };
}

function policy(maximumParticipants = 8): PilotPolicy {
  return {
    version: "synthetic-approved-pilot-1",
    pilotId: `synthetic-${randomUUID()}`,
    maximumParticipants,
    periodDays: 30,
    amounts: {
      audio: 36000,
      document: 100,
      regeneration: 20,
      tts: 20000,
      storage: 524288000,
    },
  };
}

function grant(userId: string, inputPolicy: PilotPolicy, startsAt = new Date()): PilotGrantInput {
  return {
    userId,
    policy: inputPolicy,
    startsAt,
    operationKey: pilotGrantOperationKey(inputPolicy.pilotId, userId),
    actorId: "synthetic-pilot-operator",
    reason: "Synthetic bounded admission verification",
  };
}

describe("bounded operator pilot grants on Postgres", () => {
  it("admits exactly one concurrent eighth/ninth participant and counts closed and expired grants", async () => {
    const inputPolicy = policy();
    const now = new Date();
    const initial = [];
    for (let index = 0; index < 7; index++) {
      const ctx = await learner();
      const startsAt = index === 0 ? new Date(now.getTime() - 31 * 86400000) : now;
      const input = grant(ctx.userId, inputPolicy, startsAt);
      const id = await grantPilotEntitlement(db, input, now);
      initial.push({ input, id });
      if (index === 1)
        await closeEntitlement(db, {
          userId: ctx.userId,
          entitlementId: id,
          actorId: input.actorId,
          reason: "Synthetic closed initial grant",
        });
    }
    const a = await learner();
    const b = await learner();
    const outcomes = await Promise.allSettled([
      grantPilotEntitlement(db, grant(a.userId, inputPolicy, now), now),
      grantPilotEntitlement(second, grant(b.userId, inputPolicy, now), now),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "quota_insufficient", details: { reason: "pilot_capacity" } },
    });
    const entries = await db
      .selectFrom("quota.entitlement")
      .select("id")
      .where("operation_key", "like", `pilot:${inputPolicy.pilotId}:%:initial`)
      .execute();
    expect(entries).toHaveLength(8);
    for (const previous of initial.slice(0, 2))
      expect(await grantPilotEntitlement(db, previous.input, now)).toBe(previous.id);
  });

  it("replays at full capacity without resetting reserved or consumed allowance", async () => {
    const ctx = await learner();
    const input = grant(ctx.userId, policy(1));
    const id = await grantPilotEntitlement(db, input);
    const held = await db.transaction().execute((tx) =>
      reserveAllowance(tx, ctx, randomUUID(), {
        audio: 120,
        document: 0,
        regeneration: 0,
        tts: 0,
        storage: 0,
      }),
    );
    await db.transaction().execute((tx) =>
      settleAllowance(tx, ctx, held.id, {
        audio: 60,
        document: 0,
        regeneration: 0,
        tts: 0,
        storage: 0,
      }),
    );
    await db.transaction().execute((tx) =>
      reserveAllowance(tx, ctx, randomUUID(), {
        audio: 30,
        document: 0,
        regeneration: 0,
        tts: 0,
        storage: 0,
      }),
    );
    const before = await allowance(db, ctx);
    expect(before).toMatchObject({
      remaining: { audio: 35910 },
      reserved: { audio: 30 },
      consumed: { audio: 60 },
    });
    expect(await grantPilotEntitlement(db, input)).toBe(id);
    expect(await allowance(db, ctx)).toEqual(before);
    const stored = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(stored.ends_at.getTime() - stored.starts_at.getTime()).toBe(30 * 86400000);
  });

  it("rejects fresh request keys, shifted periods and changed policy for the same pilot", async () => {
    const ctx = await learner();
    const input = grant(ctx.userId, policy(1));
    await grantPilotEntitlement(db, input);
    await expect(
      grantEntitlement(db, {
        ...input,
        endsAt: new Date(input.startsAt.getTime() + 30 * 86400000),
        amounts: input.policy.amounts,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(await grantPilotEntitlement(db, { ...input, userId: ctx.userId.toUpperCase() })).toBe(
      (await allowance(db, ctx)).entitlementId,
    );
    await expect(
      grantPilotEntitlement(db, { ...input, operationKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      grantPilotEntitlement(db, {
        ...input,
        startsAt: new Date(input.startsAt.getTime() + 86400000),
      }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    for (const changed of [
      { ...input.policy, version: "synthetic-different-policy" },
      { ...input.policy, maximumParticipants: 2 },
      { ...input.policy, periodDays: 31 },
      { ...input.policy, amounts: { ...input.policy.amounts, document: 101 } },
    ])
      await expect(grantPilotEntitlement(db, { ...input, policy: changed })).rejects.toMatchObject({
        code: "idempotency_mismatch",
      });
    const next = await learner();
    await expect(
      grantPilotEntitlement(db, grant(next.userId, { ...input.policy, maximumParticipants: 2 })),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  });

  it("rolls back failed admission and never grants an unknown or deleted account", async () => {
    const inputPolicy = policy(1);
    await expect(grantPilotEntitlement(db, grant(randomUUID(), inputPolicy))).rejects.toMatchObject(
      { code: "not_found" },
    );
    const deleted = await learner();
    await db.transaction().execute((tx) => tombstoneAccount(tx, deleted));
    await expect(
      grantPilotEntitlement(db, grant(deleted.userId, inputPolicy)),
    ).rejects.toMatchObject({ code: "not_found" });
    const active = await learner();
    const id = await grantPilotEntitlement(db, grant(active.userId, inputPolicy));
    expect((await allowance(db, active)).entitlementId).toBe(id);
  });
});
