import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent, tombstoneAccount } from "../acc";
import { createDatabase } from "../db";
import { readEntitlementAllocation, setAllowanceAllocation } from "./allocations";
import { amounts, emptyAmounts } from "./amounts";
import {
  allowance,
  closeEntitlement,
  grantEntitlement,
  releaseStorage,
  reserveAllowance,
  settleAllowance,
} from "./ledger";
import {
  type AdminPilotGrantInput,
  configurePilot,
  grantAdminPilotEntitlement,
  grantPilotEntitlement,
  type PilotConfigurationInput,
  pilotGrantOperationKey,
  readPilotConfiguration,
} from "./pilot";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const second = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
afterAll(() => Promise.all([db.destroy(), second.destroy(), admin.destroy()]));
const actor = {
  actorId: "synthetic-admin-quota",
  reason: "Synthetic admin allocation verification",
};

async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return { userId, requestId: randomUUID() };
}

function configuration(maximumParticipants = 2): PilotConfigurationInput {
  return {
    ...actor,
    version: "synthetic-1",
    pilotId: `synthetic-${randomUUID()}`,
    maximumParticipants,
    periodDays: 30,
    amounts: amounts({ audio: 600, document: 10 }),
    operationKey: randomUUID(),
  };
}
function admission(
  userId: string,
  config: PilotConfigurationInput,
  units = config.amounts,
): AdminPilotGrantInput {
  const startsAt = new Date(Date.now() - 1000);
  return {
    ...actor,
    pilotId: config.pilotId,
    userId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 86400000),
    amounts: units,
    operationKey: pilotGrantOperationKey(config.pilotId, userId),
  };
}
async function period(
  userId: string,
  units = amounts({ audio: 600, document: 10, storage: 1000 }),
) {
  const now = new Date();
  return grantEntitlement(db, {
    ...actor,
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: units,
    operationKey: randomUUID(),
  });
}

describe("admin pilot revisions and allocations (ADM-I03/I14/I15/I16)", () => {
  it("counts legacy admissions and changes capacity without rewriting historical keys or replaying grants", async () => {
    const first = await learner();
    const config = configuration(2);
    const oldInput = {
      ...actor,
      userId: first.userId,
      policy: {
        version: "synthetic-legacy",
        pilotId: config.pilotId,
        maximumParticipants: 1,
        periodDays: 30,
        amounts: config.amounts,
      },
      startsAt: new Date(Date.now() - 1000),
      operationKey: pilotGrantOperationKey(config.pilotId, first.userId),
    };
    const oldId = await grantPilotEntitlement(db, oldInput);
    const oldRow = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", oldId)
      .executeTakeFirstOrThrow();
    expect(await configurePilot(db, config)).toMatchObject({
      historicalAdmissions: 1,
      remainingPlaces: 1,
    });
    const next = await learner();
    const custom = admission(
      next.userId,
      config,
      amounts({ audio: 120000, document: 300, tts: 0 }),
    );
    const nextId = await grantAdminPilotEntitlement(db, custom);
    expect(
      await configurePilot(db, {
        ...config,
        version: "synthetic-2",
        maximumParticipants: 0,
        operationKey: randomUUID(),
      }),
    ).toMatchObject({ historicalAdmissions: 2, activeParticipants: 2, remainingPlaces: 0 });
    expect(await grantPilotEntitlement(db, oldInput)).toBe(oldId);
    expect(await grantAdminPilotEntitlement(db, custom)).toBe(nextId);
    expect(
      await grantAdminPilotEntitlement(db, {
        ...custom,
        userId: first.userId,
        startsAt: oldRow.starts_at,
        endsAt: oldRow.ends_at,
        amounts: config.amounts,
        operationKey: oldInput.operationKey,
      }),
    ).toBe(oldId);
    expect(
      await db
        .selectFrom("quota.entitlement")
        .selectAll()
        .where("id", "=", oldId)
        .executeTakeFirstOrThrow(),
    ).toEqual(oldRow);
    const third = await learner();
    await expect(
      grantAdminPilotEntitlement(db, admission(third.userId, config)),
    ).rejects.toMatchObject({ code: "quota_insufficient" });
    await expect(
      grantPilotEntitlement(db, {
        ...oldInput,
        userId: third.userId,
        operationKey: pilotGrantOperationKey(config.pilotId, third.userId),
      }),
    ).rejects.toMatchObject({ code: "quota_insufficient" });
  });

  it("admits independent zero/above-preset allocations and keeps the original snapshot at full capacity", async () => {
    const config = configuration(2);
    expect(await readPilotConfiguration(db, config.pilotId)).toBeNull();
    await configurePilot(db, config);
    const first = await learner();
    const next = await learner();
    const zero = admission(first.userId, config, emptyAmounts());
    const custom = admission(
      next.userId,
      config,
      amounts({
        audio: 120000,
        document: 300,
        regeneration: 42,
        tts: 55555,
        storage: 1000 * 1048576,
      }),
    );
    const zeroId = await grantAdminPilotEntitlement(db, zero);
    const customId = await grantAdminPilotEntitlement(db, custom);
    expect((await readEntitlementAllocation(db, first.userId, zeroId)).allocated).toEqual(
      emptyAmounts(),
    );
    expect((await readEntitlementAllocation(db, next.userId, customId)).allocated).toEqual(
      custom.amounts,
    );
    expect(await grantAdminPilotEntitlement(db, custom)).toBe(customId);
    await expect(
      grantAdminPilotEntitlement(db, { ...custom, amounts: amounts({ audio: 1 }) }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    await expect(
      grantAdminPilotEntitlement(db, {
        ...custom,
        endsAt: new Date(custom.endsAt.getTime() + 1000),
      }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    await closeEntitlement(db, { ...actor, userId: first.userId, entitlementId: zeroId });
    expect(await readPilotConfiguration(db, config.pilotId)).toMatchObject({
      historicalAdmissions: 2,
      activeParticipants: 1,
      remainingPlaces: 0,
    });
  });

  it("serializes the last place, rolls back unknown/deleted admissions and preserves immutable revisions", async () => {
    const config = configuration(1);
    const firstRevision = await configurePilot(db, config);
    expect(await configurePilot(db, config)).toEqual(firstRevision);
    await expect(configurePilot(db, { ...config, maximumParticipants: 0 })).rejects.toMatchObject({
      code: "idempotency_mismatch",
    });
    await expect(
      grantAdminPilotEntitlement(db, admission(randomUUID(), config)),
    ).rejects.toMatchObject({ code: "not_found" });
    const deleted = await learner();
    await db.transaction().execute((tx) => tombstoneAccount(tx, deleted));
    await expect(
      grantAdminPilotEntitlement(db, admission(deleted.userId, config)),
    ).rejects.toMatchObject({ code: "not_found" });
    const first = await learner();
    const next = await learner();
    const outcomes = await Promise.allSettled([
      grantAdminPilotEntitlement(db, admission(first.userId, config, amounts({ audio: 1 }))),
      grantAdminPilotEntitlement(second, admission(next.userId, config, amounts({ document: 1 }))),
    ]);
    expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((value) => value.status === "rejected")).toMatchObject({
      reason: { code: "quota_insufficient" },
    });
    expect(await readPilotConfiguration(db, config.pilotId)).toMatchObject({
      historicalAdmissions: 1,
      remainingPlaces: 0,
    });
    await configurePilot(db, {
      ...config,
      version: "synthetic-2",
      maximumParticipants: 3,
      operationKey: randomUUID(),
    });
    expect(await configurePilot(db, config)).toEqual({
      ...firstRevision,
      historicalAdmissions: 1,
      activeParticipants: 1,
      remainingPlaces: 0,
    });
    expect(await readPilotConfiguration(db, config.pilotId)).toMatchObject({
      version: "synthetic-2",
      maximumParticipants: 3,
    });
  });

  it("reduces below consumption and holds, blocks only new use, and settles/releases existing holds", async () => {
    const ctx = await learner();
    const id = await period(ctx.userId);
    const initial = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 120 })));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, initial.id, amounts({ audio: 120 })));
    const hold = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 30 })));
    const rowsBefore = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where("entitlement_id", "=", id)
      .orderBy("id")
      .execute();
    const change = {
      ...actor,
      userId: ctx.userId,
      entitlementId: id,
      amounts: amounts({ audio: 100, document: 10, storage: 1000 }),
      operationKey: randomUUID(),
    };
    const result = await setAllowanceAllocation(db, change);
    expect(result.before).toMatchObject({
      allocated: { audio: 600 },
      used: { audio: 120 },
      reserved: { audio: 30 },
      available: { audio: 450 },
    });
    expect(result.after).toMatchObject({
      allocated: { audio: 100 },
      used: { audio: 120 },
      reserved: { audio: 30 },
      available: { audio: 0 },
      balance: { audio: -50 },
      deficit: { audio: 50 },
    });
    expect(await allowance(db, ctx)).toMatchObject({
      remaining: { audio: 0 },
      consumed: { audio: 120 },
      reserved: { audio: 30 },
    });
    await expect(
      db
        .transaction()
        .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 1 }))),
    ).rejects.toMatchObject({ code: "quota_insufficient" });
    const documentHold = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ document: 1 })));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, documentHold.id, emptyAmounts()));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, hold.id, amounts({ audio: 20 })));
    expect(await readEntitlementAllocation(db, ctx.userId, id)).toMatchObject({
      allocated: { audio: 100 },
      used: { audio: 140 },
      reserved: { audio: 0 },
      deficit: { audio: 40 },
    });
    await setAllowanceAllocation(db, {
      ...change,
      operationKey: randomUUID(),
      amounts: amounts({ audio: 800, document: 10, storage: 1000 }),
    });
    expect((await allowance(db, ctx)).remaining.audio).toBe(660);
    expect(await setAllowanceAllocation(db, change)).toEqual({ ...result, replayed: true });
    expect((await allowance(db, ctx)).allocated.audio).toBe(800);
    await expect(
      setAllowanceAllocation(db, { ...change, amounts: amounts({ audio: 101 }) }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    const retained = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where(
        "id",
        "in",
        rowsBefore.map((row) => row.id),
      )
      .orderBy("id")
      .execute();
    expect(retained).toEqual(rowsBefore);
  });

  it("releases occupied storage without increasing a reduced allocation and preserves expired-period history", async () => {
    const ctx = await learner();
    const id = await period(ctx.userId);
    const hold = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ storage: 400 })));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, hold.id, amounts({ storage: 400 })));
    await setAllowanceAllocation(db, {
      ...actor,
      userId: ctx.userId,
      entitlementId: id,
      amounts: amounts({ storage: 100 }),
      operationKey: randomUUID(),
    });
    expect(await readEntitlementAllocation(db, ctx.userId, id)).toMatchObject({
      allocated: { storage: 100 },
      used: { storage: 400 },
      deficit: { storage: 300 },
    });
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, hold.id));
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, hold.id));
    expect(await readEntitlementAllocation(db, ctx.userId, id)).toMatchObject({
      allocated: { storage: 100 },
      used: { storage: 0 },
      available: { storage: 100 },
    });
    expect(
      await readEntitlementAllocation(db, ctx.userId, id, new Date(Date.now() + 7200000)),
    ).toMatchObject({ active: false, allocated: { storage: 100 }, available: emptyAmounts() });
  });

  it("serializes absolute adjustments with each other and concurrent reservations", async () => {
    const ctx = await learner();
    const id = await period(ctx.userId);
    const base = { ...actor, userId: ctx.userId, entitlementId: id };
    const changes = await Promise.all([
      setAllowanceAllocation(db, {
        ...base,
        amounts: amounts({ audio: 100 }),
        operationKey: randomUUID(),
      }),
      setAllowanceAllocation(second, {
        ...base,
        amounts: amounts({ audio: 200 }),
        operationKey: randomUUID(),
      }),
    ]);
    expect(changes.map((change) => change.after.allocated.audio).sort()).toEqual([100, 200]);
    expect(changes.map((change) => change.before.allocated.audio)).toContain(600);
    const after = await readEntitlementAllocation(db, ctx.userId, id);
    expect([100, 200]).toContain(after.allocated.audio);
    await setAllowanceAllocation(db, {
      ...base,
      amounts: amounts({ audio: 600 }),
      operationKey: randomUUID(),
    });
    const outcomes = await Promise.allSettled([
      setAllowanceAllocation(db, {
        ...base,
        amounts: amounts({ audio: 100 }),
        operationKey: randomUUID(),
      }),
      second
        .transaction()
        .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 200 }))),
    ]);
    expect(outcomes[0]?.status).toBe("fulfilled");
    const snapshot = await readEntitlementAllocation(db, ctx.userId, id);
    expect(snapshot.allocated.audio).toBe(100);
    expect(snapshot.reserved.audio).toBe(outcomes[1]?.status === "fulfilled" ? 200 : 0);
    expect(snapshot.available.audio).toBe(outcomes[1]?.status === "fulfilled" ? 0 : 100);
  });

  it("keeps revisions and allocation snapshots private and append-only", async () => {
    await expect(
      sql`update quota.pilot_revision set maximum_participants = 0`.execute(db),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(sql`delete from quota.allocation_change`.execute(db)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      admin.transaction().execute(async (tx) => {
        await sql`set local role authenticated`.execute(tx);
        return sql`select * from quota.pilot_revision`.execute(tx);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
