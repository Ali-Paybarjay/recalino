import { describe, expect, it } from "vitest";
import type { EvidenceSource, KnowledgeModel } from "../lkm";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";

const context = { version: 1 as const, declaredLevel: "A2" as const };
const sourceId = "11111111-1111-4111-8111-111111111111";
const contentVersionId = "22222222-2222-4222-8222-222222222222";
const example = "I look forward to meeting my new neighbours.";

function fixture(sentence = example) {
  const source: EvidenceSource = {
    sourceId,
    contentVersionId,
    kind: "text",
    role: "class_material",
    units: [{ id: "document", kind: "document", start: 1 }],
    blocks: [{ id: "example", unitId: "document", text: `😀 Class example: ${sentence}` }],
  };
  const model: KnowledgeModel = {
    schemaVersion: "1",
    title: "Synthetic class",
    language: { learning: "en", explanation: "en" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      {
        id: "item",
        kind: "expression",
        front: "look forward to + -ing / noun",
        back: "Feel pleased about a future event",
        claim: {
          id: "claim",
          text: "The class explains looking forward to meeting neighbours.",
          origin: "from_class",
          creation: "ai_generation",
          evidence: "material",
          sourceRefs: [
            {
              sourceId,
              contentVersionId,
              locator: { kind: "text", blockId: "example", start: 0, end: 2 },
            },
          ],
          speakerRole: "unknown",
          uncertain: false,
        },
        study: {
          set: "production",
          en: "look forward to + -ing / noun",
          faMeaning: "Feel pleased about a future event",
          topic: "plans",
          ipa: "/lʊk ˈfɔːwəd tə/",
          fullSentence: sentence,
          gapSentence: sentence.replace("look forward to", "______"),
          collocations: [],
          noteFa: "The preposition is followed by a noun or -ing form.",
          imageFa: "Imagine a future visit.",
          sourceFa: "Printed class example",
        },
      },
    ],
    classNotes: {
      date: "2026-10-07",
      coverage: "Plans",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [{ sentence: "I ______ this lesson.", answer: "have enjoyed" }],
    },
  };
  return { model, source };
}

describe("AC-D46 generation-only grounded practice", () => {
  it("replaces optional generated exercises with one exact literal word from the cited class example", () => {
    const { model, source } = fixture();
    const before = structuredClone(model);
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.model.classNotes?.gapfill).toEqual([
      { sentence: "I look forward ______ meeting my new neighbours.", answer: "to" },
    ]);
    const exercise = result.model.classNotes?.gapfill[0];
    expect(exercise?.sentence.replace("______", exercise.answer)).toBe(example);
    expect(result.audit).toMatchObject({
      applied: true,
      derivedExercises: 1,
      replacedGeneratedExercises: 1,
      canonicalizedTextRefs: 1,
    });
    expect(model).toEqual(before);
    expect(result.model.learningItems[0]?.claim).toMatchObject({
      ...before.learningItems[0]?.claim,
      id: expect.any(String),
      sourceRefs: [
        {
          sourceId,
          contentVersionId,
          locator: {
            kind: "text",
            blockId: "example",
            start: 0,
            end: Array.from(source.blocks[0]?.text ?? "").length,
          },
        },
      ],
    });
    expect(result.model.learningItems[0]?.study).toEqual(before.learningItems[0]?.study);
  });

  it("preserves the optional practice and references of legacy run settings without a snapshot", () => {
    const { model, source } = fixture();
    const result = finalizeGeneratedStudyPractice(model, [source]);
    expect(result.audit.applied).toBe(false);
    expect(result.model).toEqual(model);
  });

  it.each(["source", "version", "block", "negative", "empty", "beyond-code-points"])(
    "never canonicalizes an invalid %s reference",
    (invalid) => {
      const { model, source } = fixture();
      const ref = model.learningItems[0]?.claim.sourceRefs[0];
      if (ref?.locator.kind !== "text") throw new Error("fixture");
      if (invalid === "source") ref.sourceId = "33333333-3333-4333-8333-333333333333";
      if (invalid === "version") ref.contentVersionId = "33333333-3333-4333-8333-333333333333";
      if (invalid === "block") ref.locator.blockId = "other";
      if (invalid === "negative") ref.locator.start = -1;
      if (invalid === "empty") ref.locator.start = ref.locator.end;
      if (invalid === "beyond-code-points") ref.locator.end = source.blocks[0]?.text.length ?? 1000;
      expect(() => finalizeGeneratedStudyPractice(model, [source], context)).toThrow();
    },
  );

  it.each(["ai_expansion", "uncertain", "different-block", "different-example", "user_notes"])(
    "omits unsupported practice: %s",
    (unsupported) => {
      const { model, source } = fixture();
      const item = model.learningItems[0];
      if (!item) throw new Error("fixture");
      if (unsupported === "ai_expansion")
        Object.assign(item.claim, { origin: "ai_expansion", evidence: "ai" });
      if (unsupported === "uncertain") item.claim.uncertain = true;
      if (unsupported === "different-block") {
        source.blocks = [
          { id: "example", text: "A separate explanation." },
          ...source.blocks.map((block) => ({ ...block, id: "uncited-example" })),
        ];
      }
      if (unsupported === "different-example")
        source.blocks = [{ id: "example", text: "I look forward to meeting a friend." }];
      if (unsupported === "user_notes") {
        source.role = "user_notes";
        item.claim.evidence = "user_notes";
      }
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.model.classNotes?.gapfill).toEqual([]);
      expect(Object.values(result.audit.omittedCandidates)).toEqual([1]);
    },
  );

  it("preserves exact punctuation/case/spacing and skips ambiguous repeated target words", () => {
    const original = "I look forward to meeting my new neighbours,  too!";
    const { model, source } = fixture(original);
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    const exercise = result.model.classNotes?.gapfill[0];
    expect(exercise?.sentence.replace("______", exercise.answer)).toBe(original);
    const repeated = fixture("I look forward to meeting them; I look forward to meeting you.");
    const study = repeated.model.learningItems[0]?.study;
    if (study?.set !== "production") throw new Error("fixture");
    study.gapSentence = "I ______ meeting them; I ______ meeting you.";
    expect(
      finalizeGeneratedStudyPractice(repeated.model, [repeated.source], context).model.classNotes
        ?.gapfill,
    ).toEqual([]);
  });

  it("falls back to another unique lexical word when the final particle occurs more than once", () => {
    const sentence = "I look forward to meeting you to discuss plans.";
    const { model, source } = fixture(sentence);
    expect(
      finalizeGeneratedStudyPractice(model, [source], context).model.classNotes?.gapfill,
    ).toEqual([{ sentence: "I look ______ to meeting you to discuss plans.", answer: "forward" }]);
  });

  it("uses only the cited native PDF block and preserves its page reference", () => {
    const { model, source } = fixture();
    source.kind = "pdf";
    source.units = [{ id: "page", kind: "page", start: 1 }];
    source.blocks = source.blocks.map((block) => ({ ...block, unitId: "page" }));
    const ref = model.learningItems[0]?.claim.sourceRefs[0];
    if (!ref) throw new Error("fixture");
    ref.locator = { kind: "page", page: 1, blockId: "example" };
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.audit.canonicalizedTextRefs).toBe(0);
    expect(result.audit.derivedExercises).toBe(1);
    expect(result.model.learningItems[0]?.claim.sourceRefs[0]?.locator).toEqual(ref.locator);
    ref.locator.blockId = null;
    expect(finalizeGeneratedStudyPractice(model, [source], context).audit.derivedExercises).toBe(0);
  });

  it.each(["pdf", "audio"] as const)(
    "never expands a non-native text locator on a %s block",
    (kind) => {
      const { model, source } = fixture();
      source.kind = kind;
      source.units = [
        kind === "pdf"
          ? { id: "native", kind: "page", start: 1 }
          : { id: "native", kind: "time", start: 0, end: 1000 },
      ];
      source.blocks = source.blocks.map((block) => ({ ...block, unitId: "native" }));
      const ref = model.learningItems[0]?.claim.sourceRefs[0];
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.audit.canonicalizedTextRefs).toBe(0);
      expect(result.model.learningItems[0]?.claim.sourceRefs[0]).toEqual(ref);
      expect(result.audit.derivedExercises).toBe(0);
    },
  );

  it.each(["item", "study"])("leaves %s grammar practice to its existing card", (where) => {
    const { model, source } = fixture();
    const item = model.learningItems[0];
    if (item?.study?.set !== "production") throw new Error("fixture");
    if (where === "item") item.kind = "grammar";
    else
      Object.assign(item.study, {
        kind: "grammar",
        taskFa: "Complete the phrase.",
        prompt: "I ... meeting my new neighbours.",
      });
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.audit.omittedCandidates).toEqual({ grammar_has_own_card_task: 1 });
    expect(result.model.classNotes?.gapfill).toEqual([]);
  });

  it("never derives practice from anonymous audio, even with a class-material role", () => {
    const { model, source } = fixture();
    source.kind = "audio";
    source.units = [{ id: "time", kind: "time", start: 0, end: 1000 }];
    source.blocks = source.blocks.map((block) => ({
      ...block,
      unitId: "time",
      speakerRole: "unknown",
    }));
    const item = model.learningItems[0];
    const ref = item?.claim.sourceRefs[0];
    if (!item || !ref) throw new Error("fixture");
    item.claim.evidence = "audio";
    ref.locator = { kind: "time", startMs: 0, endMs: 1000 };
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.audit.derivedExercises).toBe(0);
    expect(result.audit.canonicalizedTextRefs).toBe(0);
    expect(result.model.learningItems[0]?.claim.sourceRefs[0]?.locator).toEqual(ref.locator);
  });

  it("retains the actual removed spelling and does not create practice with another blank marker", () => {
    const upper = fixture("I look forward TO meeting my new neighbours.");
    if (upper.model.learningItems[0]?.study?.set !== "production") throw new Error("fixture");
    upper.model.learningItems[0].study.gapSentence = "I ______ meeting my new neighbours.";
    expect(
      finalizeGeneratedStudyPractice(upper.model, [upper.source], context).model.classNotes
        ?.gapfill[0]?.answer,
    ).toBe("TO");
    const blank = fixture("I look forward to meeting my __ neighbours.");
    expect(
      finalizeGeneratedStudyPractice(blank.model, [blank.source], context).audit.derivedExercises,
    ).toBe(0);
  });

  it("keeps recognition explanations verbatim while conservatively attributing them as AI Expansion", () => {
    const { model, source } = fixture();
    const original = model.learningItems[0];
    if (!original) throw new Error("fixture");
    const recognition = structuredClone(original);
    recognition.id = "recognition";
    recognition.claim.id = "recognition-claim";
    recognition.claim.uncertain = true;
    recognition.study = {
      set: "recognition",
      en: "preposition",
      faMeaning: "A word that shows a relationship.",
      topic: "grammar",
      example,
      spoken: false,
      noteFa: "An additional definition.",
      ipa: "/ˌprepəˈzɪʃən/",
    };
    model.learningItems.push(recognition);
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.audit.recognitionClaimsReclassified).toBe(1);
    expect(result.model.learningItems[1]?.study).toEqual(recognition.study);
    expect(result.model.learningItems[1]?.claim).toEqual({
      ...recognition.claim,
      id: expect.any(String),
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    });
    expect(result.model.learningItems[1]?.claim.uncertain).toBe(true);
    const legacy = finalizeGeneratedStudyPractice(model, [source]);
    expect(legacy.model.learningItems[1]).toEqual(recognition);
    expect(legacy.audit.recognitionClaimsReclassified).toBe(0);
  });

  it("keeps recognition teaching as AI prose rather than a verified teacher speech quote", () => {
    const { model, source } = fixture();
    source.kind = "audio";
    source.role = "class_audio";
    source.units = [{ id: "audio", kind: "time", start: 0, end: 1000 }];
    source.blocks = [{ id: "example", unitId: "audio", text: example, speakerRole: "teacher" }];
    const item = model.learningItems[0];
    if (!item) throw new Error("fixture");
    item.claim.evidence = "audio";
    item.claim.speakerRole = "teacher";
    item.claim.sourceRefs = [
      { sourceId, contentVersionId, locator: { kind: "time", startMs: 0, endMs: 1000 } },
    ];
    item.study = {
      set: "recognition",
      en: "preposition",
      faMeaning: "A word that shows a relationship.",
      topic: "grammar",
      example,
      spoken: true,
    };
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.model.learningItems[0]?.study).toEqual({ ...item.study, spoken: false });
    expect(result.model.learningItems[0]?.claim).toMatchObject({
      origin: "ai_expansion",
      evidence: "ai",
      speakerRole: "unknown",
      sourceRefs: [],
    });
  });

  it("remaps mistake item links when source references change content IDs", () => {
    const { model, source } = fixture();
    if (!model.classNotes) throw new Error("fixture");
    model.classNotes.mistakes = {
      speechStatus: "no_audio",
      patterns: [],
      items: [
        {
          source: "handwriting",
          said: "**meet**",
          correct: "**meeting**",
          whyFa: "Use the -ing form.",
          kind: "grammar",
          teacherCorrected: true,
          itemId: "item",
        },
      ],
    };
    const result = finalizeGeneratedStudyPractice(model, [source], context);
    expect(result.model.learningItems[0]?.id).not.toBe("item");
    expect(result.model.classNotes?.mistakes?.items[0]?.itemId).toBe(
      result.model.learningItems[0]?.id,
    );
  });
});
