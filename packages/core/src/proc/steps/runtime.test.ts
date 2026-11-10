import type { CompiledQuery } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mockProvider, NOW, RUN_ID, SESSION_ID, USER_ID } from "../../../test/processing-run";
import { statementLogDatabase } from "../../../test/statement-log";
import { ProviderError, type ProviderResult } from "../../aip";
import { AppError, errors, JobCancelled, type JobContext } from "../../plt";
import { providerStep } from "./runtime";

// QUA-01 characterization: providerStep's statements, transaction boundaries, lock and allowance
// calls, attempt numbering and failure records, with the database and its collaborators mocked.
const m = vi.hoisted(() => ({
  log: [] as string[],
  runState: "processing",
  sessionMissing: false,
  contentContract: false,
  finishFailure: undefined as Error | undefined,
  estimate: 1234,
}));
vi.mock("../../acc", () => ({
  lockAccount: vi.fn(async (_tx: unknown, userId: string) => m.log.push(`lockAccount ${userId}`)),
  lockAccountForCleanup: vi.fn(async (_tx: unknown, userId: string) =>
    m.log.push(`lockAccountForCleanup ${userId}`),
  ),
}));
vi.mock("../runs", () => ({
  ownedRun: vi.fn(async (_tx: unknown, _ctx: unknown, id: string, lock: boolean) => {
    m.log.push(`ownedRun ${id} ${lock}`);
    return { id, session_id: SESSION_ID, reservation_id: "reservation", state: m.runState };
  }),
}));
vi.mock("../../org", () => ({
  assertSessionOwner: vi.fn(async (_tx: unknown, _ctx: unknown, id: string) => {
    m.log.push(`assertSessionOwner ${id}`);
    if (m.sessionMissing) throw errors.notFound();
  }),
}));
vi.mock("../../quota", () => ({
  beginProviderStep: vi.fn(async (_tx: unknown, _ctx: unknown, input: unknown, now: Date) => {
    m.log.push(`beginProviderStep ${JSON.stringify(input)} ${now.toISOString()}`);
    return { id: "hold" };
  }),
  finishProviderStep: vi.fn(
    async (_tx: unknown, _ctx: unknown, hold: string, input: unknown, now: Date) => {
      m.log.push(`finishProviderStep ${hold} ${JSON.stringify(input)} ${now.toISOString()}`);
      const failure = m.finishFailure;
      m.finishFailure = undefined;
      if (failure) throw failure;
    },
  ),
}));
vi.mock("../knowledge-contract", () => ({
  usesContentKnowledgeContract: () => m.contentContract,
}));
vi.mock("../../aip", async (original) => ({
  ...(await original<object>()),
  maximumProviderCost: () => 9000,
  readEstimateRates: vi.fn(async () => {
    m.log.push("readEstimateRates");
    return { version: "rates-1", rates: { synthetic: 1 } };
  }),
  estimateRatesSchema: { parse: (value: unknown) => value },
  estimatedUsageCost: (_rates: unknown, model: string, usage: unknown, kind: string) => {
    m.log.push(`estimatedUsageCost ${model} ${JSON.stringify(usage)} ${kind}`);
    return m.estimate;
  },
}));

const ctx = { userId: USER_ID, requestId: "runtime-test" };
const ATTEMPT = "66666666-6666-4666-8666-666666666666";
const provider = mockProvider();
const schema = z.object({ ok: z.union([z.string(), z.boolean()]) });
const accounting = {
  provider: "synthetic",
  model: "synthetic/llm",
  requestId: "request-1",
  usage: { inputTokens: 10 },
  actualMicros: null,
};

interface Fixture {
  /** Each checkpoint read in turn; absent reads find none. */
  checkpoints?: unknown[];
  previous?: Record<string, unknown>;
  attempts?: Record<string, unknown>[];
  current?: Record<string, unknown>;
}
/** Labels the statements providerStep writes; any other statement shows its whole SQL. */
function label(query: CompiledQuery): string {
  const text = query.sql;
  if (text.startsWith('select "output" from "proc"."run_step"')) return "read checkpoint";
  if (text.startsWith('select * from "proc"."provider_attempt"')) return "read last attempt";
  if (text.startsWith('select "state", "error_code" from "proc"."provider_attempt"'))
    return text.includes('"step" in') ? "read generation attempts" : "read step attempts";
  if (text.startsWith('insert into "proc"."provider_attempt"')) return "insert attempt";
  if (text.startsWith('select "state", "provider_request_id" from "proc"."provider_attempt"'))
    return text.endsWith("for update") ? "lock attempt" : text;
  if (text.startsWith('update "proc"."provider_attempt"')) return "update attempt";
  if (text.startsWith('insert into "proc"."run_step"')) return "save step";
  return text;
}
function setup(fixture: Fixture = {}) {
  const { db, log, statements } = statementLogDatabase((query) => {
    const name = label(query);
    if (name === "read checkpoint") {
      const output = fixture.checkpoints?.shift();
      return output === undefined ? [] : [{ output }];
    }
    if (name === "read last attempt") return fixture.previous ? [fixture.previous] : [];
    if (name === "read generation attempts" || name === "read step attempts")
      return fixture.attempts ?? [];
    if (name === "insert attempt")
      return [
        {
          id: ATTEMPT,
          operation_key: query.parameters[4],
          hold_id: "hold",
          provider: query.parameters[6],
          model: query.parameters[7],
          estimate_rates: { synthetic: 1 },
          estimate_price_version: "rates-1",
        },
      ];
    if (name === "lock attempt")
      return [fixture.current ?? { state: "started", provider_request_id: null }];
    return [];
  });
  m.log = log;
  const warnings: unknown[] = [];
  const job = {
    db,
    now: () => NOW,
    job: { id: "job", attempt: 2 },
    log: (...args: unknown[]) => warnings.push(args),
    step: vi.fn(),
  } as unknown as JobContext;
  const statement = (name: string) => statements.find((query) => label(query) === name);
  return { job, log, statements, warnings, statement };
}
const labelled = (log: string[], statements: CompiledQuery[]) => {
  let index = 0;
  return log.map((entry) =>
    statements[index]?.sql === entry ? label(statements[index++] as CompiledQuery) : entry,
  );
};
const result = (output: unknown, actualMicros: number | null = 700): ProviderResult<unknown> => ({
  output,
  provider: "synthetic",
  model: "synthetic/llm",
  requestId: "request-1",
  usage: { inputTokens: 10 },
  actualMicros,
});
const holdInput = (step: string, attempt = 1) =>
  `beginProviderStep ${JSON.stringify({
    sessionId: SESSION_ID,
    reservationId: "reservation",
    operationKey: `${RUN_ID}:${step}:${attempt}`,
    maximumMicros: 9000,
    currency: "USD",
  })} ${NOW.toISOString()}`;
const dispatch = [
  "read checkpoint",
  "readEstimateRates",
  "begin",
  `lockAccount ${USER_ID}`,
  `ownedRun ${RUN_ID} true`,
  `assertSessionOwner ${SESSION_ID}`,
  "read last attempt",
];

beforeEach(() => {
  m.runState = "processing";
  m.sessionMissing = false;
  m.contentContract = false;
  m.finishFailure = undefined;
  m.estimate = 1234;
});

describe("providerStep (characterization)", () => {
  it("returns a saved checkpoint without any other read", async () => {
    const { job, log } = setup({ checkpoints: [{ ok: "saved" }] });
    const effect = vi.fn();
    expect(
      await providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, effect),
    ).toEqual({ ok: "saved" });
    expect(log).toEqual([
      'select "output" from "proc"."run_step" where "run_id" = $1 and "step" = $2',
    ]);
    expect(effect).not.toHaveBeenCalled();
  });

  it("commits the attempt and hold, dispatches once, then settles and saves in one commit", async () => {
    const { job, log, statements, statement } = setup();
    const onCommit = vi.fn(async () => {
      log.push("onCommit");
    });
    const effect = vi.fn(async (key: string) => {
      log.push(`effect ${key}`);
      return result({ ok: "fresh" });
    });
    const output = await providerStep(
      job,
      ctx,
      RUN_ID,
      "knowledge",
      "synthetic/llm",
      provider,
      schema,
      effect,
      { onCommit },
    );
    expect(output).toEqual({ ok: "fresh" });
    expect(labelled(log, statements)).toEqual([
      ...dispatch,
      holdInput("knowledge"),
      "insert attempt",
      "commit",
      `effect ${RUN_ID}:knowledge:1`,
      "begin",
      `lockAccountForCleanup ${USER_ID}`,
      `finishProviderStep hold ${JSON.stringify({
        operationKey: `${RUN_ID}:knowledge:1`,
        provider: "synthetic",
        model: "synthetic/llm",
        currency: "USD",
        actualMicros: 700,
        estimatedMicros: null,
        priceVersion: "rates-1",
        usage: { inputTokens: 10 },
        runId: RUN_ID,
        attemptId: ATTEMPT,
      })} ${NOW.toISOString()}`,
      "update attempt",
      `ownedRun ${RUN_ID} true`,
      `assertSessionOwner ${SESSION_ID}`,
      "onCommit",
      "save step",
      "commit",
    ]);
    expect(statement("insert attempt")?.parameters).toEqual([
      RUN_ID,
      USER_ID,
      "knowledge",
      1,
      `${RUN_ID}:knowledge:1`,
      "hold",
      "synthetic",
      "synthetic/llm",
      JSON.stringify({ synthetic: 1 }),
      "rates-1",
      NOW,
    ]);
    expect(statement("update attempt")?.parameters).toEqual([
      "succeeded",
      "request-1",
      NOW,
      ATTEMPT,
    ]);
    expect(statement("save step")?.parameters).toEqual([
      RUN_ID,
      "knowledge",
      JSON.stringify({ ok: "fresh" }),
      NOW,
    ]);
  });

  it.each([
    ["stt:chunk", "transcription"],
    ["vision:photo", "vision"],
    ["speech", "tts"],
    ["knowledge", "generation"],
  ])("estimates a %s call without an actual cost as %s", async (step, kind) => {
    const { job, log } = setup();
    await providerStep(job, ctx, RUN_ID, step, "m", provider, schema, async () =>
      result({ ok: true }, null),
    );
    expect(log).toContain(`estimatedUsageCost synthetic/llm {"inputTokens":10} ${kind}`);
    expect(log.find((entry) => entry.startsWith("finishProviderStep"))).toContain(
      '"actualMicros":null,"estimatedMicros":1234',
    );
  });

  // P5-02 (P4-04 nit): an estimate within the hold logs nothing; one above it is recorded
  // unchanged, never clamped to the hold, and logged once with numbers and identifiers only.
  it("logs an estimate above its hold with numbers only and records it unchanged", async () => {
    const within = setup();
    m.estimate = 9000;
    await providerStep(within.job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () =>
      result({ ok: true }, null),
    );
    expect(within.warnings).toEqual([]);

    const above = setup();
    m.estimate = 12_500;
    await providerStep(above.job, ctx, RUN_ID, "vision:photo", "m", provider, schema, async () =>
      result({ ok: true }, null),
    );
    expect(above.log.find((entry) => entry.startsWith("finishProviderStep"))).toContain(
      '"actualMicros":null,"estimatedMicros":12500',
    );
    expect(above.log).toContain(holdInput("vision:photo"));
    expect(above.warnings).toEqual([
      [
        "warn",
        "provider_estimate_above_hold",
        {
          module: "proc",
          job_id: "job",
          attempt: 2,
          kind: "vision",
          measured: 12_500,
          hold_micros: 9000,
        },
      ],
    ]);
    // P6-03: the hold has its own field; the guard's production_limit is not reused.
    expect((above.warnings[0] as unknown[])[2]).not.toHaveProperty("production_limit");

    // The same for a definite failure settled at its estimated cost.
    const failed = setup();
    m.estimate = 12_500;
    await expect(
      providerStep(failed.job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () => {
        throw new ProviderError("provider_http_500", false, false, accounting);
      }),
    ).rejects.toMatchObject({ code: "provider_http_500" });
    expect(failed.log.find((entry) => entry.startsWith("finishProviderStep"))).toContain(
      '"actualMicros":null,"estimatedMicros":12500',
    );
    expect(failed.warnings[0]).toEqual([
      "warn",
      "provider_estimate_above_hold",
      {
        module: "proc",
        job_id: "job",
        attempt: 2,
        kind: "generation",
        measured: 12_500,
        hold_micros: 9000,
      },
    ]);
    expect((failed.warnings[0] as unknown[])[2]).not.toHaveProperty("production_limit");

    // An estimate equal to the hold is not above it and logs nothing.
    const equal = setup();
    m.estimate = 9000;
    await providerStep(equal.job, ctx, RUN_ID, "vision:photo", "m", provider, schema, async () =>
      result({ ok: true }, null),
    );
    expect(equal.log.find((entry) => entry.startsWith("finishProviderStep"))).toContain(
      '"actualMicros":null,"estimatedMicros":9000',
    );
    expect(equal.warnings).toEqual([]);
  });

  it("numbers the next attempt after a definite failure", async () => {
    const { job, log, statement } = setup({ previous: { attempt: 2, state: "failed" } });
    await providerStep(job, ctx, RUN_ID, "vision:p", "m", provider, schema, async (key) => {
      log.push(`effect ${key}`);
      return result({ ok: true });
    });
    expect(log).toContain(holdInput("vision:p", 3));
    expect(statement("insert attempt")?.parameters[3]).toBe(3);
  });

  it("reuses a concurrent single response under the dispatch lock", async () => {
    // The optimistic read misses; the read under the account lock finds the other response.
    const { job, log, statements } = setup({ checkpoints: [undefined, { ok: "theirs" }] });
    const effect = vi.fn();
    const output = await providerStep(
      job,
      ctx,
      RUN_ID,
      "evaluation",
      "m",
      provider,
      schema,
      effect,
      {
        singleResponse: true,
      },
    );
    expect(output).toEqual({ ok: "theirs" });
    expect(effect).not.toHaveBeenCalled();
    expect(labelled(log, statements)).toEqual([
      "read checkpoint",
      "readEstimateRates",
      "begin",
      `lockAccount ${USER_ID}`,
      `ownedRun ${RUN_ID} true`,
      `assertSessionOwner ${SESSION_ID}`,
      "read checkpoint",
      "commit",
    ]);
  });

  // P9-05 (C9-1, C8-3; E215-R, E216): a job stopped during dispatch left its attempt started (or
  // uncertain) with its maximum hold open. The next run of the same step closes that hold at the
  // hold's maximum and commits, then reports the outcome as unresolved: no dispatch, no retry,
  // and the attempt is not written, so it stays started or uncertain for the retry guards.
  const PREVIOUS = "77777777-7777-4777-8777-777777777777";
  const unresolvedAttempt = (step: string, state: string, error_code: string | null) => ({
    id: PREVIOUS,
    run_id: RUN_ID,
    step,
    attempt: 1,
    state,
    error_code,
    operation_key: `${RUN_ID}:${step}:1`,
    hold_id: "previous-hold",
    provider: "earlier-provider",
    model: "earlier/model",
    estimate_price_version: null,
    provider_request_id: state === "uncertain" ? "request-0" : null,
  });
  it.each([
    ["started", null],
    ["uncertain", "provider_outcome_unknown"],
  ])(
    "closes the hold of an attempt left %s at its maximum, keeps its state and does not dispatch",
    async (state, earlierCode) => {
      const { job, log, statements, warnings } = setup({
        previous: unresolvedAttempt("knowledge", state, earlierCode),
      });
      const effect = vi.fn();
      await expect(
        providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, effect),
      ).rejects.toMatchObject({
        code: "provider_outcome_unresolved",
        retryable: false,
        uncertain: true,
      });
      expect(effect).not.toHaveBeenCalled();
      expect(labelled(log, statements)).toEqual([
        ...dispatch,
        `finishProviderStep previous-hold ${JSON.stringify({
          operationKey: `${RUN_ID}:knowledge:1`,
          provider: "earlier-provider",
          model: "earlier/model",
          currency: "USD",
          actualMicros: null,
          estimatedMicros: "hold_maximum",
          priceVersion: provider.settings.priceVersion,
          usage: {},
          runId: RUN_ID,
          attemptId: PREVIOUS,
        })} ${NOW.toISOString()}`,
        "commit",
      ]);
      // The attempt is neither failed nor otherwise written (E215-R).
      expect(statements.filter((query) => label(query) === "update attempt")).toEqual([]);
      expect(labelled(log, statements)).not.toContain("insert attempt");
      expect(log.some((entry) => entry.startsWith("beginProviderStep"))).toBe(false);
      expect(warnings).toEqual([]);
    },
  );

  // C9-1: the same holds for every provider step, whatever its kind or response rule.
  it.each([
    ["stt:chunk-1", {}],
    ["vision:page-2", {}],
    ["speech", {}],
    ["knowledge:compact", {}],
    ["evaluation", { singleResponse: true }],
  ])("closes an unresolved %s attempt's hold before refusing it", async (step, options) => {
    const { job, log, statements } = setup({
      previous: unresolvedAttempt(step, "started", null),
    });
    const effect = vi.fn();
    await expect(
      providerStep(job, ctx, RUN_ID, step, "m", provider, schema, effect, options),
    ).rejects.toMatchObject({ code: "provider_outcome_unresolved", uncertain: true });
    expect(effect).not.toHaveBeenCalled();
    const settled = log.filter((entry) => entry.startsWith("finishProviderStep"));
    expect(settled).toHaveLength(1);
    expect(settled[0]).toContain(
      `"operationKey":"${RUN_ID}:${step}:1","provider":"earlier-provider","model":"earlier/model"`,
    );
    expect(settled[0]).toContain('"actualMicros":null,"estimatedMicros":"hold_maximum"');
    expect(labelled(log, statements).slice(-2)).toEqual([settled[0], "commit"]);
    expect(statements.filter((query) => label(query) === "update attempt")).toEqual([]);
  });

  it("refuses a second single response unless every earlier one was an HTTP refusal", async () => {
    const recorded = setup({
      previous: { attempt: 1, state: "failed" },
      attempts: [{ state: "failed", error_code: "provider_http_503" }],
    });
    await providerStep(
      recorded.job,
      ctx,
      RUN_ID,
      "evaluation",
      "m",
      provider,
      schema,
      async () => result({ ok: true }),
      { singleResponse: true },
    );
    expect(labelled(recorded.log, recorded.statements).slice(6, 10)).toEqual([
      "read checkpoint",
      "read last attempt",
      "read step attempts",
      holdInput("evaluation", 2),
    ]);
    const paid = setup({
      previous: { attempt: 1, state: "failed" },
      attempts: [{ state: "failed", error_code: "provider_schema_invalid" }],
    });
    await expect(
      providerStep(paid.job, ctx, RUN_ID, "evaluation", "m", provider, schema, vi.fn(), {
        singleResponse: true,
      }),
    ).rejects.toMatchObject({
      code: "provider_schema_invalid",
      retryable: false,
      uncertain: false,
    });
    const unnamed = setup({
      previous: { attempt: 1, state: "succeeded" },
      attempts: [{ state: "succeeded", error_code: null }],
    });
    await expect(
      providerStep(unnamed.job, ctx, RUN_ID, "evaluation", "m", provider, schema, vi.fn(), {
        singleResponse: true,
      }),
    ).rejects.toMatchObject({ code: "provider_response_already_recorded" });
  });

  it("allows a content-contract lesson two generation dispatches across its steps", async () => {
    m.contentContract = true;
    const refusals = [
      { state: "failed", error_code: "provider_http_429" },
      { state: "failed", error_code: "provider_request_too_large" },
    ];
    const one = setup({ attempts: [...refusals, { state: "succeeded", error_code: null }] });
    await providerStep(one.job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () =>
      result({ ok: true }),
    );
    expect(labelled(one.log, one.statements)).toContain("read generation attempts");
    const two = setup({
      attempts: [
        { state: "succeeded", error_code: null },
        { state: "failed", error_code: "provider_http_500" },
      ],
    });
    await expect(
      providerStep(two.job, ctx, RUN_ID, "knowledge:compact", "m", provider, schema, vi.fn()),
    ).rejects.toMatchObject({ details: { fields: { output: ["knowledge_repair_exhausted"] } } });
    m.contentContract = false;
    const other = setup({ attempts: [{ state: "succeeded" }, { state: "succeeded" }] });
    await providerStep(other.job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () =>
      result({ ok: true }),
    );
    expect(labelled(other.log, other.statements)).not.toContain("read generation attempts");
  });

  it.each([
    "knowledge:repair",
    "knowledge:repair-language",
    "knowledge:study-repair",
    "knowledge:compact",
  ])("gives the bounded correction %s one paid dispatch", async (step) => {
    const { job } = setup({ previous: { attempt: 1, state: "failed" } });
    await expect(
      providerStep(job, ctx, RUN_ID, step, "m", provider, schema, vi.fn()),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("records a paid invalid content-contract lesson with its diagnostic only", async () => {
    m.contentContract = true;
    const { job, log, statements, warnings } = setup();
    const failure = new ProviderError(
      "provider_schema_invalid",
      false,
      false,
      accounting,
      "zod:invalid_type@title",
    );
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "requested/model", provider, schema, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const steps = labelled(log, statements);
    expect(steps.slice(steps.indexOf("commit") + 1)).toEqual([
      "begin",
      `lockAccountForCleanup ${USER_ID}`,
      "lock attempt",
      `estimatedUsageCost requested/model {"inputTokens":10} generation`,
      `finishProviderStep hold ${JSON.stringify({
        operationKey: `${RUN_ID}:knowledge:1`,
        provider: "synthetic",
        model: "synthetic/llm",
        currency: "USD",
        actualMicros: null,
        estimatedMicros: 1234,
        priceVersion: "rates-1",
        usage: { inputTokens: 10 },
        runId: RUN_ID,
        attemptId: ATTEMPT,
      })} ${NOW.toISOString()}`,
      "update attempt",
      "save step",
      "commit",
    ]);
    const saved = statements.filter((query) => label(query) === "save step");
    expect(saved.map((query) => query.parameters.slice(0, 3))).toEqual([
      [
        RUN_ID,
        "knowledge:schema-invalid",
        JSON.stringify({
          reason: "provider_schema_invalid",
          attemptId: ATTEMPT,
          detail: "zod:invalid_type@title",
        }),
      ],
    ]);
    expect(statements.find((query) => label(query) === "update attempt")?.parameters).toEqual([
      "failed",
      "provider_schema_invalid",
      "request-1",
      NOW,
      ATTEMPT,
    ]);
    expect(warnings).toEqual([
      [
        "warn",
        "provider_step_failed",
        {
          module: "proc",
          job_id: "job",
          attempt: 2,
          code: "provider_schema_invalid",
          cause_code: undefined,
          state: "failed",
        },
      ],
    ]);
  });

  it("records a paid truncated lesson for the compact recovery", async () => {
    const { job, statements } = setup();
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () => {
        throw new ProviderError("provider_output_truncated", false, false, {
          ...accounting,
          actualMicros: 50,
        });
      }),
    ).rejects.toMatchObject({ code: "provider_output_truncated" });
    expect(
      statements
        .filter((query) => label(query) === "save step")
        .map((query) => query.parameters.slice(1, 3)),
    ).toEqual([
      [
        "knowledge:truncated",
        JSON.stringify({ reason: "provider_output_truncated", attemptId: ATTEMPT }),
      ],
    ]);
  });

  it("charges a parsed response that fails its schema as a definite failure", async () => {
    const { job, log, statements } = setup();
    await expect(
      providerStep(job, ctx, RUN_ID, "vision:p", "m", provider, schema, async () =>
        result({ wrong: true }),
      ),
    ).rejects.toMatchObject({ code: "provider_schema_invalid", uncertain: false });
    expect(log.find((entry) => entry.startsWith("finishProviderStep"))).toContain(
      '"actualMicros":700,"estimatedMicros":null',
    );
    expect(statements.filter((query) => label(query) === "save step")).toEqual([]);
  });

  // P9-05 (C9-2; E215-R): an unknown outcome is not repeated; its hold closes at the hold's
  // maximum and the attempt is recorded uncertain (never failed), in the same commit, for every
  // provider step.
  it.each([
    ["knowledge", () => new Error("socket closed"), "provider_outcome_unknown", null],
    ["stt:chunk-1", () => new Error("socket closed"), "provider_outcome_unknown", null],
    [
      "speech",
      () => new ProviderError("provider_timeout", false, true, accounting),
      "provider_timeout",
      "request-1",
    ],
    [
      "vision:page-2",
      () => new ProviderError("provider_timeout", false, true),
      "provider_timeout",
      null,
    ],
  ])(
    "closes the hold of an uncertain %s outcome at its maximum and keeps the attempt uncertain",
    async (step, failure, code, requestId) => {
      const { job, log, statements, warnings } = setup();
      const effect = vi.fn(async () => {
        throw failure();
      });
      await expect(
        providerStep(job, ctx, RUN_ID, step, "synthetic/llm", provider, schema, effect),
      ).rejects.toMatchObject({ code, retryable: false, uncertain: true });
      expect(effect).toHaveBeenCalledTimes(1);
      const steps = labelled(log, statements);
      expect(steps.slice(steps.indexOf("commit") + 1)).toEqual([
        "begin",
        `lockAccountForCleanup ${USER_ID}`,
        "lock attempt",
        `finishProviderStep hold ${JSON.stringify({
          operationKey: `${RUN_ID}:${step}:1`,
          provider: "synthetic",
          model: "synthetic/llm",
          currency: "USD",
          actualMicros: null,
          estimatedMicros: "hold_maximum",
          priceVersion: "rates-1",
          usage: {},
          runId: RUN_ID,
          attemptId: ATTEMPT,
        })} ${NOW.toISOString()}`,
        "update attempt",
        "commit",
      ]);
      expect(statements.find((query) => label(query) === "update attempt")?.parameters).toEqual([
        "uncertain",
        code,
        requestId,
        NOW,
        ATTEMPT,
      ]);
      expect(statements.filter((query) => label(query) === "save step")).toEqual([]);
      expect(log.filter((entry) => entry.startsWith("beginProviderStep"))).toHaveLength(1);
      expect(warnings).toHaveLength(1);
    },
  );

  it("does not settle an uncertain outcome another worker already settled", async () => {
    const { job, log, statements } = setup({
      current: { state: "succeeded", provider_request_id: "x" },
    });
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () => {
        throw new Error("socket closed");
      }),
    ).rejects.toMatchObject({ code: "provider_outcome_unknown", uncertain: true });
    expect(log.some((entry) => entry.startsWith("finishProviderStep"))).toBe(false);
    expect(statements.filter((query) => label(query) === "update attempt")).toEqual([]);
  });

  it("settles a paid response whose commit failed as provider_output_commit_failed", async () => {
    m.finishFailure = new Error("connection reset");
    const { job, log } = setup();
    const failure = providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () =>
      result({ ok: true }),
    );
    await expect(failure).rejects.toMatchObject({
      code: "provider_output_commit_failed",
      uncertain: false,
    });
    const settled = log.filter((entry) => entry.startsWith("finishProviderStep"));
    expect(settled).toHaveLength(2);
    expect(settled[1]).toContain('"actualMicros":700');
  });

  it("does not rewrite an attempt another worker already settled", async () => {
    const { job, statements } = setup({
      current: { state: "succeeded", provider_request_id: "x" },
    });
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () => {
        throw new ProviderError("provider_http_500", true, false, accounting);
      }),
    ).rejects.toMatchObject({ code: "provider_http_500" });
    expect(statements.filter((query) => label(query) === "update attempt")).toEqual([]);
  });

  it.each([
    ["a run that ended meanwhile", () => (m.runState = "cancelled")],
    ["a deleted class", () => (m.sessionMissing = true)],
  ])("keeps the accounting of %s and cancels the job", async (_name, change) => {
    const { job, log, statements } = setup();
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, async () => {
        change();
        return result({ ok: true });
      }),
    ).rejects.toBeInstanceOf(JobCancelled);
    expect(log.filter((entry) => entry.startsWith("finishProviderStep"))).toHaveLength(1);
    expect(statements.filter((query) => label(query) === "save step")).toEqual([]);
    expect(log.at(-1)).toBe("commit");
  });

  it("does not dispatch for a run that is no longer live", async () => {
    m.runState = "failed";
    const { job, log } = setup();
    const effect = vi.fn();
    await expect(
      providerStep(job, ctx, RUN_ID, "knowledge", "m", provider, schema, effect),
    ).rejects.toBeInstanceOf(JobCancelled);
    expect(effect).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe("rollback");
  });
});
