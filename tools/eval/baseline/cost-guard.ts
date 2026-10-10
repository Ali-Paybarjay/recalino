import { randomUUID } from "node:crypto";
import { z } from "../../../packages/core/node_modules/zod";
import { providerHttpErrorCode } from "../../../packages/core/src/aip/provider-http-error";
import {
  assertMigrationCumulativeBudget,
  type MigrationLedger,
  type MigrationRequest,
  type MigrationRoundState,
  migrationCumulativeHardUsd,
} from "./ledger";

/** The holdout-5 schedule: 12 lessons, then the repeats of S03 and S10. */
const scheduledCases = 14;
/**
 * Job invocations per case; the worker checkpoints after each paid stage. On the content
 * contract a run has at most two generation dispatches (knowledge, then knowledge:compact or
 * knowledge:repair) and one knowledge:study-repair; each step gets at most plt jobs.maxAttempts
 * (5) invocations through the job's 429 retries.
 */
const maximumJobStepsPerCase = 20;
/**
 * One job invocation dispatches at most one structured call, and a structured call is at most two
 * HTTP requests: the strict json_schema request and, after a recognized grammar rejection, its one
 * json_object fallback (`${operationKey}:json`, aip/openrouter.ts).
 */
const maximumHttpRequestsPerJobStep = 2;

/** Fixed controls of this evaluation-only round; they are part of the frozen plan. */
export const baselineControls = {
  version: "release-candidate-e2e-1",
  /** Round spend plus in-flight reserves plus the next reserve may never exceed this. */
  roundHardUsd: 0.9,
  /** Every evaluation round recorded in the shared ledger, including this one. */
  cumulativeHardUsd: migrationCumulativeHardUsd,
  /**
   * A runaway net, never the spend bound: the two USD caps bound spend. The worker's bounded
   * knowledge steps alone can need 6 requests per case (3 structured calls x 2), 84 for the
   * round, before any 429 retry, so this limit sits at the per-case job step bound
   * (14 x 20 x 2 = 560) and binds only if a dispatch escapes it.
   */
  maximumHttpRequests: scheduledCases * maximumJobStepsPerCase * maximumHttpRequestsPerJobStep,
  responseBytes: 1048576,
  maximumJobStepsPerCase,
  /** The worker's own retry policy may schedule a later attempt; wait at most this long. */
  maximumRetryWaitMs: 900000,
} as const;
export type BaselineControls = typeof baselineControls;

/** A dispatch this tool refused before sending it; nothing reached the provider. */
export class DispatchRefused extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DispatchRefused";
  }
}

export const openRouterChatUrl = "https://openrouter.ai/api/v1/chat/completions";

type EndpointPricing = {
  prompt?: string;
  completion?: string;
  internal_reasoning?: string;
  overrides?: { prompt?: string; completion?: string; internal_reasoning?: string }[];
};
const rates = (values: (string | undefined)[]) =>
  values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);

/**
 * Copied verbatim from tools/eval/model-comparison-candidates.ts of codex/haiku55-migration
 * (commit cde604b). Highest price among the model's zero-retention endpoints, including
 * long-context overrides and internal reasoning, so a reserve never undercounts. With a model
 * catalog, the output maximum must reach at least the catalog completion price.
 */
export function zdrEndpointMaximumRates(zdrEndpoints: unknown, model: string, catalog?: unknown) {
  // The public list is { data: [...] }; accept a bare array as well.
  const list =
    zdrEndpoints && typeof zdrEndpoints === "object" && "data" in zdrEndpoints
      ? (zdrEndpoints as { data: unknown }).data
      : zdrEndpoints;
  const entries = (Array.isArray(list) ? list : []) as {
    model_id?: string;
    pricing?: EndpointPricing;
  }[];
  const prices = entries
    .filter((entry) => entry.model_id === model)
    .map(({ pricing }) => ({
      prompt: Number(pricing?.prompt),
      completion: Number(pricing?.completion),
      promptRates: rates([
        pricing?.prompt,
        ...(pricing?.overrides ?? []).map((override) => override.prompt),
      ]),
      outputRates: rates([
        pricing?.completion,
        pricing?.internal_reasoning,
        ...(pricing?.overrides ?? []).flatMap((override) => [
          override.completion,
          override.internal_reasoning,
        ]),
      ]),
    }))
    .filter((entry) => Number.isFinite(entry.prompt) && Number.isFinite(entry.completion));
  if (!prices.length) throw new Error("candidate_has_no_zdr_endpoint");
  const maximum = {
    promptRate: Math.max(...prices.flatMap((entry) => entry.promptRates)),
    outputRate: Math.max(...prices.flatMap((entry) => entry.outputRates)),
  };
  if (catalog !== undefined) {
    const data =
      catalog && typeof catalog === "object" && "data" in catalog
        ? (catalog as { data: unknown }).data
        : undefined;
    const listed = (Array.isArray(data) ? data : []).find(
      (entry: { id?: string }) => entry?.id === model,
    ) as { pricing?: { completion?: string } } | undefined;
    if (!listed) throw new Error("candidate_model_missing_from_catalog");
    const completion = Number(listed.pricing?.completion);
    if (!Number.isFinite(completion) || maximum.outputRate < completion)
      throw new Error("zdr_output_rate_below_catalog_completion_rate");
  }
  return maximum;
}

const dispatchBodySchema = z
  .object({
    model: z.string().min(1),
    max_tokens: z.number().int().positive(),
    // Production always routes to zero-retention endpoints; anything else is never paid for.
    provider: z.object({ zdr: z.literal(true), data_collection: z.literal("deny") }).passthrough(),
    messages: z.array(z.unknown()).min(1),
  })
  .passthrough();
export type DispatchBody = z.infer<typeof dispatchBodySchema>;

/**
 * reserve = request body bytes x highest ZDR prompt rate + output tokens x highest ZDR
 * completion/internal-reasoning rate of the request's own model. UTF-8 bytes bound input tokens.
 * With `models` (each configured model and its configured output-token cap), a request for any
 * other model is refused and the output tokens are the larger of the body's max_tokens and that
 * cap, so a Gemini knowledge request always reserves its full 32000 tokens.
 */
export function dispatchReserve(input: {
  url: string;
  serialized: string;
  zdrEndpoints: unknown;
  models?: Readonly<Record<string, number>>;
}) {
  if (input.url !== openRouterChatUrl) throw new DispatchRefused("dispatch_url_not_allowed");
  let raw: unknown;
  try {
    raw = JSON.parse(input.serialized);
  } catch {
    throw new DispatchRefused("dispatch_body_invalid");
  }
  const parsed = dispatchBodySchema.safeParse(raw);
  if (!parsed.success) throw new DispatchRefused("dispatch_body_invalid");
  const body = parsed.data;
  const configured = input.models ? input.models[body.model] : undefined;
  if (input.models && !(Number.isSafeInteger(configured) && (configured ?? 0) > 0))
    throw new DispatchRefused("dispatch_model_not_configured");
  const reserveOutputTokens = Math.max(body.max_tokens, configured ?? 0);
  let maximum: { promptRate: number; outputRate: number };
  try {
    maximum = zdrEndpointMaximumRates(input.zdrEndpoints, body.model);
  } catch {
    throw new DispatchRefused("dispatch_model_has_no_zdr_endpoint");
  }
  const requestBytes = Buffer.byteLength(input.serialized, "utf8");
  const reserveUsd = requestBytes * maximum.promptRate + reserveOutputTokens * maximum.outputRate;
  if (!Number.isFinite(reserveUsd) || reserveUsd <= 0)
    throw new DispatchRefused("invalid_cost_reservation");
  return {
    body,
    model: body.model,
    maxOutputTokens: body.max_tokens,
    reserveOutputTokens,
    requestBytes,
    promptRate: maximum.promptRate,
    outputRate: maximum.outputRate,
    reserveUsd,
  };
}
export type DispatchReserve = ReturnType<typeof dispatchReserve>;

/** Reserves of this round's dispatches whose outcome is not yet recorded. */
export function roundInFlightUsd(requests: readonly MigrationRequest[]): number {
  return requests
    .filter((request) => request.state === "started")
    .reduce((total, request) => total + request.reserveUsd, 0);
}

/** Round spend + in-flight + this reserve must stay within the round cap. */
export function assertRoundDispatchAllowed(
  state: Pick<MigrationRoundState, "spentUsd" | "requests">,
  reserveUsd: number,
  limits: Pick<BaselineControls, "roundHardUsd" | "maximumHttpRequests"> = baselineControls,
) {
  if (
    !Number.isFinite(state.spentUsd) ||
    state.spentUsd < 0 ||
    !Number.isFinite(reserveUsd) ||
    reserveUsd <= 0
  )
    throw new DispatchRefused("invalid_cost_reservation");
  if (state.requests.length >= limits.maximumHttpRequests)
    throw new DispatchRefused("http_request_limit");
  if (state.spentUsd + roundInFlightUsd(state.requests) + reserveUsd > limits.roundHardUsd)
    throw new DispatchRefused("round_budget_before_dispatch");
}

/** The shared ledger's cumulative spend (all rounds, in-flight included) + this reserve <= 5 USD. */
export function assertLedgerDispatchAllowed(ledger: MigrationLedger, reserveUsd: number) {
  try {
    assertMigrationCumulativeBudget(ledger, reserveUsd);
  } catch {
    throw new DispatchRefused("cumulative_budget_before_dispatch");
  }
}

/** The worker's operation key is `${runId}:${step}:${attempt}`, plus `:json` for the fallback. */
export function operationStage(operationKey: string): string {
  const match = /^[0-9a-f-]{36}:(.+):(\d+)(:json)?$/.exec(operationKey);
  return match ? `${match[1]}${match[3] ?? ""}` : "unknown";
}

async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("response_size_limit");
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const usageSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    choices: z
      .array(z.object({ finish_reason: z.string().nullable().optional() }).passthrough())
      .optional(),
    usage: z
      .object({
        cost: z.number().optional(),
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        completion_tokens_details: z
          .object({ reasoning_tokens: z.number().optional() })
          .passthrough()
          .optional(),
        cost_details: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * The one response this tool accounts at zero cost: an Anthropic model's strict json_schema
 * request refused with HTTP 400 because its grammar is too large, before any generation and
 * unbilled (the release still falls back to json_object after it, aip/openrouter.ts). It must be
 * a 400 error envelope without choices or usage that production's own providerHttpErrorCode
 * classifies as provider_request_schema_too_complex, answering a request whose model is
 * anthropic/* and whose response_format is json_schema, on a strict-schema stage (never a
 * `:json` fallback). The same refusal of any other model, Gemini included, and every other
 * response without a reported cost (402, 408, 413, 429, any other 4xx, a 2xx, a 5xx, an
 * unreadable body) counts its full reserve.
 */
export const zeroCostAccountingRule =
  "HTTP 400 error envelope without usage or choices, classified provider_request_schema_too_complex by production providerHttpErrorCode, answering an anthropic/* request with response_format json_schema on a strict stage (never :json); every other response without usage.cost, any other model's or any other 4xx included, counts its full reserve";
export async function preGenerationRejection(input: {
  status: number;
  stage: string;
  rawText: string;
  /** The request's model and response_format.type, read from the dispatched body. */
  model: string;
  responseFormat: string | undefined;
}): Promise<boolean> {
  if (
    input.status !== 400 ||
    input.stage === "unknown" ||
    input.stage.endsWith(":json") ||
    !input.model.startsWith("anthropic/") ||
    input.responseFormat !== "json_schema"
  )
    return false;
  let body: unknown;
  try {
    body = JSON.parse(input.rawText);
  } catch {
    return false;
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "choices") ||
    Object.hasOwn(body, "usage")
  )
    return false;
  return (
    (await providerHttpErrorCode(new Response(input.rawText, { status: input.status }))) ===
    "provider_request_schema_too_complex"
  );
}

export interface GuardedDispatch {
  index: number;
  caseId: string;
  stage: string;
  operationKey: string;
  reserve: DispatchReserve;
  serialized: string;
}
export interface GuardedOutcome extends Omit<GuardedDispatch, "serialized"> {
  outcome: "response" | "unknown";
  status?: number;
  elapsedMs: number;
  /** Parsed JSON when the body is JSON, otherwise the raw text. */
  body?: unknown;
  errorName?: string;
  accountedUsd: number;
  costFallback: boolean;
  receipt: Record<string, unknown>;
}

export interface CostGuardContext {
  zdrEndpoints: unknown;
  /** The real fetch for a live round, or a mock transport. */
  transport: typeof fetch;
  /** The round state; this guard mutates it in place. */
  state: MigrationRoundState;
  caseId: () => string;
  /** Checks the shared cumulative cap and records this reserve as in flight; may refuse. */
  reserveInLedger: (reserveUsd: number) => Promise<void>;
  /** Saves the round state and settles the round's ledger entry. */
  persist: () => Promise<void>;
  /** Inspects a dispatch before any reserve; may refuse it. */
  inspect?: (dispatch: { stage: string; body: DispatchBody }) => void;
  /** Configured models and their output-token caps; any other model is refused. */
  models?: Readonly<Record<string, number>>;
  onRequest?: (dispatch: GuardedDispatch) => Promise<void>;
  onOutcome?: (outcome: GuardedOutcome) => Promise<void>;
  /** A dispatch refused before anything was sent. */
  onRefused?: (refusal: {
    caseId: string;
    stage: string;
    operationKey: string;
    code: string;
  }) => void;
  limits?: BaselineControls;
}

/**
 * Wraps the provider's fetch. Before each dispatch: the reserve, the round cap, the shared
 * cumulative cap and an in-flight reservation; after it: usage.cost, or the full reserve when no
 * cost is reported (nothing only for the strict-schema grammar rejection, see
 * preGenerationRejection). An aborted or unknown
 * outcome counts its full reserve as spent, and this tool never repeats a request; the worker's
 * own retry policy applies unchanged.
 */
export function guardedFetch(context: CostGuardContext): typeof fetch {
  const limits = context.limits ?? baselineControls;
  return async (url, init) => {
    const { state } = context;
    const caseId = context.caseId();
    const serialized = typeof init?.body === "string" ? init.body : "";
    const operationKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
    const stage = operationStage(operationKey);
    let reserve: DispatchReserve;
    try {
      if (state.stopped) throw new DispatchRefused(state.stopReason ?? "round_stopped");
      reserve = dispatchReserve({
        url: String(url),
        serialized,
        zdrEndpoints: context.zdrEndpoints,
        ...(context.models ? { models: context.models } : {}),
      });
      context.inspect?.({ stage, body: reserve.body });
      assertRoundDispatchAllowed(state, reserve.reserveUsd, limits);
      await context.reserveInLedger(reserve.reserveUsd);
    } catch (error) {
      const refused =
        error instanceof DispatchRefused ? error : new DispatchRefused("dispatch_guard_failed");
      state.stopped = true;
      state.stopReason = refused.code;
      context.onRefused?.({ caseId, stage, operationKey, code: refused.code });
      await context.persist();
      throw refused;
    }
    const request: MigrationRequest = {
      id: randomUUID(),
      caseId,
      stage,
      state: "started",
      reserveUsd: reserve.reserveUsd,
    };
    const index = state.requests.push(request) - 1;
    await context.persist();
    await context.onRequest?.({ index, caseId, stage, operationKey, reserve, serialized });
    const began = Date.now();
    let response: Response;
    let rawText: string;
    try {
      response = await context.transport(url, init);
      rawText = await readBounded(response, limits.responseBytes);
    } catch (error) {
      // Unknown outcome, a provider deadline included: the provider may have charged it; count
      // the full reserve and never retry.
      state.requests[index] = { ...request, state: "uncertain", costUsd: reserve.reserveUsd };
      state.spentUsd += reserve.reserveUsd;
      await context.persist();
      const errorName = error instanceof Error ? error.name : "unknown";
      await context.onOutcome?.({
        index,
        caseId,
        stage,
        operationKey,
        reserve,
        outcome: "unknown",
        elapsedMs: Date.now() - began,
        errorName,
        accountedUsd: reserve.reserveUsd,
        costFallback: true,
        receipt: {
          caseId,
          stage,
          status: null,
          outcome: "unknown",
          errorName,
          // AbortSignal.timeout rejects with a TimeoutError: the provider's request deadline.
          timedOut: errorName === "TimeoutError",
          elapsedMs: Date.now() - began,
          model: reserve.model,
          reserveOutputTokens: reserve.reserveOutputTokens,
          reserveUsd: reserve.reserveUsd,
          accountedUsd: reserve.reserveUsd,
          costFallback: true,
        },
      });
      throw error;
    }
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText);
    } catch {
      // A non-JSON body is kept verbatim in the dossier.
    }
    const metadata = usageSchema.safeParse(body);
    const reported = metadata.success ? metadata.data.usage?.cost : undefined;
    const known = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
    const rejectedBeforeGeneration =
      !known &&
      (await preGenerationRejection({
        status: response.status,
        stage,
        rawText,
        model: reserve.model,
        responseFormat: (reserve.body.response_format as { type?: unknown } | undefined)?.type as
          | string
          | undefined,
      }));
    const accountedUsd = known ? reported : rejectedBeforeGeneration ? 0 : reserve.reserveUsd;
    state.requests[index] = {
      ...request,
      state: response.ok ? "completed" : "known_rejection",
      costUsd: accountedUsd,
    };
    state.spentUsd += accountedUsd;
    // The cost is recorded first; a receipt above its reserve closes the round to further spend.
    if (accountedUsd > reserve.reserveUsd && !state.stopped) {
      state.stopped = true;
      state.stopReason = "paid_receipt_exceeds_reserve";
    }
    await context.persist();
    const data = metadata.success ? metadata.data : undefined;
    await context.onOutcome?.({
      index,
      caseId,
      stage,
      operationKey,
      reserve,
      outcome: "response",
      status: response.status,
      elapsedMs: Date.now() - began,
      body,
      accountedUsd,
      costFallback: !known && !rejectedBeforeGeneration,
      receipt: {
        caseId,
        stage,
        status: response.status,
        elapsedMs: Date.now() - began,
        requestId: data?.id,
        model: data?.model,
        // The billed endpoint provider audits which zero-retention route served the request.
        provider: data?.provider,
        finishReason: data?.choices?.[0]?.finish_reason,
        inputTokens: data?.usage?.prompt_tokens,
        outputTokens: data?.usage?.completion_tokens,
        reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens,
        usdCost: known ? reported : undefined,
        costDetails: data?.usage?.cost_details,
        requestModel: reserve.model,
        reserveOutputTokens: reserve.reserveOutputTokens,
        reserveUsd: reserve.reserveUsd,
        accountedUsd,
        costFallback: !known && !rejectedBeforeGeneration,
        preGenerationRejection: rejectedBeforeGeneration,
      },
    });
    return new Response(rawText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
