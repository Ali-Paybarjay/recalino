import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent, tombstoneAccount } from "../acc";
import { createDatabase } from "../db";
import {
  readEntitlementAllocation,
  type SetAllocationInput,
  setAllowanceAllocation,
} from "./allocations";
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

// P12-08: a new allowance period from the panel (F-2, F-9, F-10). Synthetic local accounts only.
const DAY = 86400000;
describe("quota new period from the admin panel (P12-08)", () => {
  let owner = "";
  let previousOwner: { user_id: string; enabled: boolean; created_at: Date } | undefined;
  beforeAll(async () => {
    owner = await createAuthUser();
    previousOwner = (
      await sql<{
        user_id: string;
        enabled: boolean;
        created_at: Date;
      }>`select user_id, enabled, created_at from plt.admin_owner`.execute(admin)
    ).rows[0];
    await sql`insert into plt.admin_owner(singleton, user_id, enabled)
      values (true, ${owner}::uuid, true)
      on conflict (singleton) do update set user_id = excluded.user_id, enabled = true`.execute(
      admin,
    );
  });
  afterAll(async () => {
    if (previousOwner)
      await sql`update plt.admin_owner set user_id = ${previousOwner.user_id}::uuid,
        enabled = ${previousOwner.enabled}, created_at = ${previousOwner.created_at}`.execute(
        admin,
      );
    else await sql`delete from plt.admin_owner where user_id = ${owner}::uuid`.execute(admin);
  });

  /** An unclosed period that ended a day ago. */
  async function endedPeriod(
    userId: string,
    units = amounts({ audio: 600, document: 10, storage: 1000 }),
  ) {
    const now = Date.now();
    return grantEntitlement(db, {
      ...actor,
      userId,
      startsAt: new Date(now - 3 * DAY),
      endsAt: new Date(now - DAY),
      amounts: units,
      operationKey: randomUUID(),
    });
  }
  function newPeriod(
    userId: string,
    entitlementId: string,
    units = amounts({ audio: 900, document: 20, tts: 50, storage: 2000 }),
  ): SetAllocationInput {
    const startsAt = new Date(Date.now() - 1000);
    return {
      userId,
      entitlementId,
      amounts: units,
      operationKey: randomUUID(),
      actorId: owner,
      reason: "Synthetic new allowance period",
      requestId: randomUUID(),
      period: { startsAt, endsAt: new Date(startsAt.getTime() + 30 * DAY) },
    };
  }
  async function writes(userId: string) {
    const count = async (table: "quota.entitlement" | "quota.ledger" | "quota.allocation_change") =>
      Number(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("user_id", "=", userId)
            .executeTakeFirstOrThrow()
        ).n,
      );
    return {
      entitlements: await count("quota.entitlement"),
      ledger: await count("quota.ledger"),
      changes: await count("quota.allocation_change"),
    };
  }
  async function newPeriodAudits(subjectIds: string[]) {
    if (!subjectIds.length) return [];
    return db
      .selectFrom("plt.audit_event")
      .selectAll()
      .where("action", "=", "quota.new_period")
      .where("subject_id", "in", subjectIds)
      .execute();
  }

  it("quota new period: an expired allocation gets a second period from the panel and one allocation_change row", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const previous = await readEntitlementAllocation(db, ctx.userId, previousId);
    expect(previous.active).toBe(false);
    const input = newPeriod(ctx.userId, previousId);
    const result = await setAllowanceAllocation(db, input);
    expect(result.replayed).toBe(false);
    const newId = result.after.entitlementId;
    expect(newId).not.toBe(previousId);
    expect(result.before).toMatchObject({
      entitlementId: previousId,
      startsAt: previous.startsAt,
      endsAt: previous.endsAt,
      allocated: previous.allocated,
      active: false,
    });
    expect(result.after).toMatchObject({
      entitlementId: newId,
      startsAt: input.period?.startsAt,
      endsAt: input.period?.endsAt,
      allocated: input.amounts,
      used: emptyAmounts(),
      reserved: emptyAmounts(),
      available: input.amounts,
      active: true,
    });
    const rows = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .orderBy("starts_at")
      .execute();
    expect(rows.map((row) => row.id)).toEqual([previousId, newId]);
    const created = rows[1];
    expect(created?.closed_at).toBeNull();
    expect(created?.operation_key).not.toMatch(/^pilot:.*:initial$/);
    expect(created?.operation_key).toContain(input.period?.startsAt.toISOString());
    expect(created?.operation_key).toContain(input.period?.endsAt.toISOString());
    const grants = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where("entitlement_id", "=", newId)
      .execute();
    expect(grants).toHaveLength(5);
    expect(grants.every((row) => row.kind === "grant")).toBe(true);
    const changes = await db
      .selectFrom("quota.allocation_change")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .execute();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entitlement_id: newId,
      operation_key: input.operationKey,
      actor_id: owner,
      reason: input.reason,
      requested_amounts: input.amounts,
      before_snapshot: {
        entitlementId: previousId,
        startsAt: previous.startsAt.toISOString(),
        endsAt: previous.endsAt.toISOString(),
        allocated: previous.allocated,
      },
      after_snapshot: {
        entitlementId: newId,
        startsAt: input.period?.startsAt.toISOString(),
        endsAt: input.period?.endsAt.toISOString(),
        allocated: input.amounts,
      },
    });
    const audits = await newPeriodAudits([newId]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: owner,
      reason: input.reason,
      request_id: input.requestId,
    });
    expect(await allowance(db, ctx)).toMatchObject({
      entitlementId: newId,
      remaining: input.amounts,
    });
  });

  it("quota new period: the previous period keeps its row and its remainder does not carry over", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const during = new Date(Date.now() - 2 * DAY);
    const used = amounts({ audio: 120, storage: 400 });
    const hold = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), used, during));
    await db.transaction().execute((tx) => settleAllowance(tx, ctx, hold.id, used, during));
    const rowBefore = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", previousId)
      .executeTakeFirstOrThrow();
    const ledgerBefore = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where("entitlement_id", "=", previousId)
      .orderBy("id")
      .execute();
    const input = newPeriod(ctx.userId, previousId, amounts({ audio: 300, document: 5 }));
    const result = await setAllowanceAllocation(db, input);
    // 480 audio seconds remained in the previous period; none of it reaches the new one.
    expect(result.before).toMatchObject({ allocated: { audio: 600 }, used });
    expect(result.after).toMatchObject({
      allocated: { audio: 300, document: 5, storage: 0 },
      used: emptyAmounts(),
      available: { audio: 300, document: 5, storage: 0 },
    });
    expect(
      await db
        .selectFrom("quota.entitlement")
        .selectAll()
        .where("id", "=", previousId)
        .executeTakeFirstOrThrow(),
    ).toEqual(rowBefore);
    expect(
      await db
        .selectFrom("quota.ledger")
        .selectAll()
        .where("entitlement_id", "=", previousId)
        .orderBy("id")
        .execute(),
    ).toEqual(ledgerBefore);
    expect((await allowance(db, ctx)).remaining).toEqual(amounts({ audio: 300, document: 5 }));
    expect(await readEntitlementAllocation(db, ctx.userId, previousId)).toMatchObject({
      allocated: { audio: 600 },
      used,
      available: emptyAmounts(),
    });
    // AC-14, current behaviour kept: storage freed later returns to the reservation's period.
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, hold.id));
    expect(await readEntitlementAllocation(db, ctx.userId, previousId)).toMatchObject({
      used: { audio: 120, storage: 0 },
    });
    expect(
      await readEntitlementAllocation(db, ctx.userId, result.after.entitlementId),
    ).toMatchObject({ used: emptyAmounts(), allocated: { storage: 0 } });
  });

  it("quota new period: an unclosed allocation that overlaps in time is refused with no write", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const before = await writes(ctx.userId);
    // The new period would start inside the unclosed previous period.
    const inside = newPeriod(ctx.userId, previousId);
    const insideStart = new Date(Date.now() - 2 * DAY);
    inside.period = { startsAt: insideStart, endsAt: new Date(insideStart.getTime() + 30 * DAY) };
    await expect(setAllowanceAllocation(db, inside)).rejects.toMatchObject({
      code: "conflict",
      details: { fields: { period: ["overlaps_unclosed_period"] } },
    });
    // Another unclosed period overlaps the new one in time.
    const activeId = await period(ctx.userId);
    const afterActive = await writes(ctx.userId);
    const overlapping = newPeriod(ctx.userId, previousId);
    await expect(setAllowanceAllocation(db, overlapping)).rejects.toMatchObject({
      code: "conflict",
      details: { fields: { period: ["overlaps_unclosed_period"] } },
    });
    // A period that has not ended is never the previous period of a new one.
    await expect(setAllowanceAllocation(db, newPeriod(ctx.userId, activeId))).rejects.toMatchObject(
      {
        code: "conflict",
        details: { fields: { entitlementId: ["period_not_ended"] } },
      },
    );
    expect(await writes(ctx.userId)).toEqual(afterActive);
    expect(afterActive).toEqual({ ...before, entitlements: before.entitlements + 1, ledger: 10 });
    expect(before.changes).toBe(0);
    // Only unclosed periods block: once the overlapping one is closed, the same request passes.
    await closeEntitlement(db, { ...actor, userId: ctx.userId, entitlementId: activeId });
    const result = await setAllowanceAllocation(db, overlapping);
    expect(result.replayed).toBe(false);
    expect(await newPeriodAudits([result.after.entitlementId])).toHaveLength(1);
  });

  it("quota new period: an expired allocation that was never closed does not block a new period", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const previous = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", previousId)
      .executeTakeFirstOrThrow();
    expect(previous.closed_at).toBeNull();
    // The new period starts exactly where the unclosed one ended: adjacent, not overlapping.
    const input = newPeriod(ctx.userId, previousId);
    input.period = {
      startsAt: previous.ends_at,
      endsAt: new Date(previous.ends_at.getTime() + 30 * DAY),
    };
    const result = await setAllowanceAllocation(db, input);
    expect(result.after).toMatchObject({ active: true, allocated: input.amounts });
    expect(await writes(ctx.userId)).toEqual({ entitlements: 2, ledger: 10, changes: 1 });
  });

  it("quota new period: the same request twice writes one period, and a changed request with the same key is refused", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const input = newPeriod(ctx.userId, previousId);
    const outcomes = await Promise.all([
      setAllowanceAllocation(db, input),
      setAllowanceAllocation(second, input),
    ]);
    expect(outcomes.map((outcome) => outcome.replayed).sort()).toEqual([false, true]);
    const [first, replay] = outcomes;
    expect(replay?.after).toEqual(first?.after);
    expect(replay?.before).toEqual(first?.before);
    expect(await setAllowanceAllocation(db, input)).toEqual({ ...first, replayed: true });
    const settled = await writes(ctx.userId);
    expect(settled).toEqual({ entitlements: 2, ledger: 10, changes: 1 });
    const later = new Date((input.period?.startsAt.getTime() ?? 0) + DAY);
    for (const changed of [
      { ...input, amounts: amounts({ audio: 901 }) },
      { ...input, period: { startsAt: later, endsAt: new Date(later.getTime() + 30 * DAY) } },
      { ...input, entitlementId: first?.after.entitlementId ?? "" },
      { ...input, period: undefined },
      { ...input, period: undefined, entitlementId: first?.after.entitlementId ?? "" },
    ])
      await expect(setAllowanceAllocation(db, changed)).rejects.toMatchObject({
        code: "idempotency_mismatch",
      });
    expect(await writes(ctx.userId)).toEqual(settled);
    expect(await newPeriodAudits([first?.after.entitlementId ?? ""])).toHaveLength(1);
  });

  it("quota new period: the initial pilot grant key and its refusals are unchanged", async () => {
    const config = configuration(1);
    await configurePilot(db, config);
    const ctx = await learner();
    const startsAt = new Date(Date.now() - 40 * DAY);
    const initial: AdminPilotGrantInput = {
      ...admission(ctx.userId, config),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * DAY),
    };
    expect(initial.operationKey).toBe(`pilot:${config.pilotId}:${ctx.userId}:initial`);
    const initialId = await grantAdminPilotEntitlement(db, initial);
    const initialRow = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", initialId)
      .executeTakeFirstOrThrow();
    expect(initialRow.operation_key).toMatch(
      new RegExp(`^pilot:${config.pilotId}:${ctx.userId}:[0-9a-f]{64}:initial$`),
    );
    const fresh = new Date(Date.now() - 1000);
    const freshDates = {
      ...initial,
      startsAt: fresh,
      endsAt: new Date(fresh.getTime() + 30 * DAY),
    };
    await expect(grantAdminPilotEntitlement(db, freshDates)).rejects.toMatchObject({
      code: "idempotency_mismatch",
      details: { fields: { period: ["pilot_admission_exists"] } },
    });
    await expect(
      grantAdminPilotEntitlement(db, { ...freshDates, operationKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const result = await setAllowanceAllocation(db, newPeriod(ctx.userId, initialId));
    const created = await db
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", result.after.entitlementId)
      .executeTakeFirstOrThrow();
    expect(created.operation_key.startsWith("pilot:")).toBe(false);
    expect(
      await db
        .selectFrom("quota.entitlement")
        .selectAll()
        .where("id", "=", initialId)
        .executeTakeFirstOrThrow(),
    ).toEqual(initialRow);
    // Still one admission: the new period takes no pilot place and replays keep the original.
    expect(await readPilotConfiguration(db, config.pilotId)).toMatchObject({
      historicalAdmissions: 1,
      remainingPlaces: 0,
    });
    expect(await grantAdminPilotEntitlement(db, initial)).toBe(initialId);
    await expect(grantAdminPilotEntitlement(db, freshDates)).rejects.toMatchObject({
      code: "idempotency_mismatch",
    });
  });

  it("quota set on an expired period: refused or clearly reported, with no usable-allowance claim", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const before = await writes(ctx.userId);
    await expect(
      setAllowanceAllocation(db, {
        ...actor,
        userId: ctx.userId,
        entitlementId: previousId,
        amounts: amounts({ audio: 5000 }),
        operationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { fields: { entitlementId: ["period_ended"] } },
    });
    expect(await writes(ctx.userId)).toEqual(before);
    expect(await readEntitlementAllocation(db, ctx.userId, previousId)).toMatchObject({
      active: false,
      allocated: { audio: 600 },
      available: emptyAmounts(),
    });
    expect(await allowance(db, ctx)).toMatchObject({
      entitlementId: null,
      remaining: emptyAmounts(),
    });
  });

  it("quota new period: a caller without admin authority is refused with no write", async () => {
    const ctx = await learner();
    const stranger = await learner();
    const previousId = await endedPeriod(ctx.userId);
    const before = await writes(ctx.userId);
    for (const actorId of [stranger.userId, ctx.userId, actor.actorId])
      await expect(
        setAllowanceAllocation(db, { ...newPeriod(ctx.userId, previousId), actorId }),
      ).rejects.toMatchObject({ code: "not_found" });
    expect(await writes(ctx.userId)).toEqual(before);
    expect(before).toEqual({ entitlements: 1, ledger: 5, changes: 0 });
    expect(await allowance(db, ctx)).toMatchObject({ entitlementId: null });
  });

  it("quota new period: after the new period a new reservation succeeds", async () => {
    const ctx = await learner();
    const previousId = await endedPeriod(ctx.userId);
    await expect(
      db
        .transaction()
        .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 60 }))),
    ).rejects.toMatchObject({ code: "quota_insufficient" });
    const result = await setAllowanceAllocation(db, newPeriod(ctx.userId, previousId));
    const hold = await db
      .transaction()
      .execute((tx) =>
        reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 60, storage: 500 })),
      );
    expect(hold).toMatchObject({ entitlementId: result.after.entitlementId, replayed: false });
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, hold.id, amounts({ audio: 45, storage: 500 })));
    expect(await allowance(db, ctx)).toMatchObject({
      entitlementId: result.after.entitlementId,
      consumed: { audio: 45, storage: 500 },
      remaining: { audio: 855, storage: 1500 },
    });
    // Storage freed later returns to the period of its reservation (releaseStorage).
    await db.transaction().execute((tx) => releaseStorage(tx, ctx, hold.id));
    expect((await allowance(db, ctx)).remaining.storage).toBe(2000);
  });
});
