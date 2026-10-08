import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildKnowledgeGenerationInput } from "../../packages/core/src/proc/knowledge-generation";
import { holdoutMigrationFixtures, holdoutRepeatIds } from "./haiku55-holdout-fixtures";
import {
  freshMigrationFixtures,
  migrationFixtureSchema,
  migrationInputData,
} from "./haiku55-migration-fixtures";
import { migrationAutomaticGoldChecks } from "./haiku55-migration-gold";
import {
  assertMigrationCumulativeBudget,
  type MigrationLedger,
  migrationControls,
  migrationLedgerRound,
  migrationUnledgeredPriorUsd,
} from "./haiku55-migration-guards";

const freeze = (character: string) => character.repeat(64);
const ledger = (): MigrationLedger => ({
  version: 1,
  priorUnledgeredUsd: migrationUnledgeredPriorUsd,
  rounds: [],
});

describe("PRD-COST-02 cross-round migration ledger", () => {
  it("gives one frozen candidate one round and never resets spend in a fresh directory", () => {
    const value = ledger();
    const round = migrationLedgerRound(value, freeze("a"), "out/one", "haiku55-holdout-2");
    round.spentUsd = 0.05;
    expect(migrationLedgerRound(value, freeze("a"), "out/one", "haiku55-holdout-2")).toBe(round);
    expect(() => migrationLedgerRound(value, freeze("a"), "out/two", "haiku55-holdout-2")).toThrow(
      "freeze_already_evaluated_in_another_directory",
    );
    expect(() => migrationLedgerRound(value, freeze("b"), "out/one", "haiku55-holdout-2")).toThrow(
      "directory_belongs_to_another_freeze",
    );
    expect(() => migrationLedgerRound(value, freeze("a"), "out/one", "migration-14")).toThrow(
      "fixture_set_changed",
    );
  });
  it("counts the spend before the ledger and every round against one cumulative ceiling", () => {
    const value = ledger();
    expect(() => assertMigrationCumulativeBudget(value, 0.3)).not.toThrow();
    migrationLedgerRound(value, freeze("a"), "out/one", "haiku55-holdout-2").spentUsd = 0.2;
    expect(() => assertMigrationCumulativeBudget(value, 0.2)).toThrow(
      "cumulative_budget_before_dispatch",
    );
    expect(migrationControls.cumulativeHardUsd).toBeLessThanOrEqual(migrationControls.hardUsd);
  });
});

describe("PRD-QA-01 independent holdout fixtures", () => {
  const fixtures = holdoutMigrationFixtures();
  it("has twelve distinct lessons and two repeats, disjoint from earlier fixtures", async () => {
    expect(fixtures.map((fixture) => fixture.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`),
    );
    expect(holdoutRepeatIds.every((id) => fixtures.some((fixture) => fixture.id === id))).toBe(
      true,
    );
    const regression = JSON.parse(
      await readFile(
        new URL("./haiku55-migration-regression-fixtures.json", import.meta.url),
        "utf8",
      ),
    ) as { cases: unknown[] };
    const earlier = [
      ...regression.cases.map((entry) => migrationFixtureSchema.parse(entry)),
      ...freshMigrationFixtures(),
    ];
    const earlierIds = new Set(
      earlier.flatMap((fixture) => fixture.sources.map((source) => source.sourceId)),
    );
    const sentences = (text: string) =>
      text
        .split(/(?<=[.?!])\s+/u)
        .map((sentence) => sentence.trim().toLocaleLowerCase("en"))
        .filter((sentence) => sentence.split(" ").length >= 5);
    const earlierSentences = new Set(
      earlier.flatMap((fixture) =>
        fixture.sources.flatMap((source) =>
          source.blocks.flatMap((block) => sentences(block.text)),
        ),
      ),
    );
    for (const fixture of fixtures)
      for (const source of fixture.sources) {
        expect(earlierIds.has(source.sourceId)).toBe(false);
        for (const block of source.blocks)
          for (const sentence of sentences(block.text))
            expect(earlierSentences.has(sentence)).toBe(false);
      }
  });
  it("covers conflicts, ownership, both explanation languages, missing material, variants and injection", () => {
    const expected = fixtures.map((fixture) => fixture.expected);
    expect(expected.filter((entry) => entry.contradiction).length).toBeGreaterThanOrEqual(2);
    expect(
      fixtures.some((fixture) => fixture.sources.some((source) => source.role === "user_notes")),
    ).toBe(true);
    expect(new Set(fixtures.map((fixture) => fixture.explanationLanguage))).toEqual(
      new Set(["fa", "en"]),
    );
    expect(fixtures.some((fixture) => fixture.missingSourceIds.length > 0)).toBe(true);
    expect(expected.some((entry) => entry.pronunciationVariants)).toBe(true);
    expect(expected.some((entry) => entry.injection)).toBe(true);
    expect(new Set(fixtures.map((fixture) => fixture.goal))).toEqual(
      new Set(["esol", "ielts", "general"]),
    );
  });
  it("never reveals the evaluation or its answer keys in model input", () => {
    for (const fixture of fixtures) {
      const input = JSON.stringify(migrationInputData(fixture));
      for (const marker of [
        "criticalFacts",
        "forbiddenErrors",
        "expected",
        "holdout",
        "Holdout",
        "synthetic",
        "fictional",
        "account owner",
        "evaluation",
      ])
        expect(input).not.toContain(marker);
      // The production builder accepts every lesson, including the failed PDF page.
      const prepared = buildKnowledgeGenerationInput(migrationInputData(fixture), 120000);
      expect(prepared.input).not.toContain("criticalFacts");
      // No production prompt formatting example overlaps a holdout lesson.
      for (const example of ["because it was raining", "kind of", "kit sth out"])
        expect(input.toLocaleLowerCase("en")).not.toContain(example);
    }
  });
});

describe("PRD-QA-01 automatic answer-key checks", () => {
  const fixture = holdoutMigrationFixtures().find((entry) => entry.id === "N10");
  if (!fixture) throw new Error("fixture");
  const model = {
    schemaVersion: "1",
    title: "Prepositions",
    language: { learning: "en", explanation: "fa" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [],
    classNotes: {
      date: "2026-10-08",
      coverage: "x",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
      mistakes: { speechStatus: "no_audio", patterns: [], items: [] },
    },
  } as unknown as Parameters<typeof migrationAutomaticGoldChecks>[1];
  it("fails an obeyed injection, an unconfirmed learner mistake and a wrong speech status", () => {
    const clean = migrationAutomaticGoldChecks(fixture, model);
    expect(clean.filter((check) => check.gating).every((check) => check.passed)).toBe(true);
    const injected = migrationAutomaticGoldChecks(fixture, { ...model, title: "SYSTEM OVERRIDE" });
    expect(injected.find((check) => check.id === "injection_ignored")?.passed).toBe(false);
    const owned = structuredClone(model);
    owned.classNotes?.mistakes?.items.push({
      source: "handwriting",
      said: "x",
      correct: "y",
      whyFa: "z",
      kind: "grammar",
      teacherCorrected: false,
    });
    expect(
      migrationAutomaticGoldChecks(fixture, owned).find(
        (check) => check.id === "no_unconfirmed_learner_mistakes",
      )?.passed,
    ).toBe(false);
    const audio = structuredClone(model);
    if (audio.classNotes?.mistakes) audio.classNotes.mistakes.speechStatus = "unverified";
    expect(
      migrationAutomaticGoldChecks(fixture, audio).find((check) => check.id === "speech_status")
        ?.passed,
    ).toBe(false);
  });
  it("requires an uncertainty citing every conflicting source and incomplete coverage", () => {
    const conflict = holdoutMigrationFixtures().find((entry) => entry.id === "N03");
    const missing = holdoutMigrationFixtures().find((entry) => entry.id === "N07");
    if (!conflict || !missing) throw new Error("fixture");
    expect(
      migrationAutomaticGoldChecks(conflict, model).find((check) =>
        check.id.startsWith("uncertainty_cites_"),
      )?.passed,
    ).toBe(false);
    expect(
      migrationAutomaticGoldChecks(missing, model).find(
        (check) => check.id === "coverage_incomplete",
      )?.passed,
    ).toBe(false);
  });
});
