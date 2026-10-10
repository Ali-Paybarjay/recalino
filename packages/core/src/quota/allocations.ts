import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, recordAudit } from "../plt";
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

export interface SetAllocationInput {
  userId: string;
  entitlementId: string;
  amounts: Amounts;
  operationKey: string;
  actorId: string;
  reason: string;
}

/** ADM-I16: set a total allocation without rewriting consumption or cancelling existing holds. */
export async function setAllowanceAllocation(
  db: Database,
  input: SetAllocationInput,
  now = new Date(),
): Promise<{ before: EntitlementAllocation; after: EntitlementAllocation; replayed: boolean }> {
  const units = amountsSchema.parse(input.amounts);
  z.uuid().parse(input.userId);
  z.uuid().parse(input.entitlementId);
  z.string().min(8).max(200).parse(input.operationKey);
  if (isUsageReturn(input.operationKey))
    throw errors.validationFailed({ operationKey: ["reserved_storage_return_key"] });
  z.string().trim().min(1).max(200).parse(input.actorId);
  z.string().trim().min(1).max(500).parse(input.reason);
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

function restoreSnapshot(snapshot: EntitlementAllocation): EntitlementAllocation {
  return {
    ...snapshot,
    startsAt: new Date(snapshot.startsAt),
    endsAt: new Date(snapshot.endsAt),
    closedAt: snapshot.closedAt === null ? null : new Date(snapshot.closedAt),
  };
}
