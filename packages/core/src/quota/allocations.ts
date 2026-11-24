import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, isAdminOwner, recordAudit } from "../plt";
import type { AllowanceAccounting } from "./accounting";
import { isUsageReturn, summarizeAllowanceLedger } from "./accounting";
import { type Amounts, amountsSchema, DIMENSIONS } from "./amounts";

export interface EntitlementAllocation extends AllowanceAccounting {
  entitlementId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  closedAt: Date | null;
  active: boolean;
}

export async function readEntitlementAllocation(
  db: Database | Tx,
  userId: string,
  entitlementId: string,
  now = new Date(),
): Promise<EntitlementAllocation> {
  z.uuid().parse(userId);
  z.uuid().parse(entitlementId);
  const row = await db
    .selectFrom("quota.entitlement")
    .selectAll()
    .where("id", "=", entitlementId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  const rows = await db
    .selectFrom("quota.ledger")
    .selectAll()
    .where("entitlement_id", "=", row.id)
    .where("user_id", "=", userId)
    .execute();
  const active = row.closed_at === null && row.starts_at <= now && now < row.ends_at;
  return {
    entitlementId: row.id,
    userId: row.user_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    closedAt: row.closed_at,
    active,
    ...summarizeAllowanceLedger(rows, active),
  };
}

export interface AllowancePeriod {
  startsAt: Date;
  endsAt: Date;
}

export interface SetAllocationInput {
  userId: string;
  entitlementId: string;
  amounts: Amounts;
  operationKey: string;
  actorId: string;
  reason: string;
  /**
   * P12-08 (F-2): open a new allowance period after `entitlementId` has ended or was closed.
   * The new period is its own entitlement row with its own grant ledger; the previous row is
   * never changed and its remainder does not carry over. Only a live admin owner may do this.
   */
  period?: AllowancePeriod;
  /** Request id recorded on the audit event of a new period. */
  requestId?: string;
}

export interface AllocationChange {
  before: EntitlementAllocation;
  after: EntitlementAllocation;
  replayed: boolean;
}

/**
 * The private key of a new period's entitlement and grant rows. It names the account, the
 * period and the operator's operation key, and never has the pilot admission form
 * `pilot:<pilotId>:<userId>:initial`, so a new period is not a second pilot admission.
 */
export function allowancePeriodOperationKey(
  userId: string,
  period: AllowancePeriod,
  operationKey: string,
): string {
  return `period:${z.uuid().parse(userId).toLowerCase()}:${period.startsAt.toISOString()}:${period.endsAt.toISOString()}:${operationKey}`;
}

/**
 * ADM-I16: set a total allocation without rewriting consumption or cancelling existing holds.
 * With `period`, open a new allowance period instead (P12-08, F-2).
 */
export async function setAllowanceAllocation(
  db: Database,
  input: SetAllocationInput,
  now = new Date(),
): Promise<AllocationChange> {
  const units = amountsSchema.parse(input.amounts);
  z.uuid().parse(input.userId);
  z.uuid().parse(input.entitlementId);
  z.string().min(8).max(200).parse(input.operationKey);
  if (isUsageReturn(input.operationKey))
    throw errors.validationFailed({ operationKey: ["reserved_storage_return_key"] });
  z.string().trim().min(1).max(200).parse(input.actorId);
  z.string().trim().min(1).max(500).parse(input.reason);
  if (input.requestId !== undefined) z.string().min(1).max(200).parse(input.requestId);
  if (input.period) return startAllowancePeriod(db, input, input.period, units, now);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, input.userId);
    const previous = await sql<{
      entitlement_id: string;
      requested_amounts: Amounts;
      before_snapshot: EntitlementAllocation;
      after_snapshot: EntitlementAllocation;
    }>`select entitlement_id, requested_amounts, before_snapshot, after_snapshot
       from quota.allocation_change where user_id = ${input.userId}
       and operation_key = ${input.operationKey}`.execute(tx);
    const prior = previous.rows[0];
    if (prior) {
      if (
        prior.entitlement_id !== input.entitlementId ||
        // A new period records the previous entitlement as `before`; it is not this change.
        prior.before_snapshot.entitlementId !== prior.entitlement_id ||
        canonicalJson(prior.requested_amounts) !== canonicalJson(units)
      )
        throw errors.idempotencyMismatch();
      return {
        before: restoreSnapshot(prior.before_snapshot),
        after: restoreSnapshot(prior.after_snapshot),
        replayed: true,
      };
    }
    const before = await readEntitlementAllocation(tx, input.userId, input.entitlementId, now);
    // F-9: an ended period never yields usable allowance again, so a change there would only
    // look saved. The owner opens a new period instead.
    if (before.endsAt <= now) throw errors.conflict({ entitlementId: ["period_ended"] });
    // Reject collisions with any previous grant/reserve/adjust, including legacy CLI adjustments.
    const collision = await tx
      .selectFrom("quota.ledger")
      .select("id")
      .where("user_id", "=", input.userId)
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (collision) throw errors.idempotencyMismatch();
    for (const dimension of DIMENSIONS) {
      const delta = units[dimension] - before.allocated[dimension];
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: input.userId,
          entitlement_id: input.entitlementId,
          dimension,
          kind: "adjust",
          amount: Math.abs(delta),
          balance_delta: delta,
          operation_key: input.operationKey,
          created_at: now,
        })
        .execute();
    }
    const after = await readEntitlementAllocation(tx, input.userId, input.entitlementId, now);
    await sql`insert into quota.allocation_change
      (user_id, entitlement_id, operation_key, requested_amounts, before_snapshot,
       after_snapshot, actor_id, reason, created_at)
      values (${input.userId}, ${input.entitlementId}, ${input.operationKey},
       ${JSON.stringify(units)}::jsonb, ${JSON.stringify(before)}::jsonb,
       ${JSON.stringify(after)}::jsonb, ${input.actorId}, ${input.reason}, ${now})`.execute(tx);
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      action: "quota.set_allocation",
      subjectType: "entitlement",
      subjectId: input.entitlementId,
      reason: input.reason,
      requestId: input.operationKey,
    });
    return { before, after, replayed: false };
  });
}

/**
 * P12-08 (F-2, F-10): one transaction writes the new entitlement, one grant per dimension, one
 * allocation_change row and its audit event, or nothing. The previous period must have ended or
 * been closed, and no unclosed period may overlap the new one in time; an unclosed period that
 * ended before the new one starts does not block it. Storage released later from a reservation
 * of the previous period returns to that period (releaseStorage), not to the new one.
 */
async function startAllowancePeriod(
  db: Database,
  input: SetAllocationInput,
  period: AllowancePeriod,
  units: Amounts,
  now: Date,
): Promise<AllocationChange> {
  if (
    !Number.isFinite(period.startsAt.getTime()) ||
    !Number.isFinite(period.endsAt.getTime()) ||
    period.endsAt <= period.startsAt
  )
    throw errors.validationFailed({ period: ["invalid"] });
  const userId = input.userId.toLowerCase();
  const periodKey = allowancePeriodOperationKey(userId, period, input.operationKey);
  return db.transaction().execute(async (tx) => {
    // Defence in depth behind the admin route: the actor must be the live admin owner.
    if (!(await isAdminOwner(tx, input.actorId))) throw errors.ownershipDenied();
    await lockAccount(tx, userId);
    const previous = await sql<{
      entitlement_id: string;
      requested_amounts: Amounts;
      before_snapshot: EntitlementAllocation;
      after_snapshot: EntitlementAllocation;
    }>`select entitlement_id, requested_amounts, before_snapshot, after_snapshot
       from quota.allocation_change where user_id = ${userId}
       and operation_key = ${input.operationKey}`.execute(tx);
    const prior = previous.rows[0];
    if (prior) {
      const created = await tx
        .selectFrom("quota.entitlement")
        .select("operation_key")
        .where("id", "=", prior.entitlement_id)
        .executeTakeFirst();
      if (
        created?.operation_key !== periodKey ||
        prior.before_snapshot.entitlementId !== input.entitlementId ||
        canonicalJson(prior.requested_amounts) !== canonicalJson(units)
      )
        throw errors.idempotencyMismatch();
      return {
        before: restoreSnapshot(prior.before_snapshot),
        after: restoreSnapshot(prior.after_snapshot),
        replayed: true,
      };
    }
    const before = await readEntitlementAllocation(tx, userId, input.entitlementId, now);
    if (before.closedAt === null && now < before.endsAt)
      throw errors.conflict({ entitlementId: ["period_not_ended"] });
    // F-10: the same test as grantEntitlementInTransaction (ledger.ts): unclosed and overlapping.
    const overlap = await tx
      .selectFrom("quota.entitlement")
      .select("id")
      .where("user_id", "=", userId)
      .where("closed_at", "is", null)
      .where("starts_at", "<", period.endsAt)
      .where("ends_at", ">", period.startsAt)
      .executeTakeFirst();
    if (overlap) throw errors.conflict({ period: ["overlaps_unclosed_period"] });
    const collision = await tx
      .selectFrom("quota.entitlement")
      .select("id")
      .where("operation_key", "=", periodKey)
      .executeTakeFirst();
    if (collision) throw errors.idempotencyMismatch();
    const row = await tx
      .insertInto("quota.entitlement")
      .values({
        user_id: userId,
        starts_at: period.startsAt,
        ends_at: period.endsAt,
        operation_key: periodKey,
        created_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const dimension of DIMENSIONS)
      await tx
        .insertInto("quota.ledger")
        .values({
          user_id: userId,
          entitlement_id: row.id,
          kind: "grant",
          dimension,
          amount: units[dimension],
          balance_delta: units[dimension],
          operation_key: periodKey,
          created_at: now,
        })
        .execute();
    const after = await readEntitlementAllocation(tx, userId, row.id, now);
    await sql`insert into quota.allocation_change
      (user_id, entitlement_id, operation_key, requested_amounts, before_snapshot,
       after_snapshot, actor_id, reason, created_at)
      values (${userId}, ${row.id}, ${input.operationKey},
       ${JSON.stringify(units)}::jsonb, ${JSON.stringify(before)}::jsonb,
       ${JSON.stringify(after)}::jsonb, ${input.actorId}, ${input.reason}, ${now})`.execute(tx);
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      action: "quota.new_period",
      subjectType: "entitlement",
      subjectId: row.id,
      reason: input.reason,
      requestId: input.requestId ?? input.operationKey,
    });
    return { before, after, replayed: false };
  });
}

function restoreSnapshot(snapshot: EntitlementAllocation): EntitlementAllocation {
  return {
    ...snapshot,
    startsAt: new Date(snapshot.startsAt),
    endsAt: new Date(snapshot.endsAt),
    closedAt: snapshot.closedAt === null ? null : new Date(snapshot.closedAt),
  };
}
