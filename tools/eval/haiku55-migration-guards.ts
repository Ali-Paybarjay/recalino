import assert from "node:assert/strict";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { z } from "../../packages/core/node_modules/zod";
import type { ProviderSettings } from "../../packages/core/src/aip";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";

export const migrationControls = {
  version: "haiku55-production-migration-evaluation-4",
  maximumGenerationsPerCase: 2,
  maximumPaidResponses: 28,
  maximumHttpRequests: 56,
  softUsd: 0.5,
  hardUsd: 0.75,
  // Every migration QA round, probe and diagnostic together, including all earlier spend: the
  // owner approved 5 USD in total for all QA.
  cumulativeHardUsd: 5.0,
  // A comparison round runs every case for decision data; it never stops on a first-pass gate.
  comparison: { maximumPaidResponses: 44, maximumHttpRequests: 88, hardUsd: 1.6 },
  // One gated holdout for one allow-listed candidate: fourteen cases plus the two regenerations
  // the first-pass gate permits. The soft budget pauses only before another case starts.
  candidateAcceptance: {
    maximumPaidResponses: 16,
    maximumHttpRequests: 32,
    softUsd: 0.9,
    hardUsd: 1.2,
  },
  // A named subset of the comparison set that checks a transport before a full round.
  smoke: { maximumPaidResponses: 5, maximumHttpRequests: 5, hardUsd: 0.6 },
  // One tiny request that shows whether a strict json_schema grammar is enforced at all.
  enforcementProbe: { maximumPaidResponses: 1, maximumHttpRequests: 1, hardUsd: 0.05 },
  responseBytes: 1048576,
  // Captured regional endpoints can cost 10% more than the main model catalog.
  catalogMaximumRateMultiplier: 1.1,
  adoptionGates: {
    finalLocalPasses: "14/14",
    firstGenerationPasses: ">=13/14",
    expectedTransport: "declared direct json_object or strict json_schema",
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

export type MigrationDispatchMode =
  | "adoption"
  | "comparison"
  | "candidate-acceptance"
  | "smoke"
  | "enforcement-probe";
const dispatchBounds: Record<
  MigrationDispatchMode,
  { maximumPaidResponses: number; maximumHttpRequests: number; hardUsd: number }
> = {
  adoption: migrationControls,
  comparison: migrationControls.comparison,
  "candidate-acceptance": migrationControls.candidateAcceptance,
  smoke: migrationControls.smoke,
  "enforcement-probe": migrationControls.enforcementProbe,
};

/** A started dispatch is never repeated after a crash, even if no receipt was saved. */
export function assertMigrationDispatchAllowed(
  requests: MigrationRequest[],
  costUsd: number,
  reserveUsd: number,
  generationsInCase: number,
  limits?: { maximumPaidResponses: number; maximumHttpRequests: number },
  mode: MigrationDispatchMode = "adoption",
) {
  const bounds = dispatchBounds[mode];
  const maximumPaidResponses = limits?.maximumPaidResponses ?? bounds.maximumPaidResponses;
  const maximumHttpRequests = limits?.maximumHttpRequests ?? bounds.maximumHttpRequests;
  if (
    !Number.isInteger(maximumPaidResponses) ||
    maximumPaidResponses < 1 ||
    maximumPaidResponses > bounds.maximumPaidResponses ||
    !Number.isInteger(maximumHttpRequests) ||
    maximumHttpRequests < 1 ||
    maximumHttpRequests > bounds.maximumHttpRequests
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
  if (costUsd + reserveUsd > bounds.hardUsd) throw new Error("hard_budget_before_dispatch");
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

/**
 * The soft budget pauses a gated round before it starts another case; a round whose final case
 * has finished is complete, never stopped. Comparison and smoke rounds have only a hard budget.
 */
export function migrationSoftBudgetStop(
  spentUsd: number,
  mode: MigrationDispatchMode,
  completedCases: number,
  scheduledCases: number,
): boolean {
  const softUsd =
    mode === "adoption"
      ? migrationControls.softUsd
      : mode === "candidate-acceptance"
        ? migrationControls.candidateAcceptance.softUsd
        : undefined;
  return softUsd !== undefined && completedCases < scheduledCases && spentUsd >= softUsd;
}

/** The configured model or its dated snapshot slug; sibling variants (-lite, -tts) never match. */
export function migrationReportedModelMatches(
  reported: string | undefined,
  configured: string,
): boolean {
  if (reported === undefined) return false;
  const escaped = configured.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return reported === configured || new RegExp(`^${escaped}-\\d{8}$`).test(reported);
}

/**
 * A round dispatches only the transport its settings declare. The single `:json` fallback after
 * a provider grammar rejection is never the declared transport, even in json_schema mode.
 */
export function migrationUnexpectedTransport(
  declared: string | undefined,
  responseFormat: string,
  operationKey: string,
): boolean {
  return responseFormat !== declared || operationKey.endsWith(":json");
}

/**
 * The adoption transport is the one the round declares: direct json_object, or strict
 * json_schema whose grammar adds to the same server validation. Any fallback still fails the
 * gate through unexpectedTransportFallbacks.
 */
export function migrationTransportMatchesAdoptionGate(round: {
  directJsonMode: boolean;
  structuredOutputMode: string | undefined;
}): boolean {
  return round.directJsonMode
    ? round.structuredOutputMode === "json_object"
    : round.structuredOutputMode === "json_schema";
}

const dispatchBodySchema = z
  .object({
    model: z.string(),
    max_tokens: z.number().int().positive(),
    provider: z.unknown(),
    response_format: z.object({ type: z.string() }),
    messages: z.array(z.unknown()),
  })
  .passthrough();

/**
 * Everything a round checks before it pays for a request: the exact candidate route (model, ZDR
 * policy, sampling, physical caps, reasoning) and the declared transport. A request on another
 * transport, including the `:json` fallback after a grammar rejection, is reported before any
 * reserve; the caller stops the round without dispatching it.
 */
export function migrationDispatchPreflight(input: {
  url: string;
  serialized: string;
  operationKey: string;
  settings: ProviderSettings;
  structuredOutputMode: string | undefined;
  /** Candidate rounds reserve at the most expensive ZDR endpoint price, never a list price. */
  candidateRates?: { promptRate: number; outputRate: number };
  catalog: unknown;
}) {
  const { settings, serialized } = input;
  assert.equal(input.url, "https://openrouter.ai/api/v1/chat/completions");
  const body = dispatchBodySchema.parse(JSON.parse(serialized));
  assert.equal(body.model, settings.llmModel);
  assert.deepEqual(body.provider, {
    zdr: true,
    data_collection: "deny",
    require_parameters: true,
  });
  const overrides = settings.structuredModelOverrides?.[settings.llmModel];
  const expectsTemperature =
    settings.structuredTemperature !== undefined &&
    !overrides?.omitTemperature &&
    overrides?.reasoningEffort === undefined;
  assert.ok(
    !["top_p", "top_k"].some((name) => Object.hasOwn(body, name)) &&
      (expectsTemperature
        ? body.temperature === settings.structuredTemperature
        : !Object.hasOwn(body, "temperature")),
    "Sampling must match the candidate exactly",
  );
  assert.equal(
    body.max_tokens,
    overrides?.maxOutputTokens ?? settings.maxOutputTokens,
    "Physical token cap must come from the real production adapter",
  );
  assert.deepEqual(
    body.reasoning,
    overrides?.reasoningEffort ? { effort: overrides.reasoningEffort } : undefined,
  );
  if (
    migrationUnexpectedTransport(
      input.structuredOutputMode,
      body.response_format.type,
      input.operationKey,
    )
  )
    return { unexpectedTransport: true as const };
  const bytes = Buffer.byteLength(serialized, "utf8");
  assert.ok(
    overrides?.maxRequestBytes && bytes <= overrides.maxRequestBytes,
    "Physical request bytes must fit the actual production cap",
  );
  const reserve = input.candidateRates
    ? {
        reserveUsd:
          bytes * input.candidateRates.promptRate +
          body.max_tokens * input.candidateRates.outputRate,
        inputTokenCeiling: bytes,
        promptRate: input.candidateRates.promptRate,
        outputRate: input.candidateRates.outputRate,
      }
    : migrationRequestReserve(input.catalog, body.model, serialized, body.max_tokens);
  return { unexpectedTransport: false as const, body, overrides, reserve };
}

/** Transport failures close every round; a schema grammar never needs JSON closer completion. */
export function migrationTransportGateFailure(
  results: Record<string, unknown>[],
  structuredOutputMode: string | undefined,
): string | undefined {
  if (results.some((result) => result.unexpectedTransportFallback))
    return "unexpected_transport_gate_failed";
  if (
    structuredOutputMode === "json_schema" &&
    results.some(
      (result) =>
        typeof result.jsonClosersCompleted === "number" && result.jsonClosersCompleted > 0,
    )
  )
    return "schema_mode_json_closers_gate_failed";
  return undefined;
}

/** Gated rounds add the unchanged first-pass and final-validity gates to the transport gates. */
export function migrationBoundaryGateFailure(
  results: Record<string, unknown>[],
  round: { structuredOutputMode: string | undefined; firstPassGateStopsRound: boolean },
): string | undefined {
  return (
    migrationTransportGateFailure(results, round.structuredOutputMode) ??
    (round.firstPassGateStopsRound ? migrationAutomaticGateFailure(results) : undefined)
  );
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

/**
 * A captured dry-run plan must still hash to its own freeze, so nothing it records (fixture set,
 * candidate, transport, date) can be edited after approval.
 */
export function assertMigrationPlanFrozen(planFile: unknown) {
  const plan = z.record(z.string(), z.unknown()).parse(planFile);
  const { freeze } = z.object({ freeze: z.string().regex(/^[a-f0-9]{64}$/) }).parse(plan);
  const frozen = Object.fromEntries(
    Object.entries(plan).filter(([name]) => name !== "freeze" && name !== "paidCalls"),
  );
  if (sha256Hex(canonicalJson(frozen)) !== freeze)
    throw new Error("The captured plan differs from its freeze");
  return { ...plan, freeze };
}

/**
 * The plan binds the run date. A new round takes today's UTC date; a resumed live round keeps the
 * date it was frozen with, so resuming on a later day never changes its freeze.
 */
export function migrationPlanDate(
  priorState: unknown,
  recordedPlan: unknown,
  today: string,
): string {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  if (priorState === undefined) return date.parse(today);
  if (recordedPlan === undefined) throw new Error("resumed_round_plan_missing");
  return z.object({ date }).parse(recordedPlan).date;
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

/**
 * A smoke round names a few comparison lessons and keeps each case's original identity. Every
 * named case can finish its one regeneration within the smoke response limit.
 */
export function selectMigrationSmokeCases<T extends { caseId: string; fixture: { id: string } }>(
  original: T[],
  requestedIds: string | undefined,
): { smoke: boolean; schedule: T[] } {
  if (requestedIds === undefined) return { smoke: false, schedule: original };
  const ids = requestedIds.split(",");
  if (ids.some((id) => !/^[A-Za-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length)
    throw new Error("smoke_case_ids_invalid");
  const schedule = original.filter((entry) => ids.includes(entry.fixture.id));
  if (schedule.length !== ids.length) throw new Error("smoke_case_ids_unknown");
  if (
    schedule.length * migrationControls.maximumGenerationsPerCase >
    migrationControls.smoke.maximumPaidResponses
  )
    throw new Error("smoke_case_count_exceeds_limits");
  return { smoke: true, schedule };
}

export const migrationRoundStateSchema = z.strictObject({
  freeze: z.string(),
  spentUsd: z.number().nonnegative(),
  stopped: z.boolean(),
  stopReason: z.string().optional(),
  requests: z.array(migrationRequestSchema),
  results: z.array(z.record(z.string(), z.unknown())),
});

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
      // Reserve of this round's dispatch in progress; parallel rounds count it before dispatch.
      inFlightUsd: z.number().nonnegative().optional(),
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
    ledger.priorUnledgeredUsd +
    ledger.rounds.reduce((total, round) => total + round.spentUsd + (round.inFlightUsd ?? 0), 0);
  if (!Number.isFinite(spent) || spent + reserveUsd > migrationControls.cumulativeHardUsd)
    throw new Error("cumulative_budget_before_dispatch");
}

/**
 * Live dispatch needs the shared ledger that already holds every earlier QA round; it is ignored by
 * git and lives in one worktree. A missing file would silently restart the cumulative cap, so only
 * an explicit initialisation may create one, and only where none exists yet.
 */
export async function assertMigrationLedgerAvailable(path: string, initialize: boolean) {
  const recorded = await readMigrationRecordedJson(path);
  if (recorded === undefined && !initialize) throw new Error("ledger_missing_pass_shared_ledger");
  if (recorded !== undefined && initialize) throw new Error("ledger_exists_drop_initialize_flag");
  if (recorded !== undefined) migrationLedgerSchema.parse(recorded);
}

/**
 * Serialises every ledger read-modify-write across concurrent rounds with an exclusive lock
 * directory, so parallel rounds can neither lose spend nor jointly exceed the cumulative cap.
 */
export async function withMigrationLedger<T>(
  path: string,
  update: (ledger: MigrationLedger) => T,
): Promise<T> {
  const lock = `${path}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
        throw error;
      if (attempt >= 600) throw new Error("ledger_lock_timeout");
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  try {
    const ledger = migrationLedgerSchema.parse(
      (await readMigrationRecordedJson(path)) ?? {
        version: 1,
        priorUnledgeredUsd: migrationUnledgeredPriorUsd,
        rounds: [],
      },
    );
    const result = update(ledger);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(ledger, null, 2));
    await rename(temporary, path);
    return result;
  } finally {
    await rmdir(lock);
  }
}
