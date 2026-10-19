import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, recordAudit } from "../plt";
import type { ProviderResult } from "./contracts";

export const estimateRateSchema = z.strictObject({
  id: z.string().min(1).max(200),
  stage: z.enum(["generation", "vision", "transcription", "tts", "support"]),
  model: z.string().trim().min(1).max(200),
  unit: z.enum([
    "input_million_tokens",
    "output_million_tokens",
    "audio_minute",
    "page",
    "tts_thousand_characters",
  ]),
  rateMicros: z.number().int().nonnegative().safe(),
});
export type EstimateRate = z.infer<typeof estimateRateSchema>;
export const estimateRatesSchema = z
  .array(estimateRateSchema)
  .max(100)
  .superRefine((rates, ctx) => {
    const keys = new Set<string>();
    const units = new Map<string, Set<string>>();
    for (const [i, rate] of rates.entries()) {
      const key = `${rate.stage}:${rate.model}:${rate.unit}`;
      if (keys.has(key)) ctx.addIssue({ code: "custom", path: [i], message: "duplicate_rate" });
      keys.add(key);
      const groupKey = `${rate.stage}:${rate.model}`;
      const group = units.get(groupKey) ?? new Set<string>();
      group.add(rate.unit);
      units.set(groupKey, group);
      if (group.size > 1 && [...group].some((unit) => !unit.endsWith("million_tokens")))
        ctx.addIssue({ code: "custom", path: [i, "unit"], message: "ambiguous_billing_units" });
    }
  });
export async function readEstimateRates(
  db: Database | Tx,
): Promise<{ version: string; rates: EstimateRate[] } | null> {
  const { rows } = await sql<{
    version: string;
    rates: unknown;
  }>`select version,rates from aip.estimate_rate_revision order by created_at desc,version desc limit 1`.execute(
    db,
  );
  return rows[0]
    ? { version: rows[0].version, rates: estimateRatesSchema.parse(rows[0].rates) }
    : null;
}
export async function saveEstimateRates(
  db: Database,
  input: { rates: EstimateRate[]; operationKey: string; actorId: string; reason: string },
) {
  const rates = estimateRatesSchema.parse(input.rates);
  z.uuid().parse(input.actorId);
  z.string().min(8).max(128).parse(input.operationKey);
  z.string().trim().min(1).max(500).parse(input.reason);
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext('aip.estimate_rates'))`.execute(tx);
    const previous = await sql<{
      version: string;
      rates: unknown;
    }>`select version,rates from aip.estimate_rate_revision where operation_key=${input.operationKey}`.execute(
      tx,
    );
    if (previous.rows[0]) {
      if (canonicalJson(previous.rows[0].rates) !== canonicalJson(rates))
        throw errors.idempotencyMismatch();
      return { version: previous.rows[0].version, rates };
    }
    const version = `admin-${input.operationKey}`;
    await sql`insert into aip.estimate_rate_revision(version,rates,actor_id,reason,operation_key) values(${version},${JSON.stringify(rates)}::jsonb,${input.actorId}::uuid,${input.reason},${input.operationKey})`.execute(
      tx,
    );
    await recordAudit(tx, {
      actorKind: "operator",
      actorId: input.actorId,
      action: "aip.estimate_rates",
      subjectType: "estimate_rates",
      subjectId: version,
      reason: input.reason,
      requestId: input.operationKey,
    });
    return { version, rates };
  });
}
/** A forecast, never a spending authorization or a replacement for actual charges. */
export function estimatedUsageCost(
  rates: readonly EstimateRate[],
  model: string,
  usage: ProviderResult<unknown>["usage"],
  stage: EstimateRate["stage"],
): number | null {
  let total = 0,
    found = false;
  const matched = rates.filter((rate) => rate.model === model && rate.stage === stage);
  const tokenRates = matched.filter((rate) => rate.unit.endsWith("million_tokens"));
  const applicable = tokenRates.length ? tokenRates : matched;
  for (const rate of applicable) {
    const count =
      rate.unit === "input_million_tokens"
        ? usage.inputTokens
        : rate.unit === "output_million_tokens"
          ? usage.outputTokens
          : rate.unit === "audio_minute"
            ? usage.audioSeconds
            : rate.unit === "page"
              ? usage.pages
              : usage.characters;
    if (count === undefined) continue;
    const divisor = rate.unit.endsWith("million_tokens")
      ? 1_000_000
      : rate.unit === "audio_minute"
        ? 60
        : rate.unit === "tts_thousand_characters"
          ? 1_000
          : 1;
    total += (count / divisor) * rate.rateMicros;
    found = true;
  }
  const rounded = Math.ceil(total);
  if (!Number.isSafeInteger(rounded))
    throw errors.validationFailed({ rates: ["estimate_overflow"] });
  return found ? rounded : null;
}
