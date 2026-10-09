import { randomUUID } from "node:crypto";
import { z } from "../../../packages/core/node_modules/zod";
import {
  assertMigrationCumulativeBudget,
  type MigrationLedger,
  type MigrationRequest,
  type MigrationRoundState,
  migrationCumulativeHardUsd,
} from "./ledger";

/** Fixed controls of this evaluation-only round; they are part of the frozen plan. */
export const baselineControls = {
  version: "production-path-baseline-1",
  /** Round spend plus in-flight reserves plus the next reserve may never exceed this. */
  roundHardUsd: 1.2,
  /** Every evaluation round recorded in the shared ledger, including this one. */
  cumulativeHardUsd: migrationCumulativeHardUsd,
  /** A safety net above what the worker's bounded corrections can dispatch for 14 cases. */
  maximumHttpRequests: 56,
  responseBytes: 1048576,
  /** Job invocations per case; the worker checkpoints after each paid stage. */
  maximumJobStepsPerCase: 20,
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
 * reserve = request body bytes x highest ZDR prompt rate + body max_tokens x highest ZDR
 * completion/internal-reasoning rate of the request's own model. UTF-8 bytes bound input tokens.
 */
export function dispatchReserve(input: { url: string; serialized: string; zdrEndpoints: unknown }) {
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
  let maximum: { promptRate: number; outputRate: number };
  try {
    maximum = zdrEndpointMaximumRates(input.zdrEndpoints, body.model);
  } catch {
    throw new DispatchRefused("dispatch_model_has_no_zdr_endpoint");
  }
  const requestBytes = Buffer.byteLength(input.serialized, "utf8");
  const reserveUsd = requestBytes * maximum.promptRate + body.max_tokens * maximum.outputRate;
  if (!Number.isFinite(reserveUsd) || reserveUsd <= 0)
    throw new DispatchRefused("invalid_cost_reservation");
  return {
    body,
    model: body.model,
    maxOutputTokens: body.max_tokens,
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
 * A 4xx OpenRouter error envelope without choices or usage: the request was refused before any
 * generation (production Haiku 4.5's strict json_schema request is refused this way before its
 * one json_object fallback) and is not billed, so it adds no spend. Any other response without a
 * reported cost (a 2xx, a 5xx, an unreadable body) counts its full reserve.
 */
export function preGenerationRejection(status: number, body: unknown): boolean {
  if (status < 400 || status >= 500 || !body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  return (
    !!error &&
    typeof error === "object" &&
    !Object.hasOwn(body, "choices") &&
    !Object.hasOwn(body, "usage")
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
 * cost is reported (nothing for an unbilled refusal before generation). An aborted or unknown
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
      // Unknown outcome: the provider may have charged it; count the full reserve and never retry.
      state.requests[index] = { ...request, state: "uncertain", costUsd: reserve.reserveUsd };
      state.spentUsd += reserve.reserveUsd;
      await context.persist();
      await context.onOutcome?.({
        index,
        caseId,
        stage,
        operationKey,
        reserve,
        outcome: "unknown",
        elapsedMs: Date.now() - began,
        errorName: error instanceof Error ? error.name : "unknown",
        accountedUsd: reserve.reserveUsd,
        costFallback: true,
        receipt: {
          caseId,
          stage,
          status: null,
          outcome: "unknown",
          elapsedMs: Date.now() - began,
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
    const accountedUsd = known
      ? reported
      : preGenerationRejection(response.status, body)
        ? 0
        : reserve.reserveUsd;
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
      costFallback: !known && accountedUsd === reserve.reserveUsd,
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
        reserveUsd: reserve.reserveUsd,
        accountedUsd,
        costFallback: !known && accountedUsd === reserve.reserveUsd,
        preGenerationRejection: !known && accountedUsd === 0,
      },
    });
    return new Response(rawText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
