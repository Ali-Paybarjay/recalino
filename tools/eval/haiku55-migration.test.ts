import { mkdtemp, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import {
  freshMigrationFixtures,
  migrationFixtureSchema,
  migrationInputData,
} from "./haiku55-migration-fixtures";
import {
  assertMigrationDispatchAllowed,
  assertMigrationLedgerAvailable,
  assertMigrationPlanFrozen,
  type MigrationRequest,
  migrationAutomaticGateFailure,
  migrationBoundaryGateFailure,
  migrationControlInterruptionResult,
  migrationControls,
  migrationInitialRecovery,
  migrationPlanDate,
  migrationReportedModelMatches,
  migrationRequestReserve,
  migrationSoftBudgetStop,
  migrationTransportGateFailure,
  migrationTransportMatchesAdoptionGate,
  migrationUnexpectedTransport,
  migrationUnledgeredPriorUsd,
  readMigrationRecordedJson,
  selectMigrationDiagnosticCases,
  selectMigrationSmokeCases,
} from "./haiku55-migration-guards";

const completed: MigrationRequest = {
  id: "synthetic-dispatch",
  caseId: "M01",
  stage: "generation",
  state: "completed",
  reserveUsd: 0.02,
  costUsd: 0.005,
};
describe("PRD-COST-02 opt-in migration evaluation controls", () => {
  it.each(["started", "uncertain"] as const)(
    "never repeats a %s outcome even at zero recorded spend",
    (state) => {
      expect(() => assertMigrationDispatchAllowed([{ ...completed, state }], 0, 0.02, 1)).toThrow(
        "unresolved_dispatch_do_not_retry",
      );
    },
  );
  it("bounds each paid correction and reserves before dispatch", () => {
    expect(() => assertMigrationDispatchAllowed([], 0, 0.02, 3)).toThrow("case_generation_limit");
    expect(() => assertMigrationDispatchAllowed([], 0.74, 0.02, 1)).toThrow(
      "hard_budget_before_dispatch",
    );
    expect(() =>
      assertMigrationDispatchAllowed(
        Array.from({ length: 28 }, () => completed),
        0.2,
        0.02,
        1,
      ),
    ).toThrow("paid_response_limit");
    expect(() => assertMigrationDispatchAllowed([], 0.1, 0.02, 2)).not.toThrow();
  });
  it("reserves the expensive context tier and UTF-8 input, not a presumed English token count", () => {
    const result = migrationRequestReserve(
      {
        data: [
          {
            id: "synthetic",
            pricing: {
              prompt: "0.0000001",
              completion: "0.0000005",
              overrides: [{ prompt: "0.0000005", completion: "0.0000025" }],
            },
          },
        ],
      },
      "synthetic",
      "فارسی",
      12000,
    );
    expect(result.inputTokenCeiling).toBe(Buffer.byteLength("فارسی", "utf8"));
    expect(result.reserveUsd).toBeCloseTo(
      result.inputTokenCeiling * 0.0000005 * 1.1 + 12000 * 0.0000025 * 1.1,
    );
    expect(migrationControls.adoptionGates.unexpectedTransportFallbacks).toBe(0);
    expect(migrationControls.adoptionGates).not.toHaveProperty("nativeSchemaAcceptanceClaimed");
    expect(migrationControls.adoptionGates.expectedTransport).toBe(
      "declared direct json_object or strict json_schema",
    );
  });
});
describe("PRD-PRIV-06 synthetic migration acceptance fixtures", () => {
  it("contains ten historical cases plus four fresh cases with frozen independent answer keys", async () => {
    const old = JSON.parse(
      await readFile(
        new URL("./haiku55-migration-regression-fixtures.json", import.meta.url),
        "utf8",
      ),
    ) as { cases: unknown[]; repeatCaseIds: string[] };
    const cases = old.cases.map((entry) => migrationFixtureSchema.parse(entry));
    expect(cases).toHaveLength(8);
    expect(old.repeatCaseIds).toEqual(["H04", "H06"]);
    expect(freshMigrationFixtures()).toHaveLength(4);
    expect(cases.length + old.repeatCaseIds.length + freshMigrationFixtures().length).toBe(14);
  });
  it("never projects ground truth, forbidden errors or grading instructions into model input", () => {
    for (const fixture of freshMigrationFixtures()) {
      const input = migrationInputData(fixture);
      expect(input).not.toHaveProperty("expected");
      expect(JSON.stringify(input)).not.toContain("criticalFacts");
      expect(JSON.stringify(input)).not.toContain("forbiddenErrors");
      expect(fixture.expected.requiredConceptIds).toBeDefined();
      const concepts = fixture.expected.concepts as {
        supporting: { sourceId: string; blockId: string }[];
      }[];
      for (const concept of concepts)
        for (const support of concept.supporting) {
          expect(
            fixture.sources
              .find((entry) => entry.sourceId === support.sourceId)
              ?.blocks.some((block) => block.id === support.blockId),
          ).toBe(true);
        }
    }
  });
});

describe("PRD-COST-02 safe migration case boundaries", () => {
  it("closes an unreachable first-pass gate before starting another case", () => {
    expect(migrationAutomaticGateFailure([{ firstGenerationPass: false }])).toBeUndefined();
    expect(
      migrationAutomaticGateFailure([
        { firstGenerationPass: false, finalLocalPass: true },
        { firstGenerationPass: false, finalLocalPass: true },
      ]),
    ).toBe("first_generation_gate_unreachable");
    expect(migrationAutomaticGateFailure([{ finalLocalPass: false }])).toBe(
      "final_local_validity_gate_failed",
    );
  });
  it("does not label a blocked local correction as an unknown paid request", () => {
    expect(migrationControlInterruptionResult("operator_requested", [completed])).toMatchObject({
      finalValidationStatus: "control_interrupted",
      providerAccountingUncertain: false,
    });
    expect(migrationControlInterruptionResult(undefined, [completed])).toBeUndefined();
    expect(
      migrationControlInterruptionResult("operator_requested", [
        { ...completed, state: "uncertain" },
      ]),
    ).toBeUndefined();
    expect(() =>
      assertMigrationDispatchAllowed([{ ...completed, state: "uncertain" }], 0, 0.02, 1),
    ).toThrow("unresolved_dispatch_do_not_retry");
  });
});

describe("PRD-COST-02 known first-output recovery and recorded history", () => {
  it("uses the original full budget for schema repair and compact budget only for truncation", () => {
    expect(
      migrationInitialRecovery({
        code: "provider_schema_invalid",
        uncertain: false,
        accounted: true,
      }),
    ).toEqual({
      stage: "schema-repair",
      marker: "knowledge:schema-invalid",
      compact: false,
      repairReason: "provider_schema_invalid",
    });
    expect(
      migrationInitialRecovery({
        code: "provider_output_truncated",
        uncertain: false,
        accounted: true,
      }),
    ).toEqual({ stage: "compact", marker: "knowledge:truncated", compact: true });
  });
  it.each([
    { code: "provider_schema_invalid", uncertain: true, accounted: true },
    { code: "provider_schema_invalid", uncertain: false, accounted: false },
    { code: "provider_outcome_unknown", uncertain: true, accounted: false },
    { code: "provider_request_schema_too_complex", uncertain: false, accounted: false },
  ])(
    "does not authorize another payment for $code / uncertain=$uncertain / accounted=$accounted",
    (error) => {
      expect(migrationInitialRecovery(error)).toBeUndefined();
    },
  );
  it("refuses to reset malformed saved history as if no paid calls had happened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recalino-migration-state-"));
    const path = join(directory, "state.json");
    try {
      expect(await readMigrationRecordedJson(path)).toBeUndefined();
      await writeFile(path, "{invalid recorded state");
      await expect(readMigrationRecordedJson(path)).rejects.toBeInstanceOf(SyntaxError);
      await writeFile(path, '{"requests":[{"state":"uncertain"}]}');
      expect(await readMigrationRecordedJson(path)).toEqual({ requests: [{ state: "uncertain" }] });
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
  });
});

describe("PRD-QA-01 unreplayed remaining-case diagnostics", () => {
  const original = Array.from({ length: 14 }, (_, index) => ({
    caseId: index === 12 ? "M03-13" : index === 13 ? "M04-14" : `H-${index}`,
    fixture: { id: index === 12 ? "M03" : index === 13 ? "M04" : `H${index}` },
  }));
  it("preserves original ordinals and selects only both unseen remaining lessons", () => {
    const selected = selectMigrationDiagnosticCases(original, "M03,M04");
    expect(selected.diagnosticOnly).toBe(true);
    expect(selected.schedule.map((entry) => entry.caseId)).toEqual(["M03-13", "M04-14"]);
    expect(selected.schedule[0]).toBe(original[12]);
    expect(selectMigrationDiagnosticCases(original, undefined)).toEqual({
      diagnosticOnly: false,
      schedule: original,
    });
  });
  it.each(["M03", "M04", "M04,M03", "M01,M02", "M03,M03", "H01,M03"])(
    "rejects unauthorized scope %s",
    (ids) => {
      expect(() => selectMigrationDiagnosticCases(original, ids)).toThrow("diagnostic_scope");
    },
  );
  it("rejects reindexed diagnostic identities and cannot raise dispatch limits", () => {
    expect(() =>
      selectMigrationDiagnosticCases(
        [
          { caseId: "M03-1", fixture: { id: "M03" } },
          { caseId: "M04-2", fixture: { id: "M04" } },
        ],
        "M03,M04",
      ),
    ).toThrow("original_ordinals");
    expect(() =>
      assertMigrationDispatchAllowed(
        Array.from({ length: 4 }, () => completed),
        0.02,
        0.02,
        1,
        { maximumPaidResponses: 4, maximumHttpRequests: 4 },
      ),
    ).toThrow("http_request_limit");
    expect(() =>
      assertMigrationDispatchAllowed([], 0, 0.02, 1, {
        maximumPaidResponses: 29,
        maximumHttpRequests: 56,
      }),
    ).toThrow("invalid_dispatch_limits");
  });
});

describe("FR-QUOTA-009 candidate acceptance, smoke and probe dispatch limits", () => {
  const paid = (count: number) => Array.from({ length: count }, () => completed);
  it("keeps the adoption and comparison limits, gates and generation cap unchanged", () => {
    expect(migrationControls).toMatchObject({
      maximumGenerationsPerCase: 2,
      maximumPaidResponses: 28,
      maximumHttpRequests: 56,
      softUsd: 0.5,
      hardUsd: 0.75,
      comparison: { maximumPaidResponses: 44, maximumHttpRequests: 88, hardUsd: 1.6 },
    });
    expect(migrationControls.adoptionGates).toEqual({
      finalLocalPasses: "14/14",
      firstGenerationPasses: ">=13/14",
      expectedTransport: "declared direct json_object or strict json_schema",
      unexpectedTransportFallbacks: 0,
      criticalTeachingGroundingAttributionInjectionErrors: 0,
      allRequiredConceptsAdequatelyTaught: true,
      minimumMeanQualityEachCase: 3,
      qualityScale: "0-4: correctness, grounding, coverage, learner fit, clarity/card usability",
    });
    expect(() => assertMigrationDispatchAllowed([], 0.74, 0.02, 1, undefined, "adoption")).toThrow(
      "hard_budget_before_dispatch",
    );
    expect(() => assertMigrationDispatchAllowed(paid(28), 0, 0.02, 1)).toThrow(
      "paid_response_limit",
    );
    expect(() =>
      assertMigrationDispatchAllowed(paid(43), 0.5, 0.02, 1, undefined, "comparison"),
    ).not.toThrow();
    expect(() =>
      assertMigrationDispatchAllowed(paid(44), 0.5, 0.02, 1, undefined, "comparison"),
    ).toThrow("paid_response_limit");
    expect(() =>
      assertMigrationDispatchAllowed([], 1.59, 0.02, 1, undefined, "comparison"),
    ).toThrow("hard_budget_before_dispatch");
  });
  it("caps every QA round, probe and diagnostic at the owner-approved 5 USD total", () => {
    expect(migrationControls.cumulativeHardUsd).toBe(5);
  });
  it("bounds candidate acceptance at 16 paid, 32 HTTP and 1.20 USD with a 0.90 soft pause", () => {
    expect(migrationControls.candidateAcceptance).toEqual({
      maximumPaidResponses: 16,
      maximumHttpRequests: 32,
      softUsd: 0.9,
      hardUsd: 1.2,
    });
    // One dispatch reserved at the most expensive ZDR price is about 0.263 USD.
    const reserve = 0.263;
    const mode = "candidate-acceptance";
    expect(() =>
      assertMigrationDispatchAllowed(paid(15), 0.93, reserve, 1, undefined, mode),
    ).not.toThrow();
    expect(() =>
      assertMigrationDispatchAllowed(paid(15), 0.95, reserve, 1, undefined, mode),
    ).toThrow("hard_budget_before_dispatch");
    expect(() =>
      assertMigrationDispatchAllowed(paid(16), 0.5, reserve, 1, undefined, mode),
    ).toThrow("paid_response_limit");
    const rejected = Array.from({ length: 32 }, () => ({
      ...completed,
      state: "known_rejection" as const,
    }));
    expect(() =>
      assertMigrationDispatchAllowed(rejected, 0.5, reserve, 1, undefined, mode),
    ).toThrow("http_request_limit");
    expect(() =>
      assertMigrationDispatchAllowed(
        [],
        0,
        reserve,
        1,
        { maximumPaidResponses: 17, maximumHttpRequests: 32 },
        mode,
      ),
    ).toThrow("invalid_dispatch_limits");
  });
  it("bounds a smoke round at 5 paid, 5 HTTP and 0.60 USD and the probe at one 0.05 USD call", () => {
    expect(migrationControls.smoke).toEqual({
      maximumPaidResponses: 5,
      maximumHttpRequests: 5,
      hardUsd: 0.6,
    });
    expect(() =>
      assertMigrationDispatchAllowed(paid(4), 0.3, 0.265, 2, undefined, "smoke"),
    ).not.toThrow();
    expect(() => assertMigrationDispatchAllowed(paid(5), 0.3, 0.02, 1, undefined, "smoke")).toThrow(
      "http_request_limit",
    );
    expect(() => assertMigrationDispatchAllowed([], 0.34, 0.265, 1, undefined, "smoke")).toThrow(
      "hard_budget_before_dispatch",
    );
    expect(migrationControls.enforcementProbe).toEqual({
      maximumPaidResponses: 1,
      maximumHttpRequests: 1,
      hardUsd: 0.05,
    });
    expect(() =>
      assertMigrationDispatchAllowed([], 0, 0.042, 1, undefined, "enforcement-probe"),
    ).not.toThrow();
    expect(() =>
      assertMigrationDispatchAllowed([], 0, 0.051, 1, undefined, "enforcement-probe"),
    ).toThrow("hard_budget_before_dispatch");
    expect(() =>
      assertMigrationDispatchAllowed(
        [{ ...completed, state: "known_rejection" }],
        0,
        0.01,
        1,
        undefined,
        "enforcement-probe",
      ),
    ).toThrow("http_request_limit");
  });
  it("pauses on the soft budget only before another gated case starts", () => {
    expect(migrationSoftBudgetStop(0.5, "adoption", 5, 14)).toBe(true);
    expect(migrationSoftBudgetStop(0.49, "adoption", 5, 14)).toBe(false);
    expect(migrationSoftBudgetStop(0.6, "candidate-acceptance", 13, 14)).toBe(false);
    expect(migrationSoftBudgetStop(0.9, "candidate-acceptance", 13, 14)).toBe(true);
    // A round whose final case finished is complete, never stopped.
    expect(migrationSoftBudgetStop(1.1, "candidate-acceptance", 14, 14)).toBe(false);
    expect(migrationSoftBudgetStop(0.74, "adoption", 14, 14)).toBe(false);
    for (const mode of ["comparison", "smoke"] as const)
      expect(migrationSoftBudgetStop(1.5, mode, 1, 20)).toBe(false);
  });
});

describe("FR-PROC-003 declared transport and reported model checks", () => {
  it("accepts the configured model or its dated slug, never a sibling variant", () => {
    const model = "google/gemini-3.8-flash";
    expect(migrationReportedModelMatches(model, model)).toBe(true);
    expect(migrationReportedModelMatches(`${model}-20260902`, model)).toBe(true);
    for (const reported of [
      "google/gemini-3.8-flash-lite",
      "google/gemini-3.8-flash-tts",
      "google/gemini-3.8-flash-lite-tts",
      "google/gemini-3.8-flash-preview-20260902",
      "google/gemini-3.8-flash-2026090",
      "google/gemini-3.8-flashy",
      "google/gemini-3X8-flash",
      undefined,
    ])
      expect(migrationReportedModelMatches(reported, model)).toBe(false);
    expect(
      migrationReportedModelMatches(
        "anthropic/claude-haiku-5.5-20261001",
        "anthropic/claude-haiku-5.5",
      ),
    ).toBe(true);
  });
  it("compares the transport with the declared mode and counts only the :json fallback", () => {
    expect(migrationUnexpectedTransport("json_object", "json_object", "operation")).toBe(false);
    expect(migrationUnexpectedTransport("json_schema", "json_schema", "operation")).toBe(false);
    expect(migrationUnexpectedTransport("json_schema", "json_object", "operation:json")).toBe(true);
    expect(migrationUnexpectedTransport("json_schema", "json_schema", "operation:json")).toBe(true);
    expect(migrationUnexpectedTransport("json_object", "json_schema", "operation")).toBe(true);
    expect(migrationUnexpectedTransport(undefined, "json_object", "operation")).toBe(true);
  });
  it("closes schema-mode rounds that needed JSON closers, but not direct JSON rounds", () => {
    const closed = [{ finalLocalPass: true, firstGenerationPass: true, jsonClosersCompleted: 1 }];
    expect(migrationTransportGateFailure(closed, "json_schema")).toBe(
      "schema_mode_json_closers_gate_failed",
    );
    expect(migrationTransportGateFailure(closed, "json_object")).toBeUndefined();
    expect(
      migrationTransportGateFailure([{ jsonClosersCompleted: 0 }], "json_schema"),
    ).toBeUndefined();
    expect(
      migrationTransportGateFailure([{ unexpectedTransportFallback: true }], "json_object"),
    ).toBe("unexpected_transport_gate_failed");
  });
  it("adds the unchanged first-pass and final-validity gates only to gated rounds", () => {
    const twoRepairs = [
      { firstGenerationPass: false, finalLocalPass: true },
      { firstGenerationPass: false, finalLocalPass: true },
    ];
    expect(
      migrationBoundaryGateFailure(twoRepairs, {
        structuredOutputMode: "json_object",
        firstPassGateStopsRound: true,
      }),
    ).toBe("first_generation_gate_unreachable");
    expect(
      migrationBoundaryGateFailure([{ finalLocalPass: false }], {
        structuredOutputMode: "json_schema",
        firstPassGateStopsRound: true,
      }),
    ).toBe("final_local_validity_gate_failed");
    expect(
      migrationBoundaryGateFailure(twoRepairs, {
        structuredOutputMode: "json_object",
        firstPassGateStopsRound: false,
      }),
    ).toBeUndefined();
    expect(
      migrationBoundaryGateFailure([{ finalLocalPass: false, jsonClosersCompleted: 2 }], {
        structuredOutputMode: "json_schema",
        firstPassGateStopsRound: false,
      }),
    ).toBe("schema_mode_json_closers_gate_failed");
  });
});

describe("FR-QUOTA-009 comparison smoke subsets", () => {
  const original = Array.from({ length: 20 }, (_, index) => {
    const id = `Q${String(index + 1).padStart(2, "0")}`;
    return { caseId: `${id}-${index + 1}`, fixture: { id } };
  });
  it("keeps each named lesson's original case identity", () => {
    const selected = selectMigrationSmokeCases(original, "Q01,Q13");
    expect(selected.smoke).toBe(true);
    expect(selected.schedule.map((entry) => entry.caseId)).toEqual(["Q01-1", "Q13-13"]);
    expect(selected.schedule[1]).toBe(original[12]);
    expect(selectMigrationSmokeCases(original, undefined)).toEqual({
      smoke: false,
      schedule: original,
    });
  });
  it.each([
    ["Q01,Q01", "smoke_case_ids_invalid"],
    ["Q01,,Q13", "smoke_case_ids_invalid"],
    ["Q01;Q13", "smoke_case_ids_invalid"],
    ["Q01,Q99", "smoke_case_ids_unknown"],
    ["Q01,Q02,Q03", "smoke_case_count_exceeds_limits"],
  ])("rejects %s", (ids, code) => {
    expect(() => selectMigrationSmokeCases(original, ids)).toThrow(code);
  });
});

describe("FR-PROC-003 frozen plan binding", () => {
  const plan = { version: "synthetic", fixtureSet: "multilingual-holdout-4", date: "2026-10-09" };
  const planFile = { ...plan, freeze: sha256Hex(canonicalJson(plan)), paidCalls: 0 };
  it("accepts only a plan that still hashes to its freeze", () => {
    expect(assertMigrationPlanFrozen(planFile)).toEqual(planFile);
    expect(assertMigrationPlanFrozen({ ...planFile, paidCalls: 4 }).freeze).toBe(planFile.freeze);
    for (const edited of [
      { ...planFile, date: "2026-10-10" },
      { ...planFile, fixtureSet: "migration-14" },
      { ...planFile, extra: true },
    ])
      expect(() => assertMigrationPlanFrozen(edited)).toThrow("differs from its freeze");
    expect(() => assertMigrationPlanFrozen({ ...plan, freeze: "not-a-hash" })).toThrow();
    expect(() => assertMigrationPlanFrozen(plan)).toThrow();
  });
  it("dates a new round today and keeps a resumed round's frozen date", () => {
    expect(migrationPlanDate(undefined, undefined, "2026-10-09")).toBe("2026-10-09");
    expect(migrationPlanDate(undefined, { date: "2026-10-01" }, "2026-10-09")).toBe("2026-10-09");
    const state = { freeze: planFile.freeze };
    expect(migrationPlanDate(state, planFile, "2026-10-12")).toBe("2026-10-09");
    expect(() => migrationPlanDate(state, undefined, "2026-10-12")).toThrow(
      "resumed_round_plan_missing",
    );
    expect(() => migrationPlanDate(state, { date: 20261009 }, "2026-10-12")).toThrow();
    expect(() => migrationPlanDate(undefined, undefined, "2026-10-09T10:00:00Z")).toThrow();
  });
  it("meets the adoption transport only with the declared direct json_object or strict json_schema", () => {
    expect(migrationControls.adoptionGates.expectedTransport).toBe(
      "declared direct json_object or strict json_schema",
    );
    expect(
      migrationTransportMatchesAdoptionGate({
        directJsonMode: true,
        structuredOutputMode: "json_object",
      }),
    ).toBe(true);
    expect(
      migrationTransportMatchesAdoptionGate({
        directJsonMode: false,
        structuredOutputMode: "json_schema",
      }),
    ).toBe(true);
    for (const round of [
      { directJsonMode: true, structuredOutputMode: "json_schema" },
      { directJsonMode: false, structuredOutputMode: "json_object" },
      { directJsonMode: true, structuredOutputMode: undefined },
    ])
      expect(migrationTransportMatchesAdoptionGate(round)).toBe(false);
  });
});

describe("FR-QUOTA-009 PRD-COST-02 live dispatch needs the shared ledger", () => {
  it("refuses a missing ledger unless it is explicitly initialised where none exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recalino-ledger-"));
    const path = join(directory, "ledger.json");
    try {
      await expect(assertMigrationLedgerAvailable(path, false)).rejects.toThrow(
        "ledger_missing_pass_shared_ledger",
      );
      await expect(assertMigrationLedgerAvailable(path, true)).resolves.toBeUndefined();
      await expect(readFile(path)).rejects.toThrow();
      await writeFile(
        path,
        JSON.stringify({ version: 1, priorUnledgeredUsd: migrationUnledgeredPriorUsd, rounds: [] }),
      );
      await expect(assertMigrationLedgerAvailable(path, false)).resolves.toBeUndefined();
      await expect(assertMigrationLedgerAvailable(path, true)).rejects.toThrow(
        "ledger_exists_drop_initialize_flag",
      );
      await writeFile(path, JSON.stringify({ version: 2, rounds: [] }));
      await expect(assertMigrationLedgerAvailable(path, false)).rejects.toThrow();
      await writeFile(path, "{");
      await expect(assertMigrationLedgerAvailable(path, false)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
