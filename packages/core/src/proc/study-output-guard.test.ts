import { describe, expect, it } from "vitest";
import { type LearningItem, validateKnowledgeModel } from "../lkm";
import type { generatedKnowledgeSchema } from "./generated-knowledge";
import { validateGeneratedKnowledge } from "./steps/knowledge-checks";
import { sanitizeGeneratedStudyGaps } from "./study-output-guard";

type Generated = ReturnType<typeof generatedKnowledgeSchema.parse>;

// D110: synthetic fixtures copying the shapes of the 2026-10-20 incident; no class content.
const words =
  "anchor beacon candle dagger ember falcon garnet harbor island jigsaw kettle lantern meadow nectar orchard pebble quiver ribbon saddle tunnel umbrella velvet walnut yonder zephyr bramble cobalt".split(
    " ",
  );
let itemNumber = 0;
function item(
  en: string,
  fullSentence: string,
  gapSentence: string | undefined,
  overrides: Partial<NonNullable<LearningItem["study"]>> = {},
): LearningItem {
  itemNumber += 1;
  return {
    id: `item-${itemNumber}`,
    kind: "expression",
    front: en,
    back: "A synthetic meaning.",
    claim: {
      id: `item-claim-${itemNumber}`,
      text: "A synthetic teaching point.",
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
      uncertain: false,
    },
    study: {
      set: "production",
      kind: "collocation",
      en,
      topic: "synthetic",
      ipa: "/sɪnˈθetɪk/",
      faMeaning: "A synthetic meaning.",
      fullSentence,
      ...(gapSentence === undefined ? {} : { gapSentence }),
      collocations: [],
      noteFa: "A synthetic note.",
      imageFa: "A synthetic picture.",
      sourceFa: "Synthetic example.",
      ...overrides,
    } as NonNullable<LearningItem["study"]>,
  };
}
const filler = (index: number) =>
  item(
    words[index] ?? `word${index}`,
    `We see the ${words[index]} today.`,
    `We see the ______ today.`,
  );
const fillers = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => filler(from + index));
// The incident's shapes, rewritten as synthetic sentences.
const momentum = () =>
  item(
    "gain momentum",
    "The plan has gradually gained momentum, with new members every week.",
    "The plan has gradually ______ , with new members every week.",
  );
const cloak = () =>
  item(
    "a cloak of anonymity",
    "Some users hide behind a cloak of anonymity, making abuse easier.",
    "Some users hide behind ______ , making abuse easier.",
  );
const conceal = () =>
  item(
    "conceal",
    "Some people conceal their names online.",
    "Some people conceal their names online.",
  );
const slogan = () =>
  item(
    "no face, no case",
    "They said no face, no case, and laughed.",
    "They said ______, and laughed.",
  );
function lesson(learningItems: LearningItem[], mistakeItems: string[] = []): Generated {
  return {
    schemaVersion: "1",
    title: "Synthetic lesson",
    language: { learning: "en", explanation: "en" },
    summary: [],
    topics: [],
    learningItems,
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    classNotes: {
      date: "2026-10-20",
      coverage: "A synthetic lesson.",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
      mistakes: {
        speechStatus: "no_audio",
        patterns: [],
        items: mistakeItems.map((itemId) => ({
          source: "handwriting",
          said: "A **synthetic** mistake.",
          correct: "A corrected mistake.",
          whyFa: "A synthetic reason.",
          kind: "grammar",
          teacherCorrected: false,
          itemId,
        })),
      },
    },
    sourceClassifications: [],
  };
}
const check = (generated: Generated, productionLimit = 18, salvage = true, extra = {}) =>
  validateGeneratedKnowledge(generated, [], [], "en", { productionLimit, salvage, ...extra });
const thrown = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
};
const code = (error: unknown) =>
  (error as { details?: { fields?: { output?: unknown } } }).details?.fields?.output;
const gaps = (model: { learningItems: LearningItem[] }) =>
  model.learningItems.map((entry) =>
    entry.study?.set === "production" ? entry.study.gapSentence : undefined,
  );

describe("sanitizeGeneratedStudyGaps (D110)", () => {
  it("rebuilds a gap whose only difference is whitespace beside a blank", () => {
    const result = sanitizeGeneratedStudyGaps(lesson([momentum(), cloak()]));
    expect(gaps(result.model)).toEqual([
      "The plan has gradually ______, with new members every week.",
      "Some users hide behind ______, making abuse easier.",
    ]);
    expect([result.spacing, result.derivedBlank]).toEqual([2, 0]);
  });
  it("derives the blank of a single uninflected occurrence", () => {
    const result = sanitizeGeneratedStudyGaps(lesson([conceal()]));
    expect(gaps(result.model)).toEqual(["Some people ______ their names online."]);
    expect([result.spacing, result.derivedBlank]).toEqual([0, 1]);
    const absent = item("conceal", "They conceal it well.", undefined);
    expect(gaps(sanitizeGeneratedStudyGaps(lesson([absent])).model)).toEqual([
      "They ______ it well.",
    ]);
  });
  it.each([
    ["an inflected answer elsewhere", "conceal", "They conceal what was concealed before."],
    ["a joined word", "conceal", "Their conceal-ment was total."],
    ["only an inflected form", "conceal", "They concealed it well."],
    ["two occurrences", "conceal", "Conceal it, then conceal them."],
    ["a separable target", "kit sb/sth out", "We kit the room out today."],
    ["an unsupported target", "no face, no case", "They said no face, no case."],
  ])("never derives a blank with %s", (_case, en, full) => {
    const value = lesson([item(en, full, full)]);
    const result = sanitizeGeneratedStudyGaps(value);
    expect(result.model).toBe(value);
    expect([result.spacing, result.derivedBlank]).toEqual([0, 0]);
  });
  it("leaves a different wording, a hint, a grammar task and a valid gap untouched", () => {
    const value = lesson([
      item(
        "a cloak of anonymity",
        "Some users hide behind a cloak of anonymity, making abuse easier.",
        "Some users hide under ______ , making abuse easier.",
      ),
      item("gain momentum", "It gained momentum, with time.", "It g______ , with time."),
      item("third person -s", "She walks home.", "She walks home.", {
        kind: "grammar",
        taskFa: "Correct the verb.",
        prompt: "She walk home.",
      }),
      filler(0),
    ]);
    const result = sanitizeGeneratedStudyGaps(value);
    expect(result.model).toBe(value);
    expect([result.spacing, result.derivedBlank]).toEqual([0, 0]);
  });
  it("is idempotent and keeps passing items byte-identical", () => {
    const value = lesson([filler(0), momentum(), conceal(), filler(1)]);
    const once = sanitizeGeneratedStudyGaps(value);
    const twice = sanitizeGeneratedStudyGaps(once.model);
    expect(twice.model).toBe(once.model);
    expect([twice.spacing, twice.derivedBlank]).toEqual([0, 0]);
    expect(once.model.learningItems[0]).toBe(value.learningItems[0]);
    expect(once.model.learningItems[3]).toBe(value.learningItems[3]);
  });
});

describe("validateGeneratedKnowledge with the D110 guard", () => {
  it("publishes the run-1 shape with 17 cards: one gap respaced, the slogan dropped", () => {
    const run1 = lesson([...fillers(16), momentum(), slogan()]);
    // Strict, the sanitized lesson still fails on the slogan, which no repair can fix.
    expect(code(thrown(() => check(run1, 18, false)))).toEqual(["study_target_unsupported"]);
    const { model, audit } = check(run1);
    expect(model.learningItems.filter((entry) => entry.study?.set === "production")).toHaveLength(
      17,
    );
    expect(audit).toEqual({
      version: "study-output-guard-1",
      productionLimit: 18,
      gapsRebuilt: { spacing: 1, derivedBlank: 0 },
      droppedItems: { study_target_unsupported: 1 },
      trimmedOverLimit: 0,
      unlinkedMistakes: 0,
      assemblyOmitted: {},
    });
    // The published model is itself valid, and a second validation changes nothing.
    expect(validateKnowledgeModel(model, [], "en")).toEqual(model);
    const again = check({ ...model, sourceClassifications: [] }, 18, false);
    expect(again.model.learningItems.map((entry) => entry.id)).toEqual(
      model.learningItems.map((entry) => entry.id),
    );
  });
  it("publishes the run-2 shape within the allowance, unlinking the dropped card's mistake", () => {
    const run2 = lesson([...fillers(16), conceal(), cloak(), slogan()]);
    const sloganId = run2.learningItems[18]?.id ?? "";
    const firstId = run2.learningItems[0]?.id ?? "";
    const { model, audit } = check(
      { ...run2, ...lesson(run2.learningItems, [sloganId, firstId]) },
      18,
      true,
      {
        assemblyOmitted: { omitted: { study_gap_partial: 1 }, omittedProduction: 1 },
      },
    );
    expect(model.learningItems).toHaveLength(18);
    expect(audit).toMatchObject({
      gapsRebuilt: { spacing: 1, derivedBlank: 1 },
      droppedItems: { study_target_unsupported: 1 },
      trimmedOverLimit: 0,
      unlinkedMistakes: 1,
      assemblyOmitted: { study_gap_partial: 1 },
    });
    const mistakes = model.classNotes?.mistakes?.items ?? [];
    expect(mistakes).toHaveLength(2);
    expect(mistakes[0]).not.toHaveProperty("itemId");
    expect(mistakes[1]?.itemId).toBe(model.learningItems[0]?.id);
  });
  it("keeps the first valid cards in model order beyond the limit, not counted as invalid", () => {
    const value = lesson(fillers(20));
    const trimmedId = value.learningItems[19]?.id ?? "";
    expect(code(thrown(() => check(value, 18, false)))).toEqual(["study_core_limit"]);
    const { model, audit } = check(lesson(value.learningItems, [trimmedId]));
    expect(model.learningItems.map((entry) => entry.front)).toEqual(words.slice(0, 18));
    expect(audit).toMatchObject({ trimmedOverLimit: 2, droppedItems: {}, unlinkedMistakes: 1 });
    expect(model.classNotes?.mistakes?.items).toHaveLength(1);
  });
  it("D78 accepts 21 cards at a marked lesson's limit and 25 at the ceiling", () => {
    expect(check(lesson(fillers(21)), 21, false).model.learningItems).toHaveLength(21);
    expect(check(lesson(fillers(25)), 25, false).model.learningItems).toHaveLength(25);
    expect(code(thrown(() => check(lesson(fillers(22)), 21, false)))).toEqual(["study_core_limit"]);
  });
  it("fails exactly as before beyond the allowance, with nothing dropped", () => {
    // 18 cards allow max(2, 3) = 3 invalid cards; the fourth restores today's failure.
    const value = lesson([...fillers(14), slogan(), slogan(), slogan(), slogan()]);
    const strict = thrown(() => check(value, 18, false));
    expect(thrown(() => check(value))).toEqual(strict);
    expect(code(strict)).toEqual(["study_target_unsupported"]);
    // Assembly omissions count toward the same allowance.
    const fewer = lesson([...fillers(15), slogan(), slogan()]);
    expect(check(fewer).model.learningItems).toHaveLength(15);
    expect(
      code(
        thrown(() =>
          check(fewer, 18, true, {
            assemblyOmitted: { omitted: { study_gap_partial: 2 }, omittedProduction: 2 },
          }),
        ),
      ),
    ).toEqual(["study_target_unsupported"]);
  });
  it("never drops cards for a lesson-wide problem", () => {
    const wrongLanguage = lesson([...fillers(5), slogan()]);
    wrongLanguage.language.explanation = "fa";
    expect(code(thrown(() => check(wrongLanguage)))).toEqual(["language_mismatch"]);
    // A mistake linked to a recognition card is the lesson's problem, not one card's.
    const recognition: LearningItem = {
      ...filler(6),
      study: {
        set: "recognition",
        en: "yonder",
        faMeaning: "A synthetic meaning.",
        topic: "synthetic",
        example: "Over yonder.",
        spoken: false,
      },
    };
    const linked = lesson([...fillers(5), slogan(), recognition], [recognition.id]);
    const strict = thrown(() => check(linked, 18, false));
    expect(thrown(() => check(linked))).toEqual(strict);
    expect(code(strict)).toEqual(["study_target_unsupported"]);
    const notes = lesson([...fillers(5), slogan()]);
    // Class notes in the wrong script: dropping the slogan cannot fix them.
    if (notes.classNotes) notes.classNotes.sourceNote = "درس مصنوعی.";
    expect(code(thrown(() => check(notes)))).toEqual(["study_target_unsupported"]);
    const summary = lesson([...fillers(5)]);
    summary.summary = [
      {
        id: "s",
        text: "A synthetic claim.",
        origin: "from_class",
        creation: "ai_generation",
        evidence: "material",
        sourceRefs: [],
        speakerRole: "unknown",
        uncertain: false,
      },
    ];
    expect(code(thrown(() => check(summary)))).toEqual(["class_evidence_missing"]);
  });
  it("keeps at least one production card, except for a part of a multi-part lesson", () => {
    const value = lesson([slogan(), slogan()]);
    expect(code(thrown(() => check(value)))).toEqual(["study_target_unsupported"]);
    const part = check(value, 18, true, { floor: false });
    expect(part.model.learningItems).toEqual([]);
    expect(part.audit.droppedItems).toEqual({ study_target_unsupported: 2 });
  });
  it("is deterministic and records only code-owned counts", () => {
    const run2 = lesson([...fillers(16), conceal(), cloak(), slogan()]);
    const first = check(run2);
    expect(check(run2)).toEqual(first);
    const audit = JSON.stringify(first.audit);
    for (const text of ["no face", "conceal", "cloak", "anchor", "Some people", "synthetic"])
      expect(audit).not.toContain(text);
  });
});
