import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, recordAudit } from "../plt";
import { type Amounts, amountsSchema, DIMENSIONS, emptyAmounts } from "./amounts";
import { grantEntitlementInTransaction } from "./ledger";

const pilotIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9-]+$/);
export const pilotPolicySchema = z.strictObject({
  version: z.string().min(1).max(100),
  pilotId: pilotIdSchema,
  maximumParticipants: z.number().int().min(1).max(10000),
  periodDays: z.number().int().min(1).max(366),
  amounts: amountsSchema,
});
export type PilotPolicy = z.infer<typeof pilotPolicySchema>;

/** One initial grant per account and pilot, independent of request retries or expiry. */
export function pilotGrantOperationKey(pilotId: string, userId: string): string {
  return `pilot:${pilotIdSchema.parse(pilotId)}:${z.uuid().parse(userId).toLowerCase()}:initial`;
}

export interface PilotGrantInput {
  userId: string;
  policy: PilotPolicy;
  startsAt: Date;
  operationKey: string;
  actorId: string;
  reason: string;
}

/**
 * Trusted operator only. Admission and its grant commit together; no sign-in grants implicitly.
 * The supplied policy is approved operator configuration, never learner-controlled input.
 */
export async function grantPilotEntitlement(
  db: Database,
  input: PilotGrantInput,
  now = new Date(),
) {
  const policy = pilotPolicySchema.parse(input.policy);
  const userId = z.uuid().parse(input.userId).toLowerCase();
  const key = pilotGrantOperationKey(policy.pilotId, userId);
  if (input.operationKey !== key)
    throw errors.validationFailed({ operationKey: ["pilot_initial_key_required"] });
  const fingerprint = createHash("sha256").update(canonicalJson(policy)).digest("hex");
  // Persist the policy fingerprint in the private grant key without changing the operator key.
  const storedKey = `pilot:${policy.pilotId}:${userId}:${fingerprint}:initial`;
  const endsAt = new Date(input.startsAt.getTime() + policy.periodDays * 86400000);
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`quota.pilot:${policy.pilotId}`}))`.execute(
      tx,
    );
    const current = await activePilotRevision(tx, policy.pilotId);
    const first = await tx
      .selectFrom("quota.entitlement")
      .select("operation_key")
      .where("operation_key", "like", `pilot:${policy.pilotId}:%:initial`)
      .executeTakeFirst();
    if (!current && first && !first.operation_key.endsWith(`:${fingerprint}:initial`))
      throw errors.idempotencyMismatch();
    const previous = await tx
      .selectFrom("quota.entitlement")
      .select("id")
      .where("operation_key", "=", storedKey)
      .executeTakeFirst();
    if (!previous) {
      const existingAdmission = await tx
        .selectFrom("quota.entitlement")
        .select("id")
        .where("user_id", "=", userId)
        .where("operation_key", "like", `pilot:${policy.pilotId}:%:initial`)
        .executeTakeFirst();
      if (existingAdmission) throw errors.idempotencyMismatch();
      // Closed and expired initial grants remain admissions; they never create free new slots.
      const count = await tx
        .selectFrom("quota.entitlement")
        .select((eb) => eb.fn.count<number>("user_id").distinct().as("participants"))
        .where("operation_key", "like", `pilot:${policy.pilotId}:%:initial`)
        .executeTakeFirstOrThrow();
      if (
        Number(count.participants) >= (current?.maximumParticipants ?? policy.maximumParticipants)
      )
        throw errors.quotaInsufficient({ reason: "pilot_capacity" });
    }
    return grantEntitlementInTransaction(
      tx,
      { ...input, userId, operationKey: storedKey, amounts: policy.amounts, endsAt },
      now,
    );
  });
}

/** ADM-I03/I14: presets are editable defaults, independent of each admission's allocations. */
export const pilotConfigurationSchema = z.strictObject({
  version: z.string().trim().min(1).max(100),
  pilotId: pilotIdSchema,
  maximumParticipants: z.number().int().nonnegative().safe(),
  periodDays: z.number().int().min(1).max(366),
  amounts: amountsSchema,
});
export type PilotConfigurationInput = z.infer<typeof pilotConfigurationSchema> & {
  operationKey: string;
  actorId: string;
  reason: string;
};
export interface PilotConfiguration extends z.infer<typeof pilotConfigurationSchema> {
  revision: number;
  createdAt: Date;
  historicalAdmissions: number;
  activeParticipants: number;
  remainingPlaces: number;
}
interface PilotRevisionRow {
  revision: string;
  pilot_id: string;
  version: string;
  maximum_participants: string;
  period_days: number;
  amounts: Amounts;
  operation_key: string;
  request_hash: string;
  created_at: Date;
}

async function activePilotRevision(db: Database | Tx, pilotId: string) {
  const { rows } = await sql<PilotRevisionRow>`select * from quota.pilot_revision
    where pilot_id = ${pilotId} order by revision desc limit 1`.execute(db);
  return rows[0] ? revisionView(rows[0]) : null;
}

function revisionView(row: PilotRevisionRow) {
  return {
    ...pilotConfigurationSchema.parse({
      version: row.version,
      pilotId: row.pilot_id,
      maximumParticipants: Number(row.maximum_participants),
      periodDays: row.period_days,
      amounts: row.amounts,
    }),
    revision: z.number().int().safe().parse(Number(row.revision)),
    createdAt: row.created_at,
  };
}

async function pilotCounts(db: Database | Tx, pilotId: string, now: Date) {
  const { rows } = await sql<{ historical: string; active: string }>`
    select count(distinct user_id) as historical,
      count(distinct user_id) filter(where closed_at is null
        and starts_at <= ${now} and ends_at > ${now}) as active
    from quota.entitlement where operation_key like ${`pilot:${pilotId}:%:initial`}`.execute(db);
  return {
    historicalAdmissions: Number(rows[0]?.historical ?? 0),
    activeParticipants: Number(rows[0]?.active ?? 0),
  };
}

export async function readPilotConfiguration(
  db: Database | Tx,
  pilotId: string,
  now = new Date(),
): Promise<PilotConfiguration | null> {
  pilotIdSchema.parse(pilotId);
  const current = await activePilotRevision(db, pilotId);
  if (!current) return null;
  const counts = await pilotCounts(db, pilotId, now);
  return {
    ...current,
    ...counts,
    remainingPlaces: Math.max(0, current.maximumParticipants - counts.historicalAdmissions),
  };
}

/** Each capacity/preset revision is immutable and shares the admission lock with both CLIs/APIs. */
export async function configurePilot(
  db: Database,
  input: PilotConfigurationInput,
  now = new Date(),
): Promise<PilotConfiguration> {
  const config = pilotConfigurationSchema.parse({
    version: input.version,
    pilotId: input.pilotId,
    maximumParticipants: input.maximumParticipants,
    periodDays: input.periodDays,
    amounts: input.amounts,
  });
  z.string().min(8).max(200).parse(input.operationKey);
  z.string().trim().min(1).max(200).parse(input.actorId);
  z.string().trim().min(1).max(500).parse(input.reason);
  const fingerprint = createHash("sha256").update(canonicalJson(config)).digest("hex");
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`quota.pilot:${config.pilotId}`}))`.execute(
      tx,
    );
    const { rows } = await sql<PilotRevisionRow>`select * from quota.pilot_revision
      where operation_key = ${input.operationKey}
      or (pilot_id = ${config.pilotId} and version = ${config.version})`.execute(tx);
    if (rows.length > 0) {
      const previous = rows[0];
      if (
        !previous ||
        rows.length !== 1 ||
        previous.request_hash !== fingerprint ||
        previous.operation_key !== input.operationKey
      )
        throw errors.idempotencyMismatch();
      const counts = await pilotCounts(tx, config.pilotId, now);
      return {
        ...revisionView(previous),
        ...counts,
        remainingPlaces: Math.max(0, config.maximumParticipants - counts.historicalAdmissions),
      };
    }
    const previous = await activePilotRevision(tx, config.pilotId);
    const created = await sql<PilotRevisionRow>`insert into quota.pilot_revision
      (pilot_id, version, maximum_participants, period_days, amounts,
       operation_key, request_hash, actor_id, reason, created_at, previous_revision)
      values (${config.pilotId}, ${config.version}, ${config.maximumParticipants},
        ${config.periodDays}, ${JSON.stringify(config.amounts)}::jsonb,
        ${input.operationKey}, ${fingerprint}, ${input.actorId}, ${input.reason}, ${now},
        ${previous?.revision ?? null}) returning *`.execute(tx);
    const row = created.rows[0];
    if (!row) throw new Error("pilot_revision_missing");
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      action: "quota.pilot_configure",
      subjectType: "pilot",
      subjectId: config.pilotId,
      reason: input.reason,
      requestId: input.operationKey,
    });
    const counts = await pilotCounts(tx, config.pilotId, now);
    return {
      ...revisionView(row),
      ...counts,
      remainingPlaces: Math.max(0, config.maximumParticipants - counts.historicalAdmissions),
    };
  });
}

export interface AdminPilotGrantInput {
  pilotId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  amounts: Amounts;
  operationKey: string;
  actorId: string;
  reason: string;
}

/** Custom allocations and period belong to the account snapshot, not a shared policy hash. */
export async function grantAdminPilotEntitlement(
  db: Database,
  input: AdminPilotGrantInput,
  now = new Date(),
): Promise<string> {
  const pilotId = pilotIdSchema.parse(input.pilotId);
  const userId = z.uuid().parse(input.userId).toLowerCase();
  const units = amountsSchema.parse(input.amounts);
  if (input.operationKey !== pilotGrantOperationKey(pilotId, userId))
    throw errors.validationFailed({ operationKey: ["pilot_initial_key_required"] });
  if (
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt <= input.startsAt
  )
    throw errors.validationFailed({ period: ["invalid"] });
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`quota.pilot:${pilotId}`}))`.execute(tx);
    const previous = await tx
      .selectFrom("quota.entitlement")
      .selectAll()
      .where("user_id", "=", userId)
      .where("operation_key", "like", `pilot:${pilotId}:%:initial`)
      .executeTakeFirst();
    if (previous) {
      // Historical fingerprint keys remain untouched and replay using their original grant.
      const grants = await tx
        .selectFrom("quota.ledger")
        .selectAll()
        .where("entitlement_id", "=", previous.id)
        .where("kind", "=", "grant")
        .execute();
      const original = emptyAmounts();
      for (const row of grants)
        original[z.enum(DIMENSIONS).parse(row.dimension)] = Number(row.amount);
      if (
        previous.starts_at.getTime() !== input.startsAt.getTime() ||
        previous.ends_at.getTime() !== input.endsAt.getTime() ||
        canonicalJson(original) !== canonicalJson(units)
      )
        throw errors.idempotencyMismatch();
      return grantEntitlementInTransaction(
        tx,
        {
          ...input,
          userId,
          amounts: units,
          operationKey: previous.operation_key,
        },
        now,
      );
    }
    const config = await readPilotConfiguration(tx, pilotId, now);
    if (!config) throw errors.validationFailed({ pilotId: ["pilot_configuration_missing"] });
    if (config.historicalAdmissions >= config.maximumParticipants)
      throw errors.quotaInsufficient({ reason: "pilot_capacity" });
    const fingerprint = createHash("sha256")
      .update(
        canonicalJson({
          userId,
          pilotId,
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          amounts: units,
        }),
      )
      .digest("hex");
    return grantEntitlementInTransaction(
      tx,
      {
        ...input,
        userId,
        amounts: units,
        operationKey: `pilot:${pilotId}:${userId}:${fingerprint}:initial`,
      },
      now,
    );
  });
}
