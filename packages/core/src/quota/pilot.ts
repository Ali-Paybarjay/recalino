import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import type { Database } from "../db";
import { canonicalJson, errors } from "../plt";
import { amountsSchema } from "./amounts";
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
    const first = await tx
      .selectFrom("quota.entitlement")
      .select("operation_key")
      .where("operation_key", "like", `pilot:${policy.pilotId}:%:initial`)
      .executeTakeFirst();
    if (first && !first.operation_key.endsWith(`:${fingerprint}:initial`))
      throw errors.idempotencyMismatch();
    const previous = await tx
      .selectFrom("quota.entitlement")
      .select("id")
      .where("operation_key", "=", storedKey)
      .executeTakeFirst();
    if (!previous) {
      // Closed and expired initial grants remain admissions; they never create free new slots.
      const count = await tx
        .selectFrom("quota.entitlement")
        .select((eb) => eb.fn.count<number>("user_id").distinct().as("participants"))
        .where("operation_key", "like", `pilot:${policy.pilotId}:%:initial`)
        .executeTakeFirstOrThrow();
      if (Number(count.participants) >= policy.maximumParticipants)
        throw errors.quotaInsufficient({ reason: "pilot_capacity" });
    }
    return grantEntitlementInTransaction(
      tx,
      { ...input, userId, operationKey: storedKey, amounts: policy.amounts, endsAt },
      now,
    );
  });
}
