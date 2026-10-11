import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerSettingsSchema } from "../../packages/core/src/aip";
import { LESSON_REVIEW_RUBRIC_VERSION, lessonReviewCriteria } from "../../packages/core/src/eval";
import {
  accountedMicros,
  type BudgetAttempt,
  canReserve,
  executeBenchmarkTrial,
  parseBenchmarkArgs,
  prepareBenchmarkCase,
  replayBenchmark,
  runBenchmark,
  selectBenchmarkCases,
  verifyPriceBound,
} from "./lesson-review-benchmark";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), "recalino-review-benchmark-")))
      throw new Error("unsafe_test_cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});
const settings = providerSettingsSchema.parse(
  JSON.parse(
    await readFile(new URL("../../config/openrouter-defaults.json", import.meta.url), "utf8"),
  ),
);
const fixture = (() => {
  const item = selectBenchmarkCases("smoke").find(
    (entry) =>
      entry.explanationLanguage === "en" &&
      Object.values(entry.expected.checks).every((check) => check.status === "satisfactory"),
  );
  if (!item) throw new Error("missing_transport_fixture");
  return item;
})();
function clearResponse() {
  return {
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
    checks: lessonReviewCriteria.map((criterion) => ({
      criterion,
      status: "satisfactory",
      reason: "Synthetic response for transport verification only.",
      findings: [],
    })),
  };
}
function response(body = clearResponse(), cost: number | null = 0.001) {
  return new Response(
    JSON.stringify({
      id: "synthetic-request",
      model: settings.llmModel,
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 50, completion_tokens: 50, ...(cost === null ? {} : { cost }) },
    }),
    { status: 200 },
  );
}
async function trial(overrides: Partial<Parameters<typeof executeBenchmarkTrial>[0]> = {}) {
  const attempts: BudgetAttempt[] = [];
  const persist = vi.fn(async () => undefined);
  const capture = vi.fn<(file: string, body: string) => Promise<void>>(async () => undefined);
  const request = vi.fn<typeof fetch>(async () => response());
  const options = {
    prepared: await prepareBenchmarkCase(fixture, settings),
    settings,
    credential: "test-key-never-real",
    repeat: 0,
    attempts,
    budgetMicros: 2_000_000,
    persist,
    capture,
    request,
    ...overrides,
  };
  const record = await executeBenchmarkTrial(options);
  return { record, options, persist, capture, request, attempts };
}

describe("AC-LRB-02/04/05 real-review benchmark transport", () => {
  it("is offline by default and requires explicit bounded live mode", () => {
    expect(parseBenchmarkArgs([])).toMatchObject({ live: false, suite: "smoke", repeats: 1 });
    expect(() => parseBenchmarkArgs(["--run-live"])).toThrow("live_budget_required");
    expect(
      parseBenchmarkArgs(["--run-live", "--budget-usd", "2", "--suite", "all", "--repeats", "2"]),
    ).toMatchObject({ live: true, budgetMicros: 2_000_000, suite: "all", repeats: 2 });
    for (const args of [
      ["--unknown"],
      ["--suite", "typo"],
      ["--repeats", "0"],
      ["--repeats", "4"],
      ["--run-live", "--budget-usd", "NaN"],
      ["--run-live", "--budget-usd", "1e2"],
      ["--budget-usd", "2"],
      ["--replay-from", "capture", "--run-live", "--budget-usd", "2"],
      ["--suite", "all", "--suite", "smoke"],
    ])
      expect(() => parseBenchmarkArgs(args)).toThrow();
  });
  it("starts with the twelve smoke cases while preserving holdout separation", () => {
    const all = selectBenchmarkCases("all");
    expect(all.slice(0, 12).every((item) => item.smoke && item.split === "development")).toBe(true);
    expect(
      selectBenchmarkCases("holdout").every((item) => item.split === "holdout" && !item.smoke),
    ).toBe(true);
  });
  it("prepares the real request without network and never includes answer-key metadata", async () => {
    const fetch = vi.fn(() => {
      throw new Error("network forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const prepared = await prepareBenchmarkCase(fixture, settings);
    const body = JSON.parse(prepared.requestBody);
    expect(fetch).not.toHaveBeenCalled();
    expect(body.model).toBe(settings.llmModel);
    expect(body.max_tokens).toBe(
      settings.structuredModelOverrides?.[settings.llmModel]?.maxOutputTokens,
    );
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(body.messages[1].content[0].text).toBe(prepared.input.input);
    expect(body.messages[1].content[0].text).not.toContain(
      fixture.expected.checks.source_grounding?.rationale,
    );
    expect(body.messages[1].content[0].text).not.toContain('"expected"');
    expect(body.messages[1].content[0].text).not.toContain('"familyId"');
  });
  it("persists a reservation before dispatch and releases only known actual cost", async () => {
    const order: string[] = [];
    const result = await trial({
      persist: async () => {
        order.push("persist");
      },
      request: async () => {
        order.push("network");
        return response();
      },
      capture: async () => {
        order.push("capture");
      },
    });
    expect(order).toEqual(["persist", "network", "capture", "persist"]);
    expect(result.record.outcome).toBe("response");
    expect(result.attempts[0]).toMatchObject({ status: "received", actualMicros: 1000 });
    expect(accountedMicros(result.attempts)).toBe(1000);
  });
  it("does not dispatch when remaining budget cannot cover the configured reservation", async () => {
    const result = await trial({ budgetMicros: 1 });
    expect(result.record).toMatchObject({ outcome: "not_run", reason: "budget_limit" });
    expect(result.request).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(0);
  });
  it("aborts before dispatch when the durable reservation cannot be written", async () => {
    const request = vi.fn<typeof fetch>(async () => response());
    await expect(
      trial({
        request,
        persist: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("benchmark_persistence_failed");
    expect(request).not.toHaveBeenCalled();
  });
  it("retains full reservation for timeout or unknown cost and does not retry", async () => {
    const timeout = await trial({
      request: async () => {
        throw new Error("timeout");
      },
    });
    expect(timeout.record).toMatchObject({
      outcome: "failure",
      failureCode: "provider_outcome_unknown",
    });
    expect(timeout.attempts[0]?.status).toBe("uncertain");
    expect(accountedMicros(timeout.attempts)).toBe(settings.maximumMicros);
    const missingCost = await trial({ request: async () => response(clearResponse(), null) });
    expect(missingCost.record.outcome).toBe("response");
    expect(missingCost.attempts[0]?.status).toBe("uncertain");
    expect(accountedMicros(missingCost.attempts)).toBe(settings.maximumMicros);
  });
  it("does not release uncertain exposure on a 503 response that reports zero cost", async () => {
    const result = await trial({
      request: async () => new Response(JSON.stringify({ usage: { cost: 0 } }), { status: 503 }),
    });
    expect(result.attempts[0]).toMatchObject({ status: "uncertain", actualMicros: 0 });
    expect(accountedMicros(result.attempts)).toBe(settings.maximumMicros);
  });
  it("propagates an uncertain malformed 200 response even when cost is available", async () => {
    const result = await trial({
      request: async () => new Response(JSON.stringify({ usage: { cost: 0.001 } })),
    });
    expect(result.record).toMatchObject({
      outcome: "failure",
      failureCode: "provider_response_invalid",
    });
    expect(result.attempts[0]?.status).toBe("uncertain");
    expect(accountedMicros(result.attempts)).toBe(settings.maximumMicros);
  });
  it("does not attribute a different returned model to the configured reviewer", async () => {
    const result = await trial({
      request: async () => {
        const body = (await response().json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, model: "another/model" }));
      },
    });
    expect(result.record).toMatchObject({
      outcome: "failure",
      failureCode: "provider_model_mismatch",
    });
    expect(result.attempts[0]).toMatchObject({
      returnedModel: "another/model",
      requestId: "synthetic-request",
    });
  });
  it("counts a paid schema failure and preserves its raw capture without rebilling", async () => {
    const result = await trial({
      request: async () => response({ rubricVersion: LESSON_REVIEW_RUBRIC_VERSION, checks: [] }),
    });
    expect(result.record).toMatchObject({
      outcome: "failure",
      failureCode: "provider_schema_invalid",
      costMicros: 1000,
    });
    expect(result.capture).toHaveBeenCalledOnce();
    expect(result.attempts).toHaveLength(1);
  });
  it("blocks the provider's automatic schema-400 fallback before a second network request", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "schema is too complex for compilation" },
            usage: { cost: 0 },
          }),
          { status: 400 },
        ),
    );
    const result = await trial({ request });
    expect(request).toHaveBeenCalledOnce();
    expect(result.record).toMatchObject({
      outcome: "failure",
      failureCode: "benchmark_fallback_blocked",
    });
    expect(result.attempts).toHaveLength(1);
  });
  it("rejects a changed request body before dispatch", async () => {
    const prepared = await prepareBenchmarkCase(fixture, settings);
    const result = await trial({ prepared: { ...prepared, requestBody: "tampered" } });
    expect(result.record).toMatchObject({ outcome: "not_run", reason: "transport_guard" });
    expect(result.request).not.toHaveBeenCalled();
  });
  it("never leaks the provider credential into the captured response", async () => {
    const result = await trial({
      request: async () =>
        new Response(
          JSON.stringify({ error: { message: "test-key-never-real" }, usage: { cost: 0 } }),
          { status: 401 },
        ),
    });
    expect(result.capture.mock.calls[0]?.[1]).not.toContain("test-key-never-real");
    expect(result.capture.mock.calls[0]?.[1]).toContain("[redacted]");
  });
  it("checks pricing before authorizing the configured per-request reservation", () => {
    expect(
      verifyPriceBound(
        { prompt: "0.00000075", completion: "0.00000375", internal_reasoning: "0.00000375" },
        settings,
        20000,
      ).reservedMicros,
    ).toBe(settings.maximumMicros);
    expect(() => verifyPriceBound({ prompt: "2", completion: "3" }, settings, 20000)).toThrow(
      "configured_reservation_below_current_price_bound",
    );
    expect(() => verifyPriceBound({ prompt: "", completion: "0" }, settings, 20000)).toThrow(
      "price_unavailable",
    );
    expect(canReserve([], settings.maximumMicros, settings.maximumMicros)).toBe(true);
  });
  it("replays a complete captured round offline and rejects a changed response", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const parent = await mkdtemp(resolve(tmpdir(), "recalino-review-benchmark-"));
    directories.push(parent);
    const out = resolve(parent, "round");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-never-real");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) =>
        String(url).endsWith("/models")
          ? new Response(
              JSON.stringify({
                data: [
                  {
                    id: settings.llmModel,
                    pricing: { prompt: "0.00000075", completion: "0.00000375" },
                  },
                ],
              }),
            )
          : response(),
      ),
    );
    await runBenchmark({ suite: "smoke", repeats: 1, live: true, budgetMicros: 2_000_000, out });
    const noNetwork = vi.fn(() => {
      throw new Error("replay must be offline");
    });
    vi.stubGlobal("fetch", noNetwork);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await replayBenchmark(out)).toMatchObject({
      verified: true,
      networkCalls: 0,
      records: 12,
    });
    expect(noNetwork).not.toHaveBeenCalled();
    const state = JSON.parse(await readFile(resolve(out, "state.json"), "utf8"));
    const manifestPath = resolve(out, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const lowBudgetManifest = structuredClone(manifest);
    const lowBudgetState = structuredClone(state);
    lowBudgetManifest.budgetMicros = 100_000;
    lowBudgetManifest.freeze.budgetMicros = 100_000;
    lowBudgetManifest.freezeHash = createHash("sha256")
      .update(JSON.stringify(lowBudgetManifest.freeze, null, 2))
      .digest("hex");
    lowBudgetState.budgetMicros = 100_000;
    lowBudgetState.freezeHash = lowBudgetManifest.freezeHash;
    await writeFile(manifestPath, JSON.stringify(lowBudgetManifest));
    await writeFile(resolve(out, "state.json"), JSON.stringify(lowBudgetState));
    await expect(replayBenchmark(out)).rejects.toThrow("replay_dispatch_not_admitted");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(resolve(out, "state.json"), JSON.stringify(state));
    const changedCost = structuredClone(state);
    changedCost.attempts[0].actualMicros = 0;
    await writeFile(resolve(out, "state.json"), JSON.stringify(changedCost));
    await expect(replayBenchmark(out)).rejects.toThrow("replay_cost_tampered");
    await writeFile(resolve(out, "state.json"), JSON.stringify(state));
    const inputPath = resolve(out, "inputs", `${state.attempts[0].caseId}.json`);
    const originalInput = await readFile(inputPath, "utf8");
    await writeFile(inputPath, "{}");
    await expect(replayBenchmark(out)).rejects.toThrow("replay_input_tampered");
    await writeFile(inputPath, originalInput);
    await writeFile(resolve(out, "responses", state.attempts[0].responseFile), "{}");
    await expect(replayBenchmark(out)).rejects.toThrow("replay_response_tampered");
  });
});

import { createHash } from "node:crypto";
