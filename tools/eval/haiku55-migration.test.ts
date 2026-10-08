import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  freshMigrationFixtures,
  migrationFixtureSchema,
  migrationInputData,
} from "./haiku55-migration-fixtures";
import {
  assertMigrationDispatchAllowed,
  type MigrationRequest,
  migrationAutomaticGateFailure,
  migrationControlInterruptionResult,
  migrationControls,
  migrationInitialRecovery,
  migrationRequestReserve,
  readMigrationRecordedJson,
  selectMigrationDiagnosticCases,
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
    expect(migrationControls.adoptionGates.nativeSchemaAcceptanceClaimed).toBe(false);
    expect(migrationControls.adoptionGates.expectedTransport).toBe("direct json_object");
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
