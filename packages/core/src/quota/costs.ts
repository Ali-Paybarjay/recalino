import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, type LearnerContext, recordAudit } from "../plt";
import { reservationIsOpen } from "./ledger";

const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const costPolicySchema = z.strictObject({
  version: z.string().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  killSwitch: z.boolean(),
  limits: z.strictObject({
    session: micros.positive(),
    userMonth: micros.positive(),
    systemDay: micros.positive(),
    systemMonth: micros.positive(),
  }),
});
export type CostPolicy = z.infer<typeof costPolicySchema>;

export async function configureCostPolicy(
  db: Database | Tx,
  input: CostPolicy,
  operator: { actorId: string; reason: string },
  now = new Date(),
) {
  const policy = costPolicySchema.parse(input);
  z.string().trim().min(1).max(500).parse(operator.reason);
  const write = async (tx: Tx) => {
    await sql`select pg_advisory_xact_lock(hashtext('quota.cost_policy'))`.execute(tx);
    await tx
      .insertInto("quota.cost_policy")
      .values({
        singleton: true,
        version: policy.version,
        currency: policy.currency,
        limits: JSON.stringify(policy.limits),
        kill_switch: policy.killSwitch,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("singleton").doUpdateSet({
          version: policy.version,
          currency: policy.currency,
          limits: JSON.stringify(policy.limits),
          kill_switch: policy.killSwitch,
          updated_at: now,
        }),
      )
      .execute();
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: operator.actorId,
      action: "quota.cost_policy",
      subjectType: "cost_policy",
      subjectId: policy.version,
      reason: operator.reason,
    });
  };
  if (db.isTransaction) return write(db as Tx);
  return db.transaction().execute(write);
}

export interface ProviderStep {
  sessionId: string;
  reservationId: string;
  operationKey: string;
  /** A bound from configured provider pricing; never a number supplied by a learner. */
  maximumMicros: number;
  currency: string;
}

/** Check and hold cost atomically before every external call (FR-QUOTA-009, 010). */
export async function beginProviderStep(
  tx: Tx,
  ctx: LearnerContext,
  input: ProviderStep,
  now = new Date(),
) {
  micros.parse(input.maximumMicros);
  z.string().min(8).max(200).parse(input.operationKey);
  z.uuid().parse(input.sessionId);
  await sql`select pg_advisory_xact_lock(hashtext('quota.cost_policy'))`.execute(tx);
  if (!(await reservationIsOpen(tx, ctx, input.reservationId)))
    throw errors.quotaInsufficient({ reason: "reservation_missing" });
  const stored = await tx
    .selectFrom("quota.cost_policy")
    .selectAll()
    .where("singleton", "=", true)
    .executeTakeFirst();
  if (!stored) throw errors.quotaInsufficient({ reason: "cost_policy_missing" });
  const policy = costPolicySchema.parse({
    version: stored.version,
    currency: stored.currency,
    killSwitch: stored.kill_switch,
    limits: stored.limits,
  });
  if (policy.killSwitch) throw errors.quotaInsufficient({ reason: "processing_paused" });
  if (policy.currency !== input.currency)
    throw errors.validationFailed({ currency: ["policy_mismatch"] });
  const prior = await tx
    .selectFrom("quota.cost_hold")
    .selectAll()
    .where("operation_key", "=", input.operationKey)
    .executeTakeFirst();
  if (prior) {
    if (
      prior.user_id !== ctx.userId ||
      prior.session_id !== input.sessionId ||
      prior.reservation_id !== input.reservationId ||
      Number(prior.maximum_micros) !== input.maximumMicros ||
      prior.currency !== input.currency
    )
      throw errors.idempotencyMismatch();
    return { id: prior.id, replayed: true, completed: prior.closed_at !== null };
  }
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const costs = await tx
    .selectFrom("quota.provider_cost")
    .selectAll()
    .where("currency", "=", policy.currency)
    .where((eb) => eb.or([eb("created_at", ">=", month), eb("session_id", "=", input.sessionId)]))
    .execute();
  const holds = await tx
    .selectFrom("quota.cost_hold")
    .selectAll()
    .where("currency", "=", policy.currency)
    .where("closed_at", "is", null)
    .execute();
  const totals = { session: 0, userMonth: 0, systemDay: 0, systemMonth: 0 };
  const add = (
    row: { user_id: string | null; session_id: string | null; created_at: Date },
    amount: number,
  ) => {
    if (row.session_id === input.sessionId) totals.session += amount;
    if (row.created_at >= month) {
      totals.systemMonth += amount;
      if (row.user_id === ctx.userId) totals.userMonth += amount;
    }
    if (row.created_at >= day) totals.systemDay += amount;
  };
  for (const row of costs) {
    const value = row.amount_micros ?? row.estimated_micros;
    if (value === null) throw errors.quotaInsufficient({ reason: "provider_cost_unknown" });
    add(row, Number(value));
  }
  for (const row of holds) add(row, Number(row.maximum_micros));
  for (const scope of ["session", "userMonth", "systemDay", "systemMonth"] as const)
    if (totals[scope] + input.maximumMicros > policy.limits[scope])
      throw errors.quotaInsufficient({ reason: "cost_limit", scope });
  const row = await tx
    .insertInto("quota.cost_hold")
    .values({
      user_id: ctx.userId,
      session_id: input.sessionId,
      reservation_id: input.reservationId,
      operation_key: input.operationKey,
      maximum_micros: input.maximumMicros,
      currency: input.currency,
      created_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, replayed: false, completed: false };
}

export const providerUsageSchema = z.strictObject({
  inputTokens: micros.optional(),
  outputTokens: micros.optional(),
  audioSeconds: micros.optional(),
  characters: micros.optional(),
  pages: micros.optional(),
});
export interface ProviderCost {
  operationKey: string;
  provider: string;
  model: string;
  currency: string;
  actualMicros: number | null;
  estimatedMicros: number | null;
  priceVersion: string | null;
  usage: z.infer<typeof providerUsageSchema>;
  runId?: string;
  attemptId?: string;
}

/** A provider attempt is recorded once; no content or prompts are accepted (FR-QUOTA-008). */
export async function finishProviderStep(
  tx: Tx,
  ctx: LearnerContext,
  holdId: string,
  input: ProviderCost,
  now = new Date(),
) {
  const usage = providerUsageSchema.parse(input.usage);
  for (const value of [input.actualMicros, input.estimatedMicros])
    if (value !== null) micros.parse(value);
  z.string().min(1).max(100).parse(input.provider);
  z.string().min(1).max(200).parse(input.model);
  await sql`select pg_advisory_xact_lock(hashtext('quota.cost_policy'))`.execute(tx);
  const hold = await tx
    .selectFrom("quota.cost_hold")
    .selectAll()
    .where("id", "=", holdId)
    .where("user_id", "=", ctx.userId)
    .forUpdate()
    .executeTakeFirst();
  if (!hold) throw errors.notFound();
  if (hold.operation_key !== input.operationKey || hold.currency !== input.currency)
    throw errors.idempotencyMismatch();
  if (hold.closed_at) {
    const prior = await tx
      .selectFrom("quota.provider_cost")
      .selectAll()
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (
      !prior ||
      prior.provider !== input.provider ||
      prior.model !== input.model ||
      (prior.amount_micros === null ? null : Number(prior.amount_micros)) !== input.actualMicros ||
      (prior.estimated_micros === null ? null : Number(prior.estimated_micros)) !==
        input.estimatedMicros ||
      prior.price_version !== input.priceVersion ||
      canonicalJson(prior.usage) !== canonicalJson(usage)
    )
      throw errors.idempotencyMismatch();
    return;
  }
  await tx
    .insertInto("quota.provider_cost")
    .values({
      user_id: ctx.userId,
      session_id: hold.session_id,
      operation_key: input.operationKey,
      provider: input.provider,
      model: input.model,
      currency: input.currency,
      amount_micros: input.actualMicros,
      estimated_micros: input.estimatedMicros,
      price_version: input.priceVersion,
      usage: JSON.stringify(usage),
      run_id: input.runId ?? null,
      attempt_id: input.attemptId ?? null,
      created_at: now,
    })
    .execute();
  await tx
    .updateTable("quota.cost_hold")
    .set({ closed_at: now })
    .where("id", "=", hold.id)
    .execute();
}
