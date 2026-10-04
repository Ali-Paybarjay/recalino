import { sql } from "kysely";
import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, type LearnerContext, recordAudit } from "../plt";
import { type Amounts, amountsSchema, DIMENSIONS, emptyAmounts } from "./amounts";

type Connection = Database | Tx;
const operationKey = z.string().min(8).max(200);

export async function allowance(db: Connection, ctx: LearnerContext, now = new Date()) {
  const entitlement = await db
    .selectFrom("quota.entitlement")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("starts_at", "<=", now)
    .where("ends_at", ">", now)
    .where("closed_at", "is", null)
    .executeTakeFirst();
  const remaining = emptyAmounts();
  const reserved = emptyAmounts();
  const consumed = emptyAmounts();
  if (entitlement) {
    const rows = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where("entitlement_id", "=", entitlement.id)
      .where("user_id", "=", ctx.userId)
      .execute();
    for (const row of rows) {
      const dimension = z.enum(DIMENSIONS).parse(row.dimension);
      remaining[dimension] += Number(row.balance_delta);
      if (row.kind === "reserve") reserved[dimension] += Number(row.amount);
      if (row.kind === "settle") {
        consumed[dimension] += Number(row.amount);
        reserved[dimension] -= Number(row.amount);
      }
      if (row.kind === "release") reserved[dimension] -= Number(row.amount);
      if (row.kind === "adjust" && row.operation_key.startsWith("storage-return:"))
        consumed[dimension] -= Number(row.amount);
    }
  }
  return {
    entitlementId: entitlement?.id ?? null,
    endsAt: entitlement?.ends_at ?? null,
    remaining: amountsSchema.parse(remaining),
    reserved: amountsSchema.parse(reserved),
    consumed: amountsSchema.parse(consumed),
  };
}

export interface GrantInput {
  userId: string;
  startsAt: Date;
  endsAt: Date;
  amounts: Amounts;
  operationKey: string;
  actorId: string;
  reason: string;
}

/** Internal operator API. No web route exposes it (FR-QUOTA-002). */
export async function grantEntitlement(db: Database, input: GrantInput, now = new Date()) {
  const units = amountsSchema.parse(input.amounts);
  operationKey.parse(input.operationKey);
  z.string().trim().min(1).max(500).parse(input.reason);
  z.string().trim().min(1).max(200).parse(input.actorId);
  if (
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt <= input.startsAt
  )
    throw errors.validationFailed({ period: ["invalid"] });
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, input.userId);
    const previous = await tx
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (previous) {
      const grant = await tx
        .selectFrom("quota.ledger")
        .selectAll()
        .where("entitlement_id", "=", previous.id)
        .where("kind", "=", "grant")
        .execute();
      const original = emptyAmounts();
      for (const row of grant)
        original[z.enum(DIMENSIONS).parse(row.dimension)] = Number(row.amount);
      if (
        previous.user_id !== input.userId ||
        previous.starts_at.getTime() !== input.startsAt.getTime() ||
        previous.ends_at.getTime() !== input.endsAt.getTime() ||
        canonicalJson(original) !== canonicalJson(units)
      )
        throw errors.idempotencyMismatch();
      return previous.id;
    }
    const overlap = await tx
      .selectFrom("quota.entitlement")
      .select("id")
      .where("user_id", "=", input.userId)
      .where("closed_at", "is", null)
      .where("starts_at", "<", input.endsAt)
      .where("ends_at", ">", input.startsAt)
      .executeTakeFirst();
    if (overlap) throw errors.conflict();
    const row = await tx
      .insertInto("quota.entitlement")
      .values({
        user_id: input.userId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        operation_key: input.operationKey,
        created_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const dimension of DIMENSIONS)
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: input.userId,
          entitlement_id: row.id,
          kind: "grant",
          dimension,
          amount: units[dimension],
          balance_delta: units[dimension],
          operation_key: input.operationKey,
          created_at: now,
        })
        .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      action: "quota.grant",
      subjectType: "entitlement",
      subjectId: row.id,
      reason: input.reason,
    });
    return row.id;
  });
}

/** Must share the transaction that creates the consumer Run/upload (FR-QUOTA-005, 011). */
export async function reserveAllowance(
  tx: Tx,
  ctx: LearnerContext,
  key: string,
  requested: Amounts,
  now = new Date(),
) {
  operationKey.parse(key);
  const units = amountsSchema.parse(requested);
  await lockAccount(tx, ctx.userId);
  const previous = await tx
    .selectFrom("quota.reservation")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("operation_key", "=", key)
    .executeTakeFirst();
  if (previous) {
    if (canonicalJson(previous.amounts) !== canonicalJson(units))
      throw errors.idempotencyMismatch();
    return { id: previous.id, entitlementId: previous.entitlement_id, replayed: true };
  }
  const balance = await allowance(tx, ctx, now);
  if (!balance.entitlementId || DIMENSIONS.some((d) => units[d] > balance.remaining[d]))
    throw errors.quotaInsufficient({ required: units, remaining: balance.remaining });
  const row = await tx
    .insertInto("quota.reservation")
    .values({
      user_id: ctx.userId,
      entitlement_id: balance.entitlementId,
      operation_key: key,
      amounts: JSON.stringify(units),
      created_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const dimension of DIMENSIONS)
    if (units[dimension] > 0)
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: ctx.userId,
          entitlement_id: balance.entitlementId,
          reservation_id: row.id,
          kind: "reserve",
          dimension,
          amount: units[dimension],
          balance_delta: -units[dimension],
          operation_key: `reserve:${row.id}`,
          created_at: now,
        })
        .execute();
  return { id: row.id, entitlementId: balance.entitlementId, replayed: false };
}

/** Only published output is charged; retries and unused work are released (FR-QUOTA-006). */
export async function settleAllowance(
  tx: Tx,
  ctx: LearnerContext,
  reservationId: string,
  published: Amounts,
  now = new Date(),
) {
  const used = amountsSchema.parse(published);
  await lockAccount(tx, ctx.userId);
  const row = await tx
    .selectFrom("quota.reservation")
    .selectAll()
    .where("id", "=", reservationId)
    .where("user_id", "=", ctx.userId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  const held = amountsSchema.parse(row.amounts);
  if (row.closed_at) {
    if (canonicalJson(row.settled_amounts) !== canonicalJson(used))
      throw errors.idempotencyMismatch();
    return;
  }
  if (DIMENSIONS.some((d) => used[d] > held[d]))
    throw errors.validationFailed({ published: ["exceeds_reservation"] });
  for (const dimension of DIMENSIONS) {
    if (used[dimension] > 0)
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: ctx.userId,
          entitlement_id: row.entitlement_id,
          reservation_id: row.id,
          kind: "settle",
          dimension,
          amount: used[dimension],
          balance_delta: 0,
          operation_key: `settle:${row.id}`,
          created_at: now,
        })
        .execute();
    const released = held[dimension] - used[dimension];
    if (released > 0)
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: ctx.userId,
          entitlement_id: row.entitlement_id,
          reservation_id: row.id,
          kind: "release",
          dimension,
          amount: released,
          balance_delta: released,
          operation_key: `release:${row.id}`,
          created_at: now,
        })
        .execute();
  }
  await tx
    .updateTable("quota.reservation")
    .set({ closed_at: now, settled_amounts: JSON.stringify(used) })
    .where("id", "=", row.id)
    .execute();
}

export async function closeEntitlement(
  db: Database,
  input: { userId: string; entitlementId: string; actorId: string; reason: string },
  now = new Date(),
) {
  z.string().trim().min(1).max(500).parse(input.reason);
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, input.userId);
    const row = await tx
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", input.entitlementId)
      .where("user_id", "=", input.userId)
      .executeTakeFirst();
    if (!row) throw errors.notFound();
    if (row.closed_at) return;
    await tx
      .updateTable("quota.entitlement")
      .set({ closed_at: now })
      .where("id", "=", row.id)
      .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      reason: input.reason,
      action: "quota.close",
      subjectType: "entitlement",
      subjectId: row.id,
    });
  });
}

export async function adjustAllowance(
  db: Database,
  input: {
    userId: string;
    entitlementId: string;
    dimension: (typeof DIMENSIONS)[number];
    delta: number;
    operationKey: string;
    actorId: string;
    reason: string;
  },
  now = new Date(),
) {
  operationKey.parse(input.operationKey);
  z.enum(DIMENSIONS).parse(input.dimension);
  z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).parse(input.delta);
  z.string().trim().min(1).max(500).parse(input.reason);
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, input.userId);
    const row = await tx
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("id", "=", input.entitlementId)
      .where("user_id", "=", input.userId)
      .executeTakeFirst();
    if (!row) throw errors.notFound();
    const prior = await tx
      .selectFrom("quota.ledger")
      .selectAll()
      .where("user_id", "=", input.userId)
      .where("operation_key", "=", input.operationKey)
      .execute();
    if (prior.length) {
      if (
        prior.length !== 1 ||
        prior[0]?.entitlement_id !== row.id ||
        prior[0]?.dimension !== input.dimension ||
        Number(prior[0]?.balance_delta) !== input.delta ||
        prior[0]?.kind !== "adjust"
      )
        throw errors.idempotencyMismatch();
      return;
    }
    const sum = await tx
      .selectFrom("quota.ledger")
      .select(sql<string>`coalesce(sum(balance_delta), 0)`.as("total"))
      .where("entitlement_id", "=", row.id)
      .where("dimension", "=", input.dimension)
      .executeTakeFirstOrThrow();
    if (Number(sum.total) + input.delta < 0) throw errors.quotaInsufficient();
    await tx
      .insertInto("quota.ledger")
      .values({
        user_id: input.userId,
        entitlement_id: row.id,
        dimension: input.dimension,
        kind: "adjust",
        amount: Math.abs(input.delta),
        balance_delta: input.delta,
        operation_key: input.operationKey,
        created_at: now,
      })
      .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      reason: input.reason,
      action: "quota.adjust",
      subjectType: "entitlement",
      subjectId: row.id,
    });
  });
}

export async function reservationIsOpen(
  db: Connection,
  ctx: LearnerContext,
  reservationId: string,
) {
  const row = await db
    .selectFrom("quota.reservation")
    .select("id")
    .where("id", "=", reservationId)
    .where("user_id", "=", ctx.userId)
    .where("closed_at", "is", null)
    .executeTakeFirst();
  return row !== undefined;
}

export async function confirmedReservationAmounts(
  db: Connection,
  ctx: LearnerContext,
  id: string,
): Promise<Amounts | null> {
  const row = await db
    .selectFrom("quota.reservation")
    .select("amounts")
    .where("id", "=", id)
    .where("user_id", "=", ctx.userId)
    .where("closed_at", "is", null)
    .executeTakeFirst();
  return row ? amountsSchema.parse(row.amounts) : null;
}
export async function reservationForOperation(
  db: Connection,
  ctx: LearnerContext,
  operationKey: string,
): Promise<{ id: string; amounts: Amounts } | null> {
  const row = await db
    .selectFrom("quota.reservation")
    .select(["id", "amounts"])
    .where("user_id", "=", ctx.userId)
    .where("operation_key", "=", operationKey)
    .executeTakeFirst();
  return row ? { id: row.id, amounts: amountsSchema.parse(row.amounts) } : null;
}

/** Called by SRC only after physical deletion; returning live storage never refunds AI work. */
export async function releaseStorage(
  tx: Tx,
  ctx: LearnerContext,
  reservationId: string,
  now = new Date(),
) {
  await lockAccountForCleanup(tx, ctx.userId);
  const row = await tx
    .selectFrom("quota.reservation")
    .selectAll()
    .where("id", "=", reservationId)
    .where("user_id", "=", ctx.userId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  if (!row.closed_at || !row.settled_amounts) throw errors.conflict();
  const returned = amountsSchema.parse(row.settled_amounts).storage;
  if (!returned) return;
  await tx
    .insertInto("quota.ledger")
    .values({
      user_id: ctx.userId,
      entitlement_id: row.entitlement_id,
      reservation_id: row.id,
      kind: "adjust",
      dimension: "storage",
      amount: returned,
      balance_delta: returned,
      operation_key: `storage-return:${row.id}`,
      created_at: now,
    })
    .onConflict((oc) => oc.columns(["user_id", "operation_key", "dimension"]).doNothing())
    .execute();
}
