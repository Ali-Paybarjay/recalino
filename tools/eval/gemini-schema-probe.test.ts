import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerSettingsSchema } from "../../packages/core/src/aip";
import {
  classifySchemaProbe,
  parseSchemaProbeOptions,
  runSchemaProbe,
  type SchemaProbeOptions,
  schemaProbeMaxOutputTokens,
  schemaProbeRequest,
  schemaProbeReserve,
  schemaProbeSchema,
  schemaProbeSettings,
  schemaProbeSystem,
} from "./gemini-schema-probe";
import { type MigrationLedger, migrationUnledgeredPriorUsd } from "./haiku55-migration-guards";
import { comparisonSettings, schemaDecodingCandidates } from "./model-comparison-candidates";

const gemini = "google/gemini-3.8-flash";
// A synthetic test credential; it must never appear in any printed line or saved file.
const key = "sk-or-synthetic-probe-test-key";
const production = async () =>
  providerSettingsSchema.parse(
    JSON.parse(await readFile(resolve("config/openrouter-defaults.json"), "utf8")),
  );
const valid = JSON.stringify({ verdict: "alpha", items: [{ kind: "x", label: "one" }] });
const chat = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "gen-synthetic",
      model: gemini,
      provider: "Google",
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { cost: 0.004, prompt_tokens: 120, completion_tokens: 400 },
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

let directory: string;
let options: SchemaProbeOptions;
let printed: string[];
let calls: { url: string; init: RequestInit | undefined }[];
const run = (
  respond: () => Response | Promise<Response>,
  override: Partial<SchemaProbeOptions> = {},
) =>
  runSchemaProbe(
    { ...options, ...override },
    {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return respond();
      }) as typeof fetch,
      write: (line) => printed.push(line),
      today: () => "2026-10-09",
    },
  );
const live = async () => {
  await run(() => chat(valid));
  const plan = JSON.parse(await readFile(join(options.out, "dry-run-plan.json"), "utf8"));
  return {
    runLive: true,
    approvedFreeze: plan.freeze as string,
    envFile: join(directory, "probe.env"),
  };
};
const savedText = async () => {
  const names = await readdir(options.out);
  const files = await Promise.all(names.map((name) => readFile(join(options.out, name), "utf8")));
  return [...files, await readFile(options.ledgerPath, "utf8").catch(() => "")].join("\n");
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "recalino-probe-"));
  printed = [];
  calls = [];
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({
      data: [{ id: gemini, pricing: { prompt: "0.00000075", completion: "0.00000375" } }],
    }),
  );
  await writeFile(
    join(directory, "zdr.json"),
    JSON.stringify({
      data: [
        { model_id: gemini, pricing: { prompt: "0.00000135", completion: "0.00000675" } },
        { model_id: gemini, pricing: { prompt: "0.00000075", completion: "0.00000375" } },
      ],
    }),
  );
  await writeFile(join(directory, "probe.env"), `OPENROUTER_API_KEY=${key}\n`);
  options = {
    out: join(directory, "probe"),
    catalogPath: join(directory, "catalog.json"),
    zdrEndpointPath: join(directory, "zdr.json"),
    runLive: false,
    ledgerPath: join(directory, "ledger.json"),
    configPath: resolve("config/openrouter-defaults.json"),
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("FR-PROC-003 strict json_schema enforcement probe request", () => {
  it("uses the schema candidate's route with only a smaller physical output cap", async () => {
    const base = await production();
    const settings = schemaProbeSettings(base);
    const candidate = schemaDecodingCandidates["gemini-3.8-flash-medium-schema"];
    if (!candidate) throw new Error("Missing schema candidate");
    const twin = comparisonSettings(base, "twin", candidate).structuredModelOverrides?.[gemini];
    expect(settings.llmModel).toBe(gemini);
    expect(settings.structuredModelOverrides?.[gemini]).toEqual({
      ...twin,
      maxOutputTokens: schemaProbeMaxOutputTokens,
    });
    expect(settings.structuredModelOverrides?.[gemini]?.structuredOutputMode).toBe("json_schema");
  });
  it("sends one strict schema request with a prompt that contradicts the grammar", async () => {
    const request = await schemaProbeRequest(schemaProbeSettings(await production()));
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(request.headers).not.toHaveProperty("Idempotency-Key");
    const body = request.body as unknown as Record<string, unknown> & {
      messages: { role: string; content: unknown }[];
      response_format: {
        type: string;
        json_schema: { strict: boolean; schema: Record<string, unknown> };
      };
    };
    expect(body).toMatchObject({
      model: gemini,
      max_tokens: schemaProbeMaxOutputTokens,
      provider: { zdr: true, data_collection: "deny", require_parameters: true },
      reasoning: { effort: "medium" },
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages[0]).toEqual({ role: "system", content: schemaProbeSystem });
    expect(JSON.stringify(body.messages)).not.toContain('"enum"');
    const schema = JSON.stringify(body.response_format.json_schema.schema);
    expect(schema).toContain('"enum":["alpha"]');
    expect(schema).toContain('"minItems":1');
    expect(schema).not.toMatch(/"(minimum|maximum)"/);
    expect(schemaProbeSchema.safeParse(JSON.parse(valid)).success).toBe(true);
    expect(schemaProbeSchema.safeParse({ answer: "beta" }).success).toBe(false);
    expect(schemaProbeSchema.safeParse({ verdict: "alpha", items: [] }).success).toBe(false);
  });
  it("classifies only schema-valid output as an enforced grammar", () => {
    expect(classifySchemaProbe({ valid: true, visibleContent: valid })).toEqual({
      outcome: "schema_valid",
      grammarEnforced: true,
      followedPrompt: false,
    });
    expect(
      classifySchemaProbe({
        valid: false,
        errorCode: "provider_schema_invalid",
        visibleContent: '{"answer":"beta"}',
      }),
    ).toEqual({ outcome: "schema_invalid", grammarEnforced: false, followedPrompt: true });
    for (const [observed, outcome] of [
      [{ errorCode: "provider_output_truncated" }, "truncated"],
      [{ errorCode: "provider_http_400" }, "http_rejected"],
      [{ errorCode: "provider_outcome_unknown", uncertain: true }, "outcome_unknown"],
      [{ blocked: "unexpected_transport_blocked" }, "fallback_blocked"],
      [{ blocked: "cumulative_budget_before_dispatch" }, "dispatch_refused"],
      [{ reportedModelMatches: false }, "reported_model_mismatch"],
    ] as const)
      expect(classifySchemaProbe({ valid: false, ...observed })).toMatchObject({
        outcome,
        grammarEnforced: null,
      });
    expect(
      classifySchemaProbe({ valid: true, reportedModelMatches: false }).grammarEnforced,
    ).toBeNull();
  });
});

describe("FR-QUOTA-009 FR-PLT-009 enforcement probe dispatch", () => {
  it("reserves at the most expensive ZDR price within the 0.05 USD probe cap", () => {
    const reserve = schemaProbeReserve("x".repeat(2000), schemaProbeMaxOutputTokens, {
      promptRate: 0.00000135,
      outputRate: 0.00000675,
    });
    expect(reserve.reserveUsd).toBeCloseTo(2000 * 0.00000135 + 6000 * 0.00000675);
    expect(reserve.reserveUsd).toBeLessThanOrEqual(0.05);
    expect(() =>
      schemaProbeReserve("x", 32000, { promptRate: 0.00000135, outputRate: 0.00000675 }),
    ).toThrow("probe_reserve_exceeds_hard_cap");
  });
  it("only prints the request in a dry run and never calls the network", async () => {
    expect(await run(() => chat(valid))).toBe(0);
    expect(calls).toHaveLength(0);
    const output = JSON.parse(printed[0] ?? "{}");
    expect(output).toMatchObject({ dryRun: true, paidCalls: 0, hardUsd: 0.05 });
    expect(output.request.body.response_format.type).toBe("json_schema");
    expect(output.reserveUsd).toBeLessThanOrEqual(0.05);
    expect(await readdir(options.out)).toEqual(["dry-run-plan.json"]);
    await expect(readFile(options.ledgerPath)).rejects.toThrow();
  });
  it("needs the captured prices, the approved freeze and an explicit credential file", async () => {
    await expect(run(() => chat(valid), { zdrEndpointPath: undefined })).rejects.toThrow(
      "ZDR endpoint list",
    );
    const approved = await live();
    await expect(
      run(() => chat(valid), { ...approved, approvedFreeze: "b".repeat(64) }),
    ).rejects.toThrow("approve this exact probe freeze");
    await expect(run(() => chat(valid), { ...approved, envFile: undefined })).rejects.toThrow(
      "credential file",
    );
    await writeFile(join(directory, "empty.env"), "OTHER=1\n");
    await expect(
      run(() => chat(valid), { ...approved, envFile: join(directory, "empty.env") }),
    ).rejects.toThrow("credential unavailable");
    expect(calls).toHaveLength(0);
  });
  it("records a schema-valid outcome and its spend in the shared ledger, once", async () => {
    const approved = await live();
    expect(await run(() => chat(valid, { provider: `Echo ${key}` }), approved)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(`Bearer ${key}`);
    const summary = JSON.parse(await readFile(join(options.out, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      outcome: "schema_valid",
      grammarEnforced: true,
      schemaValid: true,
      httpRequests: 1,
      spentUsd: 0.004,
      stopped: false,
      unresolved: [],
    });
    expect(summary.cumulativeMigrationQaUsd).toBeCloseTo(migrationUnledgeredPriorUsd + 0.004);
    const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8")) as MigrationLedger;
    expect(ledger.rounds).toEqual([
      expect.objectContaining({
        fixtureSet: "gemini-schema-enforcement-probe",
        spentUsd: 0.004,
        inFlightUsd: 0,
        status: "completed",
      }),
    ]);
    expect(printed.join("\n")).not.toContain(key);
    expect(await savedText()).not.toContain(key);
    await expect(run(() => chat(valid), approved)).rejects.toThrow("dispatches once");
    expect(calls).toHaveLength(1);
  });
  it("records prompt-following output as an unenforced grammar", async () => {
    const approved = await live();
    expect(await run(() => chat('{"answer":"beta"}'), approved)).toBe(1);
    const summary = JSON.parse(await readFile(join(options.out, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      outcome: "schema_invalid",
      grammarEnforced: false,
      followedPrompt: true,
      errorCode: "provider_schema_invalid",
      visibleContent: '{"answer":"beta"}',
    });
  });
  it("never dispatches the json_object fallback after a grammar rejection", async () => {
    const approved = await live();
    const rejection = () =>
      new Response(
        JSON.stringify({ error: { message: "Provider schema is too complex for compilation" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    expect(await run(rejection, approved)).toBe(1);
    expect(calls).toHaveLength(1);
    const summary = JSON.parse(await readFile(join(options.out, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      outcome: "fallback_blocked",
      blocked: "unexpected_transport_blocked",
      httpRequests: 1,
      spentUsd: 0,
    });
    const response = JSON.parse(await readFile(join(options.out, "response.json"), "utf8"));
    expect(response.body.error.message).toContain("too complex");
  });
  it("refuses before any dispatch when the shared cumulative cap cannot hold the reserve", async () => {
    const approved = await live();
    const full: MigrationLedger = {
      version: 1,
      priorUnledgeredUsd: migrationUnledgeredPriorUsd,
      rounds: [
        {
          freeze: "c".repeat(64),
          directory: "out/earlier",
          fixtureSet: "multilingual-holdout-4",
          spentUsd: 4.98 - migrationUnledgeredPriorUsd,
          status: "completed",
        },
      ],
    };
    await writeFile(options.ledgerPath, JSON.stringify(full));
    await expect(run(() => chat(valid), approved)).rejects.toThrow(
      "cumulative_budget_before_dispatch",
    );
    expect(calls).toHaveLength(0);
    const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8")) as MigrationLedger;
    expect(ledger.rounds).toHaveLength(1);
  });
  it("keeps an uncertain outcome's reserve counted against the cap", async () => {
    const approved = await live();
    expect(await run(() => new Response("{}", { status: 502 }), approved)).toBe(1);
    const summary = JSON.parse(await readFile(join(options.out, "summary.json"), "utf8"));
    expect(summary).toMatchObject({ outcome: "outcome_unknown", stopped: true });
    expect(summary.unresolved).toHaveLength(1);
    const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8")) as MigrationLedger;
    expect(ledger.rounds[0]?.inFlightUsd).toBeGreaterThan(0);
    expect(ledger.rounds[0]?.status).toBe("stopped");
  });
  it("parses options without reading any credential", () => {
    const parsed = parseSchemaProbeOptions([
      "node",
      "probe",
      "--run-live",
      "--env-file",
      "credentials.env",
      "--catalog-file",
      "catalog.json",
    ]);
    expect(parsed).toMatchObject({ runLive: true, envFile: "credentials.env" });
    expect(parseSchemaProbeOptions(["node", "probe"]).runLive).toBe(false);
    expect(() => parseSchemaProbeOptions(["node", "probe", "--env-file", "--run-live"])).toThrow(
      "Missing --env-file value",
    );
  });
});
