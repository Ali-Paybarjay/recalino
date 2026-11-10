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

/**
 * Spend counted against each cost limit: recorded provider costs (actual, else estimated) of this
 * month or this session, plus every open hold. PERF-04: one aggregate query instead of reading the
 * month's rows into memory. A cost with neither amount stops the check, as before.
 */
export async function spendTotals(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  currency: string,
  now: Date,
): Promise<{ session: number; userMonth: number; systemDay: number; systemMonth: number }> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { rows } = await sql<{
    unknown: string | number;
    session: string | number;
    user_month: string | number;
    system_day: string | number;
    system_month: string | number;
  }>`
    select
      count(*) filter (where spend.amount is null) as unknown,
      coalesce(sum(spend.amount) filter (where spend.session_id = ${sessionId}), 0) as session,
      coalesce(
        sum(spend.amount) filter (where spend.created_at >= ${month} and spend.user_id = ${ctx.userId}),
        0
      ) as user_month,
      coalesce(sum(spend.amount) filter (where spend.created_at >= ${day}), 0) as system_day,
      coalesce(sum(spend.amount) filter (where spend.created_at >= ${month}), 0) as system_month
    from (
      select user_id, session_id, created_at, coalesce(amount_micros, estimated_micros) as amount
      from quota.provider_cost
      where currency = ${currency} and (created_at >= ${month} or session_id = ${sessionId})
      union all
      select user_id, session_id, created_at, maximum_micros as amount
      from quota.cost_hold
      where currency = ${currency} and closed_at is null
    ) as spend
  `.execute(tx);
  // An aggregate without grouping always answers one row.
  const row = rows[0] ?? { unknown: 0, session: 0, user_month: 0, system_day: 0, system_month: 0 };
  if (Number(row.unknown) > 0) throw errors.quotaInsufficient({ reason: "provider_cost_unknown" });
  return {
    session: Number(row.session),
    userMonth: Number(row.user_month),
    systemDay: Number(row.system_day),
    systemMonth: Number(row.system_month),
  };
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
  const totals = await spendTotals(tx, ctx, input.sessionId, policy.currency, now);
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
  /**
   * `"hold_maximum"` records the hold's own maximum: the conservative cost of an attempt whose
   * outcome is unknown, so its hold closes without understating what the provider may charge.
   */
  estimatedMicros: number | null | "hold_maximum";
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
    if (value !== null && value !== "hold_maximum") micros.parse(value);
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
  const estimatedMicros =
    input.estimatedMicros === "hold_maximum" ? Number(hold.maximum_micros) : input.estimatedMicros;
  if (hold.closed_at) {
    // P9-05: an unknown outcome closes its hold once; a hold already closed stays as recorded.
    if (input.estimatedMicros === "hold_maximum") return;
    const prior = await tx
      .selectFrom("quota.provider_cost")
      .selectAll()
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    // P9-05: a reclaimed worker settling the same attempt after a later job closed its hold at
    // the maximum keeps that conservative record, so its paid response is not lost.
    if (
      prior &&
      input.attemptId !== undefined &&
      prior.attempt_id === input.attemptId &&
      prior.amount_micros === null &&
      prior.estimated_micros !== null &&
      Number(prior.estimated_micros) === Number(hold.maximum_micros) &&
      canonicalJson(prior.usage) === canonicalJson({})
    )
      return;
    if (
      !prior ||
      prior.provider !== input.provider ||
      prior.model !== input.model ||
      (prior.amount_micros === null ? null : Number(prior.amount_micros)) !== input.actualMicros ||
      (prior.estimated_micros === null ? null : Number(prior.estimated_micros)) !==
        estimatedMicros ||
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
      estimated_micros: estimatedMicros,
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
