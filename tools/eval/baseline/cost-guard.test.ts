import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baselineSchedule } from "./baseline-fixtures";
import {
  assertLedgerDispatchAllowed,
  assertRoundDispatchAllowed,
  baselineControls,
  DispatchRefused,
  dispatchReserve,
  guardedFetch,
  openRouterChatUrl,
  operationStage,
  preGenerationRejection,
  roundInFlightUsd,
} from "./cost-guard";
import type { MigrationLedger, MigrationRoundState } from "./ledger";

const zdr = {
  data: [
    { model_id: "vendor/model", pricing: { prompt: "0.000001", completion: "0.000005" } },
    {
      model_id: "vendor/model",
      pricing: {
        prompt: "0.0000011",
        completion: "0.0000055",
        internal_reasoning: "0.000006",
        overrides: [{ prompt: "0.000002" }],
      },
    },
    { model_id: "vendor/other", pricing: { prompt: "1", completion: "1" } },
  ],
};
const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: "vendor/model",
    provider: { zdr: true, data_collection: "deny", require_parameters: true },
    max_tokens: 1000,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "lesson" }] },
    ],
    ...overrides,
  });
const operationKey = "11111111-1111-4111-8111-111111111111:knowledge:1";
const refusal = (code: string) => expect.objectContaining({ name: "DispatchRefused", code });

describe("dispatch reserve", () => {
  it("multiplies request bytes and max_tokens by the highest zero-retention rates of the model", () => {
    const serialized = body();
    const reserve = dispatchReserve({ url: openRouterChatUrl, serialized, zdrEndpoints: zdr });
    // Highest prompt rate includes the long-context override; output includes internal reasoning.
    expect(reserve.promptRate).toBe(0.000002);
    expect(reserve.outputRate).toBe(0.000006);
    expect(reserve.requestBytes).toBe(Buffer.byteLength(serialized, "utf8"));
    expect(reserve.reserveUsd).toBeCloseTo(
      Buffer.byteLength(serialized, "utf8") * 0.000002 + 1000 * 0.000006,
      12,
    );
  });

  it("counts UTF-8 bytes, not characters", () => {
    const ascii = dispatchReserve({
      url: openRouterChatUrl,
      serialized: body(),
      zdrEndpoints: zdr,
    });
    const persian = dispatchReserve({
      url: openRouterChatUrl,
      serialized: body({ note: "سلام" }),
      zdrEndpoints: zdr,
    });
    expect(persian.requestBytes - ascii.requestBytes).toBe(Buffer.byteLength(',"note":"سلام"'));
  });

  it("refuses another endpoint, a non-ZDR route, an unknown model or an unreadable body", () => {
    expect(() =>
      dispatchReserve({
        url: "https://openrouter.ai/api/v1/audio/speech",
        serialized: body(),
        zdrEndpoints: zdr,
      }),
    ).toThrow(refusal("dispatch_url_not_allowed"));
    expect(() =>
      dispatchReserve({
        url: openRouterChatUrl,
        serialized: body({ provider: { zdr: false, data_collection: "deny" } }),
        zdrEndpoints: zdr,
      }),
    ).toThrow(refusal("dispatch_body_invalid"));
    expect(() =>
      dispatchReserve({
        url: openRouterChatUrl,
        serialized: body({ model: "vendor/unknown" }),
        zdrEndpoints: zdr,
      }),
    ).toThrow(refusal("dispatch_model_has_no_zdr_endpoint"));
    expect(() =>
      dispatchReserve({ url: openRouterChatUrl, serialized: "{", zdrEndpoints: zdr }),
    ).toThrow(refusal("dispatch_body_invalid"));
  });

  const captured =
    "C:/Users/Ali-PC/.codex/worktrees/haiku55-migration/Recalino/artifacts/verification/model-comparison-provider/openrouter-zdr-endpoints-2026-10-09.json";
  it.skipIf(!existsSync(captured))(
    "reserves production Haiku 4.5 at its most expensive regional ZDR price",
    () => {
      const reserve = dispatchReserve({
        url: openRouterChatUrl,
        serialized: body({ model: "anthropic/claude-haiku-4.5", max_tokens: 6144 }),
        zdrEndpoints: JSON.parse(readFileSync(captured, "utf8")),
      });
      expect(reserve.promptRate).toBe(0.0000011);
      expect(reserve.outputRate).toBe(0.0000055);
    },
  );
});

describe("round and cumulative caps", () => {
  const request = (state: "started" | "completed", reserveUsd: number) => ({
    id: crypto.randomUUID(),
    caseId: "S01-1",
    stage: "knowledge",
    state,
    reserveUsd,
  });

  it("allows a dispatch within the round cap, counting in-flight reserves", () => {
    expect(() =>
      assertRoundDispatchAllowed({ spentUsd: 1.0, requests: [request("started", 0.1)] }, 0.09),
    ).not.toThrow();
    expect(() =>
      assertRoundDispatchAllowed({ spentUsd: 1.0, requests: [request("started", 0.1)] }, 0.11),
    ).toThrow(refusal("round_budget_before_dispatch"));
    expect(() => assertRoundDispatchAllowed({ spentUsd: 1.15, requests: [] }, 0.06)).toThrow(
      refusal("round_budget_before_dispatch"),
    );
    expect(roundInFlightUsd([request("started", 0.1), request("completed", 0.2)])).toBe(0.1);
  });

  it("never limits HTTP requests below what the worker can dispatch within the job step bound", () => {
    const cases = baselineSchedule().length;
    // Bounded corrections: knowledge, knowledge:compact, knowledge:repair and
    // knowledge:repair-language, each a strict json_schema request plus its json_object fallback.
    expect(baselineControls.maximumHttpRequests).toBeGreaterThanOrEqual(cases * 4 * 2);
    // One structured call per job invocation, so the per-case step bound is never undercut.
    expect(baselineControls.maximumHttpRequests).toBe(
      cases * baselineControls.maximumJobStepsPerCase * 2,
    );
  });

  it("refuses a request beyond the HTTP request limit or an invalid reserve", () => {
    const requests = Array.from({ length: baselineControls.maximumHttpRequests }, () =>
      request("completed", 0),
    );
    expect(() => assertRoundDispatchAllowed({ spentUsd: 0, requests }, 0.01)).toThrow(
      refusal("http_request_limit"),
    );
    expect(() => assertRoundDispatchAllowed({ spentUsd: 0, requests: [] }, 0)).toThrow(
      refusal("invalid_cost_reservation"),
    );
  });

  it("refuses when the shared ledger's spend, in-flight included, plus the reserve exceeds 5 USD", () => {
    const ledger: MigrationLedger = {
      version: 1,
      priorUnledgeredUsd: 0.5,
      rounds: [
        {
          freeze: "a".repeat(64),
          directory: "a",
          fixtureSet: "x",
          spentUsd: 4.0,
          inFlightUsd: 0.3,
          status: "running",
        },
      ],
    };
    expect(() => assertLedgerDispatchAllowed(ledger, 0.2)).not.toThrow();
    expect(() => assertLedgerDispatchAllowed(ledger, 0.21)).toThrow(
      refusal("cumulative_budget_before_dispatch"),
    );
  });

  it("reads the worker step from the operation key", () => {
    expect(operationStage(operationKey)).toBe("knowledge");
    expect(operationStage("11111111-1111-4111-8111-111111111111:knowledge:repair:1")).toBe(
      "knowledge:repair",
    );
    expect(operationStage(`${operationKey}:json`)).toBe("knowledge:json");
    expect(operationStage("unexpected")).toBe("unknown");
  });
});

describe("guarded fetch", () => {
  const setup = (
    transport: typeof fetch,
    options: { ledgerRefuses?: boolean; inspect?: () => void; operationKey?: string } = {},
  ) => {
    const state: MigrationRoundState = {
      freeze: "f",
      spentUsd: 0,
      stopped: false,
      requests: [],
      results: [],
    };
    const events: string[] = [];
    let transportCalls = 0;
    const counted: typeof fetch = async (url, init) => {
      transportCalls += 1;
      return transport(url, init);
    };
    const request = guardedFetch({
      zdrEndpoints: zdr,
      transport: counted,
      state,
      caseId: () => "S01-1",
      reserveInLedger: async () => {
        events.push("ledger");
        if (options.ledgerRefuses) throw new DispatchRefused("cumulative_budget_before_dispatch");
      },
      persist: async () => {
        events.push(`persist:${state.requests.map((entry) => entry.state).join(",")}`);
      },
      inspect: options.inspect,
    });
    const dispatch = () =>
      request(openRouterChatUrl, {
        method: "POST",
        headers: { "Idempotency-Key": options.operationKey ?? operationKey },
        body: body(),
      });
    return { state, events, dispatch, calls: () => transportCalls };
  };
  const reserve = dispatchReserve({
    url: openRouterChatUrl,
    serialized: body(),
    zdrEndpoints: zdr,
  }).reserveUsd;

  it("records the reported usage cost and returns the response body unchanged", async () => {
    const payload = JSON.stringify({ id: "gen-1", model: "vendor/model", usage: { cost: 0.0123 } });
    const guard = setup(async () => new Response(payload, { status: 200 }));
    const response = await guard.dispatch();
    expect(await response.text()).toBe(payload);
    expect(guard.state.spentUsd).toBe(0.0123);
    expect(guard.state.requests).toEqual([
      expect.objectContaining({ state: "completed", costUsd: 0.0123, reserveUsd: reserve }),
    ]);
    expect(guard.events).toEqual(["ledger", "persist:started", "persist:completed"]);
  });

  // The envelope OpenRouter returns when Haiku 4.5 refuses the strict class_knowledge grammar.
  const grammarRejection = JSON.stringify({
    error: {
      message: "Provider returned error",
      code: 400,
      metadata: {
        raw: JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "The compiled grammar is too large." },
        }),
      },
    },
  });

  it("counts the full reserve whenever a response reports no cost, other 4xx included", async () => {
    for (const [status, payload] of [
      [200, '{"id":"gen-2","choices":[{"message":{"content":"{}"}}]}'],
      [502, '{"error":{"message":"upstream"}}'],
      [400, "not json"],
      [400, '{"error":{"message":"Invalid request","code":400}}'],
      [402, '{"error":{"message":"Insufficient credits","code":402}}'],
      [408, '{"error":{"message":"Timed out","code":408}}'],
      [413, '{"error":{"message":"Payload too large","code":413}}'],
      [429, '{"error":{"message":"Rate limited","code":429}}'],
      [429, grammarRejection],
    ] as const) {
      const guard = setup(async () => new Response(payload, { status }));
      expect((await guard.dispatch()).status).toBe(status);
      expect(guard.state.requests[0]).toMatchObject({ costUsd: reserve });
      expect(guard.state.spentUsd).toBe(reserve);
    }
  });

  it("adds nothing only for production's strict-schema grammar rejection", async () => {
    const guard = setup(async () => new Response(grammarRejection, { status: 400 }));
    const response = await guard.dispatch();
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(grammarRejection);
    expect(guard.state.requests[0]).toMatchObject({ state: "known_rejection", costUsd: 0 });
    expect(guard.state.spentUsd).toBe(0);
  });

  it("counts the full reserve for the same rejection of a json_object fallback", async () => {
    const guard = setup(async () => new Response(grammarRejection, { status: 400 }), {
      operationKey: `${operationKey}:json`,
    });
    await guard.dispatch();
    expect(guard.state.requests[0]).toMatchObject({
      stage: "knowledge:json",
      state: "known_rejection",
      costUsd: reserve,
    });
    expect(guard.state.spentUsd).toBe(reserve);
  });

  it("classifies a zero-cost rejection with production's own error classification", async () => {
    const zero = (status: number, rawText: string, stage = "knowledge") =>
      preGenerationRejection({ status, stage, rawText });
    expect(await zero(400, grammarRejection)).toBe(true);
    expect(await zero(400, grammarRejection, "knowledge:repair")).toBe(true);
    expect(await zero(400, grammarRejection, "knowledge:json")).toBe(false);
    expect(await zero(400, grammarRejection, "knowledge:repair:json")).toBe(false);
    expect(await zero(400, grammarRejection, "unknown")).toBe(false);
    for (const status of [402, 408, 413, 429, 500])
      expect(await zero(status, grammarRejection)).toBe(false);
    expect(await zero(400, '{"error":{"message":"Invalid request"}}')).toBe(false);
    expect(
      await zero(
        400,
        '{"error":{"message":"Provider returned error","metadata":{"raw":"grammar"}}}',
      ),
    ).toBe(false);
    const withUsage = JSON.stringify({
      ...JSON.parse(grammarRejection),
      usage: { prompt_tokens: 9 },
    });
    expect(await zero(400, withUsage)).toBe(false);
    expect(await zero(400, "not json")).toBe(false);
  });

  it("counts an aborted dispatch as fully spent and never repeats it", async () => {
    const guard = setup(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(guard.dispatch()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(guard.calls()).toBe(1);
    expect(guard.state.requests[0]).toMatchObject({ state: "uncertain", costUsd: reserve });
    expect(guard.state.spentUsd).toBe(reserve);
    expect(guard.state.stopped).toBe(false);
  });

  it("refuses before any dispatch when the shared ledger refuses, and stops the round", async () => {
    const guard = setup(async () => new Response("{}"), { ledgerRefuses: true });
    await expect(guard.dispatch()).rejects.toThrow(refusal("cumulative_budget_before_dispatch"));
    expect(guard.calls()).toBe(0);
    expect(guard.state).toMatchObject({
      stopped: true,
      stopReason: "cumulative_budget_before_dispatch",
      requests: [],
      spentUsd: 0,
    });
    await expect(guard.dispatch()).rejects.toThrow(refusal("cumulative_budget_before_dispatch"));
    expect(guard.calls()).toBe(0);
  });

  it("refuses a dispatch the inspector rejects", async () => {
    const guard = setup(async () => new Response("{}"), {
      inspect: () => {
        throw new DispatchRefused("knowledge_input_differs_from_fixture");
      },
    });
    await expect(guard.dispatch()).rejects.toThrow(refusal("knowledge_input_differs_from_fixture"));
    expect(guard.calls()).toBe(0);
  });

  it("refuses once the round cap would be exceeded", async () => {
    const guard = setup(async () => new Response("{}"));
    guard.state.spentUsd = baselineControls.roundHardUsd - reserve / 2;
    await expect(guard.dispatch()).rejects.toThrow(refusal("round_budget_before_dispatch"));
    expect(guard.calls()).toBe(0);
  });

  it("closes the round when a receipt exceeds its reserve", async () => {
    const guard = setup(async () => new Response(JSON.stringify({ usage: { cost: 9 } })));
    await guard.dispatch();
    expect(guard.state).toMatchObject({
      stopped: true,
      stopReason: "paid_receipt_exceeds_reserve",
    });
    expect(guard.state.spentUsd).toBe(9);
  });
});
