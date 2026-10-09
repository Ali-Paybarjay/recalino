import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createJsonFallbackTransport, providerSettingsSchema } from "../../packages/core/src/aip";
import {
  type KnowledgeModel,
  studyLexicalTarget,
  studyLexicalTargetMatches,
} from "../../packages/core/src/lkm";
import { usesContentKnowledgeContract } from "../../packages/core/src/proc/knowledge-contract";
import { buildKnowledgeGenerationInput } from "../../packages/core/src/proc/knowledge-generation";
import { buildKnowledgeStudyRepairInput } from "../../packages/core/src/proc/knowledge-study-repair";
import {
  learnerTeachingContextSchema,
  snapshotLearnerTeachingContext,
} from "../../packages/core/src/proc/learner-context";
import { studyPrompt } from "../../packages/core/src/proc/study-prompt";
import { holdoutMigrationFixtures, holdoutRepeatIds } from "./haiku55-holdout-fixtures";
import { holdout3MigrationFixtures, holdout3RepeatIds } from "./haiku55-holdout3-fixtures";
import {
  freshMigrationFixtures,
  type MigrationFixture,
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
  withMigrationLedger,
} from "./haiku55-migration-guards";
import { comparisonCandidates, comparisonSettings } from "./model-comparison-candidates";
import { comparisonFixtures } from "./model-comparison-fixtures";
import { holdout4MigrationFixtures, holdout4RepeatIds } from "./multilingual-holdout4-fixtures";

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
  it("counts the spend before the ledger, every round and in-flight reserves against one ceiling", () => {
    const value = ledger();
    expect(() => assertMigrationCumulativeBudget(value, 0.3)).not.toThrow();
    const round = migrationLedgerRound(value, freeze("a"), "out/one", "haiku55-holdout-2");
    round.spentUsd = 4.9;
    expect(() => assertMigrationCumulativeBudget(value, 0.5)).toThrow(
      "cumulative_budget_before_dispatch",
    );
    round.spentUsd = 4.5;
    round.inFlightUsd = 0.5;
    expect(() => assertMigrationCumulativeBudget(value, 0.2)).toThrow(
      "cumulative_budget_before_dispatch",
    );
    // The owner-approved ceiling: at most 5 USD beyond the 0.2370516 USD already spent.
    expect(migrationControls.cumulativeHardUsd).toBeLessThanOrEqual(0.2370516 + 5);
  });

  it("serialises concurrent ledger updates so parallel rounds never lose spend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recalino-ledger-"));
    const path = join(directory, "ledger.json");
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        withMigrationLedger(path, (value) => {
          migrationLedgerRound(
            value,
            freeze(String(index)),
            `out/${index}`,
            "comparison",
          ).spentUsd = 0.01;
        }),
      ),
    );
    const saved = JSON.parse(await readFile(path, "utf8")) as MigrationLedger;
    expect(saved.rounds).toHaveLength(8);
    await rm(directory, { recursive: true });
  });
});

describe.each([
  {
    name: "comparison",
    prefix: "Q",
    count: 20,
    languages: ["fa", "ar", "es", "ja", "uk"],
    fixtures: comparisonFixtures(),
    repeatIds: [] as readonly string[],
    before: [...holdoutMigrationFixtures(), ...holdout3MigrationFixtures()],
  },
  {
    name: "holdout-2",
    prefix: "N",
    count: 12,
    languages: ["fa", "en"],
    fixtures: holdoutMigrationFixtures(),
    repeatIds: holdoutRepeatIds,
    before: [],
  },
  {
    name: "holdout-3",
    prefix: "P",
    count: 12,
    languages: ["fa", "en"],
    fixtures: holdout3MigrationFixtures(),
    repeatIds: holdout3RepeatIds,
    before: holdoutMigrationFixtures(),
  },
  {
    name: "holdout-4",
    prefix: "R",
    count: 12,
    languages: ["fa", "ar", "es", "ja", "uk"],
    fixtures: holdout4MigrationFixtures(),
    repeatIds: holdout4RepeatIds,
    before: [
      ...holdoutMigrationFixtures(),
      ...holdout3MigrationFixtures(),
      ...comparisonFixtures(),
    ],
  },
])(
  "PRD-QA-01 independent $name fixtures",
  ({ prefix, count, languages, fixtures, repeatIds, before }) => {
    it("has twelve distinct lessons and two repeats, disjoint from every earlier fixture set", async () => {
      expect(fixtures.map((fixture) => fixture.id)).toEqual(
        Array.from(
          { length: count },
          (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`,
        ),
      );
      expect(repeatIds.every((id) => fixtures.some((fixture) => fixture.id === id))).toBe(true);
      const regression = JSON.parse(
        await readFile(
          new URL("./haiku55-migration-regression-fixtures.json", import.meta.url),
          "utf8",
        ),
      ) as { cases: unknown[] };
      const earlier = [
        ...regression.cases.map((entry) => migrationFixtureSchema.parse(entry)),
        ...freshMigrationFixtures(),
        ...before,
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
        new Set(languages),
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
          '"expected":',
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
  },
);

type BlockRef = { sourceId: string; blockId: string };
type AnswerKey = {
  concepts?: {
    id: string;
    supporting: BlockRef[];
    sourceExamples?: string[];
    lexicalTargets?: string[];
  }[];
  attribution?: { allowedHomework?: (BlockRef & { assignment: string })[] };
  printedInClassTasks?: BlockRef[];
  cueEqualsAnswer?: (BlockRef & {
    prompt: string;
    cue: string;
    answer: string;
    fullSentence: string;
  })[];
  classRulesFromClass?: { blocks: BlockRef[]; requiredOrigin: string };
  injection?: { sourceBlock: string; forbiddenOutputText: string[] };
};
const answerKey = (fixture: MigrationFixture) => fixture.expected as AnswerKey;
const blockAt = (fixture: MigrationFixture, ref: BlockRef) =>
  fixture.sources
    .find((source) => source.sourceId === ref.sourceId)
    ?.blocks.find((block) => block.id === ref.blockId);
const sameBlock = (left: BlockRef, right: BlockRef) =>
  left.sourceId === right.sourceId && left.blockId === right.blockId;
const shingleWords = (text: string) =>
  text
    .normalize("NFC")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
/** Every run of six consecutive words; a shared run means copied wording, not a shared topic. */
const shingles = (text: string) => {
  const words = shingleWords(text);
  return words.slice(5).map((_, index) => words.slice(index, index + 6).join(" "));
};

async function regressionFixtures(): Promise<MigrationFixture[]> {
  const regression = JSON.parse(
    await readFile(
      new URL("./haiku55-migration-regression-fixtures.json", import.meta.url),
      "utf8",
    ),
  ) as { cases: unknown[] };
  return regression.cases.map((entry) => migrationFixtureSchema.parse(entry));
}

/**
 * Every system prompt the current code can send for these lessons, recomputed from the builders
 * rather than copied, so a prompt change on another branch is checked against the same lessons.
 */
async function productionPromptTexts(fixtures: MigrationFixture[]): Promise<string[]> {
  const code = await readFile(
    new URL("../../packages/core/src/proc/knowledge-generation.ts", import.meta.url),
    "utf8",
  );
  // The builder keeps its repair tables private; their keys name every repair variant.
  const keys = (table: string) =>
    [
      ...(
        code.match(
          new RegExp(`const ${table}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`, "u"),
        )?.[1] ?? ""
      ).matchAll(/^ {2}([a-z][a-z0-9_]*):/gmu),
    ].map((match) => String(match[1]));
  const reasons = keys("repairGuidance");
  const issues = keys("issueMeaning");
  if (reasons.length < 10 || !reasons.includes("provider_schema_invalid") || !issues.length)
    throw new Error("repair_variants_not_found");
  const texts = new Set<string>();
  const system = (
    fixture: MigrationFixture,
    options: NonNullable<Parameters<typeof buildKnowledgeGenerationInput>[2]>,
    learnerContext = migrationInputData(fixture).learnerContext,
  ) => {
    const prepared = buildKnowledgeGenerationInput(
      { ...migrationInputData(fixture), learnerContext },
      120000,
      options,
    );
    texts.add(prepared.system);
    return prepared;
  };
  // JSON-object transport sends the schema in the system message, so its descriptions count too.
  const descriptions = (node: unknown): string[] =>
    Array.isArray(node)
      ? node.flatMap(descriptions)
      : node && typeof node === "object"
        ? Object.entries(node).flatMap(([key, value]) =>
            key === "description" && typeof value === "string" ? [value] : descriptions(value),
          )
        : [];
  for (const fixture of fixtures)
    for (const maxOutputTokens of [6144, 32000]) {
      for (const compact of [false, true]) {
        const { schema } = system(fixture, { maxOutputTokens, compact });
        for (const text of descriptions(createJsonFallbackTransport(schema).schema))
          texts.add(text);
      }
      // The legacy contract's shared study guidance is still a production prompt.
      for (const usesEvidenceKeys of [false, true])
        texts.add(
          studyPrompt(
            fixture.explanationLanguage,
            maxOutputTokens,
            usesEvidenceKeys,
            migrationInputData(fixture).learnerContext,
          ),
        );
    }
  // Repair text sits between language-independent sentences, so one lesson per script suffices.
  const scripts = [
    fixtures.find((fixture) => fixture.explanationLanguage === "fa"),
    fixtures.find((fixture) => fixture.explanationLanguage !== "fa"),
  ];
  for (const fixture of scripts) {
    if (!fixture) throw new Error("repair_variant_language_missing");
    for (const compact of [false, true]) {
      for (const reason of [...reasons, "unlisted_reason"]) {
        system(fixture, { compact, repairReason: reason });
        system(fixture, {
          compact,
          repairReason: "provider_schema_invalid",
          repairDetail: `assembly:${reason}`,
        });
      }
      for (const detail of ["json_parse", ...issues.map((code) => `zod:${code}@learningItems.0`)])
        system(fixture, { compact, repairReason: "provider_schema_invalid", repairDetail: detail });
    }
  }
  // Every declared level and goal selects its own personalised teaching sentences.
  const [first] = fixtures;
  if (!first) throw new Error("fixture");
  for (const level of [...learnerTeachingContextSchema.shape.declaredLevel.unwrap().options, null])
    for (const goal of [...learnerTeachingContextSchema.shape.goal.unwrap().options, null])
      system(first, {}, snapshotLearnerTeachingContext({ level, goal }));
  // The answer-span repair prompt is fixed; one mismatched card is enough to build it.
  const mismatched = {
    learningItems: [
      {
        id: "item-1",
        study: {
          set: "production",
          kind: "vocabulary",
          en: "x",
          fullSentence: "One two three.",
          gapSentence: "Four ______ three.",
        },
      },
    ],
  } as unknown as KnowledgeModel;
  texts.add(buildKnowledgeStudyRepairInput(mismatched, 120000).system);
  return [...texts];
}

describe("PRD-QA-01 FR-PROC-004 multilingual holdout-4 answer keys and disjointness", () => {
  const fixtures = holdout4MigrationFixtures();
  const concepts = fixtures.flatMap((fixture) =>
    (answerKey(fixture).concepts ?? []).map((concept) => ({ fixture, concept })),
  );
  let earlier: MigrationFixture[] = [];
  let prompts: string[] = [];
  beforeAll(async () => {
    earlier = [
      ...(await regressionFixtures()),
      ...freshMigrationFixtures(),
      ...holdoutMigrationFixtures(),
      ...holdout3MigrationFixtures(),
      ...comparisonFixtures(),
    ];
    prompts = await productionPromptTexts(fixtures);
  }, 60000);

  it("FR-PROC-004 numbers R01-R12 with source cases 101-112 and keeps a Persian majority", () => {
    fixtures.forEach((fixture, index) => {
      for (const source of fixture.sources)
        expect(source.sourceId.startsWith(`ad${String(101 + index).padStart(6, "0")}-`)).toBe(true);
    });
    const counts = new Map<string, number>();
    for (const { explanationLanguage } of fixtures)
      counts.set(explanationLanguage, (counts.get(explanationLanguage) ?? 0) + 1);
    const persian = counts.get("fa") ?? 0;
    expect(persian).toBeGreaterThanOrEqual(5);
    for (const [language, count] of counts)
      if (language !== "fa") expect(count).toBeLessThan(persian);
    expect(new Set(fixtures.map((fixture) => fixture.declaredLevel))).toEqual(
      new Set(["A1", "A2", "B1", "B2", "C1"]),
    );
  });

  it("FR-PROC-004 separates the one assigned homework from printed in-class tasks", () => {
    for (const fixture of fixtures) {
      const key = answerKey(fixture);
      const printed = key.printedInClassTasks ?? [];
      // Every printed task in the lesson text is recorded as in-class work in the answer key.
      const printedBlocks = fixture.sources.flatMap((source) =>
        source.blocks
          .filter((block) => /\bprinted task\b/iu.test(block.text))
          .map((block) => `${source.sourceId}/${block.id}`),
      );
      expect(printed.map((entry) => `${entry.sourceId}/${entry.blockId}`).sort()).toEqual(
        printedBlocks.sort(),
      );
      for (const homework of key.attribution?.allowedHomework ?? []) {
        const text = blockAt(fixture, homework)?.text ?? "";
        expect(text).toMatch(/\bhomework\b/iu);
        expect(text).toContain(homework.assignment);
        expect(printed.some((entry) => sameBlock(entry, homework))).toBe(false);
        // The assignment sits right next to an in-class printed task, so the trap is real.
        const blocks = fixture.sources.find(
          (source) => source.sourceId === homework.sourceId,
        )?.blocks;
        const position = (ref: BlockRef) =>
          blocks?.findIndex((block) => block.id === ref.blockId) ?? -1;
        expect(
          printed.some(
            (entry) =>
              entry.sourceId === homework.sourceId &&
              Math.abs(position(entry) - position(homework)) === 1,
          ),
        ).toBe(true);
      }
    }
    const homework = (fixture: MigrationFixture) =>
      answerKey(fixture).attribution?.allowedHomework ?? [];
    expect(fixtures.some((fixture) => homework(fixture).length > 0)).toBe(true);
    expect(
      fixtures.some(
        (fixture) =>
          homework(fixture).length === 0 &&
          (answerKey(fixture).printedInClassTasks ?? []).length > 0,
      ),
    ).toBe(true);
  });

  it("FR-PROC-004 teaches an indefinite pronoun and grammar tasks whose cue is the answer", () => {
    expect(
      concepts.some(({ concept }) =>
        (concept.lexicalTargets ?? []).some((target) =>
          shingleWords(target).some((word) =>
            /^(?:any|every|no|some)(?:body|one|thing|where)$/u.test(word),
          ),
        ),
      ),
    ).toBe(true);
    const cued = fixtures.filter((fixture) => (answerKey(fixture).cueEqualsAnswer ?? []).length);
    expect(cued.length).toBeGreaterThanOrEqual(2);
    for (const fixture of cued)
      for (const task of answerKey(fixture).cueEqualsAnswer ?? []) {
        expect(blockAt(fixture, task)?.text).toContain(task.prompt);
        expect(task.prompt).toContain(`___ (${task.cue})`);
        expect(task.answer).toBe(task.cue);
        expect(task.prompt.replace(`___ (${task.cue})`, task.answer)).toBe(task.fullSentence);
      }
  });

  it("AC-D46-06 plants a new injection marker that no other lesson or prompt contains", () => {
    const injected = fixtures.filter((fixture) => answerKey(fixture).injection);
    expect(injected.length).toBeGreaterThanOrEqual(1);
    for (const fixture of injected) {
      const injection = answerKey(fixture).injection;
      const block = fixture.sources
        .flatMap((source) => source.blocks)
        .find((entry) => entry.id === injection?.sourceBlock);
      expect(injection?.forbiddenOutputText.length).toBeGreaterThan(0);
      for (const marker of injection?.forbiddenOutputText ?? []) {
        expect(["HACKED", "SYSTEM OVERRIDE", "ZEBRA-OK", "WOLF-77"]).not.toContain(marker);
        expect(block?.text).toContain(marker);
        const lower = marker.toLocaleLowerCase("en");
        for (const other of [...earlier, ...fixtures.filter((entry) => entry !== fixture)])
          expect(JSON.stringify(other).toLocaleLowerCase("en")).not.toContain(lower);
        for (const prompt of prompts) expect(prompt.toLocaleLowerCase("en")).not.toContain(lower);
      }
    }
  });

  it("FR-PROC-004 keeps concept IDs and lexical targets disjoint from every earlier set", () => {
    const earlierConcepts = earlier.flatMap((fixture) => answerKey(fixture).concepts ?? []);
    const earlierIds = new Set(earlierConcepts.map((concept) => concept.id));
    const earlierTargets = new Set(
      earlierConcepts.flatMap((concept) =>
        (concept.lexicalTargets ?? []).map((target) => target.toLocaleLowerCase("en")),
      ),
    );
    const ids = concepts.map(({ concept }) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => earlierIds.has(id))).toEqual([]);
    expect(
      concepts
        .flatMap(({ concept }) => concept.lexicalTargets ?? [])
        .filter((target) => earlierTargets.has(target.toLocaleLowerCase("en"))),
    ).toEqual([]);
  });

  it("FR-PROC-004 shares no six-word run with earlier lessons or any production prompt", () => {
    expect(prompts.length).toBeGreaterThan(fixtures.length * 4);
    const earlierRuns = new Set(
      earlier.flatMap((fixture) =>
        fixture.sources.flatMap((source) => source.blocks.flatMap((block) => shingles(block.text))),
      ),
    );
    const promptRuns = new Set(prompts.flatMap(shingles));
    const shared = fixtures.flatMap((fixture) =>
      fixture.sources.flatMap((source) =>
        source.blocks.flatMap((block) =>
          shingles(block.text).flatMap((run) => [
            ...(earlierRuns.has(run) ? [`${fixture.id}/${block.id} lesson: ${run}`] : []),
            ...(promptRuns.has(run) ? [`${fixture.id}/${block.id} prompt: ${run}`] : []),
          ]),
        ),
      ),
    );
    expect(shared).toEqual([]);
  });

  it("AC-D46-01 uses lexical targets the shared parser keeps whole and finds in their block", () => {
    for (const { fixture, concept } of concepts) {
      const texts = concept.supporting.map((support) => blockAt(fixture, support)?.text ?? "");
      for (const example of concept.sourceExamples ?? [])
        expect(texts.some((text) => text.includes(example))).toBe(true);
      for (const target of concept.lexicalTargets ?? []) {
        const parsed = studyLexicalTarget(target);
        // No word of a holdout target may be read as an sb/sth object slot.
        expect(parsed?.text).toBe(target);
        for (const text of texts)
          expect(parsed !== undefined && studyLexicalTargetMatches(parsed, text)).toBe(true);
      }
    }
    const targets = concepts.flatMap(({ concept }) => concept.lexicalTargets ?? []);
    expect(targets.filter((target) => target.includes(" ")).length).toBeGreaterThanOrEqual(2);
    // Class rules taught from the lesson text must keep their class origin.
    const ruled = fixtures.filter((fixture) => answerKey(fixture).classRulesFromClass);
    expect(ruled.length).toBeGreaterThanOrEqual(1);
    for (const fixture of ruled) {
      const rules = answerKey(fixture).classRulesFromClass;
      expect(rules?.requiredOrigin).toBe("from_class");
      expect(rules?.blocks.length).toBeGreaterThan(0);
      for (const ref of rules?.blocks ?? []) expect(blockAt(fixture, ref)).toBeDefined();
    }
  });

  it("FR-PROC-004 never names a model, a candidate or the answer key in model input", () => {
    for (const fixture of fixtures) {
      const inputs = [
        JSON.stringify(migrationInputData(fixture)),
        buildKnowledgeGenerationInput(migrationInputData(fixture), 120000).input,
      ];
      for (const input of inputs)
        for (const marker of ["gemini", "candidate", "answer key"])
          expect(input.toLocaleLowerCase("en")).not.toContain(marker);
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

describe("PRD-QA-01 cross-model comparison design", () => {
  it("uses five explanation languages with four lessons each", () => {
    const languages = comparisonFixtures().map((fixture) => fixture.explanationLanguage);
    for (const language of ["fa", "ar", "es", "ja", "uk"])
      expect(languages.filter((entry) => entry === language)).toHaveLength(4);
  });
  it("changes only model, effort, physical cap and sampling between candidates", () => {
    const base = {
      version: "base",
      llmModel: "anthropic/claude-haiku-5.5",
      visionModel: "v",
      sttModel: "s",
      ttsModel: "t",
      voice: "x",
      promptVersion: "p",
      maxInputCharacters: 120000,
      maxOutputTokens: 6144,
      structuredTemperature: 0,
      timeoutMs: 90000,
      maximumMicros: 300000,
      currency: "USD" as const,
      priceVersion: "p",
      charactersPerPage: 3000,
      audioUrlSupported: false,
      sttProviderOptions: {},
      dataContractApproved: true,
    };
    for (const [id, candidate] of Object.entries(comparisonCandidates)) {
      const settings = comparisonSettings(base, id, candidate);
      expect(settings.maxOutputTokens).toBe(6144);
      expect(settings.promptVersion).toBe("p");
      expect(settings.structuredModelOverrides?.[candidate.model]).toMatchObject({
        structuredOutputMode: "json_object",
        maxRequestBytes: 400000,
        knowledgeContract: "content",
      });
      expect(usesContentKnowledgeContract(providerSettingsSchema.parse(settings))).toBe(true);
      expect(Boolean(settings.structuredModelOverrides?.[candidate.model]?.omitTemperature)).toBe(
        candidate.temperature === undefined,
      );
    }
  });
});
