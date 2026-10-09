import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../../packages/core/src/plt";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../../packages/core/test/multilingual-study-fixture";
import {
  caseOutcome,
  providerAttemptsFromDispatches,
  roundSummary,
  saveJson,
  studyCards,
  validationDossierSchema,
  writePublishedCase,
} from "./baseline-outputs";
import { assertMigrationPlanFrozen, migrationRoundStateSchema } from "./ledger";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const temporary = async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-round-"));
  directories.push(directory);
  return directory;
};
const attempt = (step: string, outcome: "generated" | "rejected" = "generated", number = 1) => ({
  step,
  attempt: number,
  httpRequests: 1,
  lastStatus: outcome === "generated" ? 200 : 400,
  outcome,
});
const spanish = MULTILINGUAL_STUDY_CASES.find((value) => value.language === "es");
if (!spanish) throw new Error("missing Spanish study case");
const model = multilingualStudyModel(spanish);

describe("case outcome", () => {
  it("reads the worker's attempts from its operation keys, a json fallback joining its attempt", () => {
    const run = "11111111-1111-4111-8111-111111111111";
    expect(
      providerAttemptsFromDispatches([
        { operationKey: `${run}:knowledge:1`, status: 400, outcome: "response" },
        { operationKey: `${run}:knowledge:1:json`, status: 200, outcome: "response" },
        { operationKey: `${run}:knowledge:repair:1`, status: null, outcome: "unknown" },
        { operationKey: `${run}:knowledge:repair-language:1`, status: null, outcome: "refused" },
      ]),
    ).toEqual([
      { step: "knowledge", attempt: 1, httpRequests: 2, lastStatus: 200, outcome: "generated" },
      {
        step: "knowledge:repair",
        attempt: 1,
        httpRequests: 1,
        lastStatus: null,
        outcome: "unknown",
      },
      {
        step: "knowledge:repair-language",
        attempt: 1,
        httpRequests: 0,
        lastStatus: null,
        outcome: "refused",
      },
    ]);
  });

  it("passes a ready or partial_ready run with an output version", () => {
    for (const state of ["ready", "partial_ready"])
      expect(
        caseOutcome({ state, lastError: null, outputVersionId: "v" }, [attempt("knowledge")], 1),
      ).toMatchObject({ runState: state, finalLocalPass: true, firstGenerationPass: true });
    expect(
      caseOutcome({ state: "ready", lastError: null, outputVersionId: null }, [], 0),
    ).toMatchObject({ finalLocalPass: false, firstGenerationPass: false });
  });

  it("counts every knowledge-family attempt; a repaired output is not a first-generation pass", () => {
    const repaired = caseOutcome(
      { state: "ready", lastError: null, outputVersionId: "v" },
      [attempt("knowledge"), attempt("knowledge:repair"), attempt("knowledge:repair-language")],
      3,
    );
    expect(repaired).toMatchObject({
      finalLocalPass: true,
      firstGenerationPass: false,
      providerAttempts: 3,
      knowledgeGenerationAttempts: 3,
      knowledgeGenerations: 3,
      attemptsByStep: { knowledge: 1, "knowledge:repair": 1, "knowledge:repair-language": 1 },
    });
    // A rate-limited first attempt generated nothing; the worker's own retry is the generation.
    expect(
      caseOutcome(
        { state: "ready", lastError: null, outputVersionId: "v" },
        [
          { ...attempt("knowledge", "rejected"), lastStatus: 429 },
          attempt("knowledge", "generated", 2),
        ],
        1,
      ),
    ).toMatchObject({ firstGenerationPass: true, knowledgeGenerationAttempts: 2 });
    expect(
      caseOutcome(
        { state: "failed", lastError: "provider_http_400", outputVersionId: null },
        [attempt("knowledge", "rejected")],
        0,
      ),
    ).toMatchObject({
      runState: "failed",
      lastError: "provider_http_400",
      finalLocalPass: false,
      firstGenerationPass: false,
    });
  });

  it("requires the validation-dossier fields", () => {
    const dossier = {
      caseId: "S01-1",
      fixtureId: "S01",
      repeat: false,
      ...caseOutcome(
        { state: "ready", lastError: null, outputVersionId: "v" },
        [attempt("knowledge")],
        1,
      ),
      usdCost: 0.02,
      durationMs: 1200,
    };
    expect(validationDossierSchema.parse(dossier)).toEqual(dossier);
    const { attemptsByStep: _omitted, ...missing } = dossier;
    expect(() => validationDossierSchema.parse(missing)).toThrow();
  });
});

describe("published case files", () => {
  it("writes the model, rendered notes and cards in the haiku55 live harness shape", async () => {
    const dossier = await temporary();
    await writePublishedCase(dossier, {
      publishedModel: model,
      finalModel: model,
      explanationLanguage: "es",
    });
    const cards = JSON.parse(await readFile(resolve(dossier, "cards.json"), "utf8"));
    expect(cards).toEqual(studyCards(model, "es"));
    expect(cards.map((card: Record<string, unknown>) => Object.keys(card).sort())).toEqual([
      ["back", "front", "id"],
      ["back", "front", "id"],
    ]);
    expect(JSON.parse(await readFile(resolve(dossier, "final-model.json"), "utf8"))).toEqual(model);
    expect(await readFile(resolve(dossier, "notes.html"), "utf8")).toContain("wear and tear");
    expect(existsSync(resolve(dossier, "published-model.json"))).toBe(true);
  });
});

const blindMergePath =
  "C:/Users/Ali-PC/.codex/worktrees/haiku55-migration/Recalino/tools/eval/quality-review-blind-merge.ts";
describe("round layout", () => {
  /** A round directory written the way the CLI writes one. */
  async function round() {
    const directory = await temporary();
    const fixtures = holdout5MigrationFixtures();
    const plan = {
      version: "test",
      model: "vendor/model",
      fixturesHash: sha256Hex(canonicalJson(fixtures)),
      schedule: [{ caseId: "S01-1", fixtureId: "S01", repeat: false }],
    };
    const freeze = sha256Hex(canonicalJson(plan));
    await saveJson(resolve(directory, "dry-run-plan.json"), { ...plan, freeze, paidCalls: 0 });
    await saveJson(resolve(directory, "fixtures-and-ground-truth.json"), {
      syntheticOnly: true,
      cases: fixtures,
    });
    const result = validationDossierSchema.parse({
      caseId: "S01-1",
      fixtureId: "S01",
      repeat: false,
      ...caseOutcome(
        { state: "ready", lastError: null, outputVersionId: "v" },
        [attempt("knowledge")],
        1,
      ),
      usdCost: 0.02,
      durationMs: 10,
    });
    const state = migrationRoundStateSchema.parse({
      freeze,
      spentUsd: 0.02,
      stopped: false,
      requests: [
        {
          id: "r",
          caseId: "S01-1",
          stage: "knowledge",
          state: "completed",
          reserveUsd: 0.07,
          costUsd: 0.02,
        },
      ],
      results: [result],
    });
    await saveJson(resolve(directory, "state.json"), state);
    const dossier = resolve(directory, "dossiers", "S01-1");
    await saveJson(resolve(dossier, "validation-dossier.json"), result);
    await writePublishedCase(dossier, {
      publishedModel: model,
      finalModel: model,
      explanationLanguage: "es",
    });
    await saveJson(
      resolve(directory, "summary.json"),
      roundSummary({
        freeze,
        model: plan.model,
        mode: "live",
        state,
        expectedCases: 1,
        cumulativeEvaluationUsd: 1,
      }),
    );
    return { directory, freeze };
  }

  it("keeps the plan bound to its freeze and the summary to the round state", async () => {
    const { directory, freeze } = await round();
    const plan = JSON.parse(await readFile(resolve(directory, "dry-run-plan.json"), "utf8"));
    expect(assertMigrationPlanFrozen(plan).freeze).toBe(freeze);
    expect(() => assertMigrationPlanFrozen({ ...plan, model: "other" })).toThrow();
    const summary = JSON.parse(await readFile(resolve(directory, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      freeze,
      actualProductionPipeline: true,
      completedCases: 1,
      finalLocalPasses: 1,
      firstGenerationPasses: 1,
      spentUsd: 0.02,
      unresolved: [],
    });
  });

  it.skipIf(!existsSync(blindMergePath))(
    "is readable by the haiku55 blind quality-review export",
    async () => {
      const { directory, freeze } = await round();
      const blind = (await import(/* @vite-ignore */ pathToFileURL(blindMergePath).href)) as {
        readFrozenBlindRound: (
          directory: string,
          freeze?: string,
        ) => Promise<{ freeze: string; acceptedCases: { caseId: string; fixtureId: string }[] }>;
      };
      const read = await blind.readFrozenBlindRound(directory, freeze);
      expect(read.freeze).toBe(freeze);
      expect(read.acceptedCases.map(({ caseId, fixtureId }) => ({ caseId, fixtureId }))).toEqual([
        { caseId: "S01-1", fixtureId: "S01" },
      ]);
    },
  );
});
