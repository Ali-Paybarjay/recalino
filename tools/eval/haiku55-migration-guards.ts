import { readFile } from "node:fs/promises";
import { z } from "../../packages/core/node_modules/zod";

export const migrationControls = {
  version: "haiku55-production-migration-evaluation-3",
  maximumGenerationsPerCase: 2,
  maximumPaidResponses: 28,
  maximumHttpRequests: 56,
  softUsd: 0.5,
  hardUsd: 0.75,
  // Every migration QA round together, including the 0.1648530 USD spent before the ledger.
  cumulativeHardUsd: 0.5,
  responseBytes: 1048576,
  // Captured regional endpoints can cost 10% more than the main model catalog.
  catalogMaximumRateMultiplier: 1.1,
  adoptionGates: {
    finalLocalPasses: "14/14",
    firstGenerationPasses: ">=13/14",
    expectedTransport: "direct json_object",
    nativeSchemaAcceptanceClaimed: false,
    unexpectedTransportFallbacks: 0,
    criticalTeachingGroundingAttributionInjectionErrors: 0,
    allRequiredConceptsAdequatelyTaught: true,
    minimumMeanQualityEachCase: 3,
    qualityScale: "0-4: correctness, grounding, coverage, learner fit, clarity/card usability",
  },
} as const;
export const migrationRequestSchema = z.strictObject({
  id: z.string(),
  caseId: z.string(),
  stage: z.string(),
  state: z.enum(["started", "completed", "known_rejection", "uncertain"]),
  reserveUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type MigrationRequest = z.infer<typeof migrationRequestSchema>;

/** A started dispatch is never repeated after a crash, even if no receipt was saved. */
export function assertMigrationDispatchAllowed(
  requests: MigrationRequest[],
  costUsd: number,
  reserveUsd: number,
  generationsInCase: number,
  limits?: { maximumPaidResponses: number; maximumHttpRequests: number },
) {
  const maximumPaidResponses =
    limits?.maximumPaidResponses ?? migrationControls.maximumPaidResponses;
  const maximumHttpRequests = limits?.maximumHttpRequests ?? migrationControls.maximumHttpRequests;
  if (
    !Number.isInteger(maximumPaidResponses) ||
    maximumPaidResponses < 1 ||
    maximumPaidResponses > migrationControls.maximumPaidResponses ||
    !Number.isInteger(maximumHttpRequests) ||
    maximumHttpRequests < 1 ||
    maximumHttpRequests > migrationControls.maximumHttpRequests
  )
    throw new Error("invalid_dispatch_limits");
  if (requests.some((entry) => entry.state === "started" || entry.state === "uncertain"))
    throw new Error("unresolved_dispatch_do_not_retry");
  if (requests.length >= maximumHttpRequests) throw new Error("http_request_limit");
  if (requests.filter((entry) => entry.state === "completed").length >= maximumPaidResponses)
    throw new Error("paid_response_limit");
  if (generationsInCase > migrationControls.maximumGenerationsPerCase)
    throw new Error("case_generation_limit");
  if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(reserveUsd) || reserveUsd <= 0)
    throw new Error("invalid_cost_reservation");
  if (costUsd + reserveUsd > migrationControls.hardUsd)
    throw new Error("hard_budget_before_dispatch");
}

const catalogModelSchema = z.object({
  id: z.string(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    overrides: z
      .array(z.object({ prompt: z.string().optional(), completion: z.string().optional() }))
      .optional(),
  }),
});

/** UTF-8 request bytes bound input tokens conservatively; use the greatest advertised rate. */
export function migrationRequestReserve(
  catalog: unknown,
  model: string,
  body: string,
  maxOutputTokens: number,
) {
  const raw = z.object({ data: z.array(catalogModelSchema) }).parse(catalog);
  const entry = raw.data.find((value) => value.id === model);
  if (!entry) throw new Error("candidate_model_missing_from_catalog");
  const promptRate =
    migrationControls.catalogMaximumRateMultiplier *
    Math.max(
      ...[
        entry.pricing.prompt,
        ...(entry.pricing.overrides ?? []).map((value) => value.prompt ?? entry.pricing.prompt),
      ].map(Number),
    );
  const outputRate =
    migrationControls.catalogMaximumRateMultiplier *
    Math.max(
      ...[
        entry.pricing.completion,
        ...(entry.pricing.overrides ?? []).map(
          (value) => value.completion ?? entry.pricing.completion,
        ),
      ].map(Number),
    );
  if (![promptRate, outputRate].every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("invalid_catalog_price");
  return {
    reserveUsd: Buffer.byteLength(body, "utf8") * promptRate + maxOutputTokens * outputRate,
    inputTokenCeiling: Buffer.byteLength(body, "utf8"),
    promptRate,
    outputRate,
  };
}

/** Evaluation control stops carry no claim that a paid request became uncertain. */
export class MigrationControlInterruption extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Close an ineligible case boundary before another case can start dispatching. */
export function migrationAutomaticGateFailure(
  results: Record<string, unknown>[],
): string | undefined {
  if (results.some((result) => result.unexpectedTransportFallback))
    return "unexpected_transport_gate_failed";
  if (results.some((result) => result.finalLocalPass === false))
    return "final_local_validity_gate_failed";
  if (results.filter((result) => result.firstGenerationPass === false).length > 1)
    return "first_generation_gate_unreachable";
  return undefined;
}

/** A local control interruption never disguises an unresolved real dispatch. */
export function migrationControlInterruptionResult(
  code: string | undefined,
  requests: MigrationRequest[],
): Record<string, unknown> | undefined {
  if (
    !code ||
    requests.some((request) => request.state === "started" || request.state === "uncertain")
  )
    return undefined;
  return {
    finalValidationStatus: "control_interrupted",
    firstGenerationPass: false,
    controlInterruption: code,
    providerAccountingUncertain: false,
  };
}

export type MigrationRecoveryPlan = {
  stage: "compact" | "schema-repair";
  marker: "knowledge:truncated" | "knowledge:schema-invalid";
  compact: boolean;
  repairReason?: "provider_schema_invalid";
};

/** Only a known paid first output can authorize the single recovery generation. */
export function migrationInitialRecovery(error: {
  code: string;
  uncertain: boolean;
  accounted: boolean;
}): MigrationRecoveryPlan | undefined {
  if (error.uncertain || !error.accounted) return undefined;
  if (error.code === "provider_output_truncated")
    return { stage: "compact", marker: "knowledge:truncated", compact: true };
  if (error.code === "provider_schema_invalid")
    return {
      stage: "schema-repair",
      marker: "knowledge:schema-invalid",
      compact: false,
      repairReason: "provider_schema_invalid",
    };
  return undefined;
}

/** Missing state is safe; unreadable or corrupt recorded state must never reset paid history. */
export async function readMigrationRecordedJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/** Diagnostics may finish only the two remaining cases, retaining original fourteen-case identities. */
export function selectMigrationDiagnosticCases<
  T extends { caseId: string; fixture: { id: string } },
>(original: T[], requestedIds: string | undefined): { diagnosticOnly: boolean; schedule: T[] } {
  if (requestedIds === undefined) return { diagnosticOnly: false, schedule: original };
  if (requestedIds !== "M03,M04") throw new Error("diagnostic_scope_must_be_M03_M04");
  const schedule = original.filter(
    (entry) => entry.fixture.id === "M03" || entry.fixture.id === "M04",
  );
  if (schedule.length !== 2 || schedule[0]?.caseId !== "M03-13" || schedule[1]?.caseId !== "M04-14")
    throw new Error("diagnostic_original_ordinals_required");
  return { diagnosticOnly: true, schedule };
}

/** Spend that predates the cross-round ledger: every earlier migration round and diagnostic. */
export const migrationUnledgeredPriorUsd = 0.164853;
export const migrationLedgerSchema = z.strictObject({
  version: z.literal(1),
  priorUnledgeredUsd: z.number().nonnegative(),
  rounds: z.array(
    z.strictObject({
      freeze: z.string().regex(/^[a-f0-9]{64}$/),
      directory: z.string().min(1),
      fixtureSet: z.string().min(1),
      spentUsd: z.number().nonnegative(),
      status: z.enum(["running", "stopped", "completed"]),
    }),
  ),
});
export type MigrationLedger = z.infer<typeof migrationLedgerSchema>;

/**
 * One frozen candidate gets one live round. A fresh output directory can neither repeat an
 * evaluated freeze nor reset the cumulative migration budget.
 */
export function migrationLedgerRound(
  ledger: MigrationLedger,
  freeze: string,
  directory: string,
  fixtureSet: string,
): MigrationLedger["rounds"][number] {
  const existing = ledger.rounds.find((round) => round.freeze === freeze);
  if (existing && existing.directory !== directory)
    throw new Error("freeze_already_evaluated_in_another_directory");
  if (existing && existing.fixtureSet !== fixtureSet) throw new Error("fixture_set_changed");
  if (!existing && ledger.rounds.some((round) => round.directory === directory))
    throw new Error("directory_belongs_to_another_freeze");
  if (existing) return existing;
  const round = { freeze, directory, fixtureSet, spentUsd: 0, status: "running" as const };
  ledger.rounds.push(round);
  return round;
}

export function assertMigrationCumulativeBudget(ledger: MigrationLedger, reserveUsd: number) {
  const spent =
    ledger.priorUnledgeredUsd + ledger.rounds.reduce((total, round) => total + round.spentUsd, 0);
  if (!Number.isFinite(spent) || spent + reserveUsd > migrationControls.cumulativeHardUsd)
    throw new Error("cumulative_budget_before_dispatch");
}
