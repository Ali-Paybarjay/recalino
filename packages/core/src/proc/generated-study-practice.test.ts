import { describe, expect, it } from "vitest";
import type { Claim, EvidenceSource, KnowledgeModel, SourceRef } from "../lkm";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";

const context = { version: 1 as const, declaredLevel: "A2" as const };
const sourceId = "11111111-1111-4111-8111-111111111111";
const contentVersionId = "22222222-2222-4222-8222-222222222222";
const example = "I look forward to meeting my new neighbours.";

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("fixture");
  return value;
}

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
    // The whole-block range the v5 wire always emits: the class sentence is inside it.
    recognition.claim.sourceRefs = [
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
    ];
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
    expect(result.audit).toMatchObject({
      version: "source-grounded-practice-2",
      recognitionClaimsKeptFromClass: 0,
      recognitionReclassifiedReasons: { recognition_uncertain: 1 },
    });
    // Certain, but the headword "preposition" never occurs in the class block.
    recognition.claim.uncertain = false;
    const certain = finalizeGeneratedStudyPractice(model, [source], context);
    expect(certain.model.learningItems[1]?.claim).toMatchObject({
      origin: "ai_expansion",
      evidence: "ai",
      sourceRefs: [],
    });
    expect(certain.audit.recognitionReclassifiedReasons).toEqual({
      recognition_headword_absent_from_anchoring_block: 1,
    });
    const legacy = finalizeGeneratedStudyPractice(model, [source]);
    expect(legacy.model.learningItems[1]).toEqual(recognition);
    expect(legacy.audit.recognitionClaimsReclassified).toBe(0);
    expect(legacy.audit.recognitionClaimsKeptFromClass).toBe(0);
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

const otherSourceId = "44444444-4444-4444-8444-444444444444";
const otherVersionId = "55555555-5555-4555-8555-555555555555";
const classSentence = "I look forward to meeting my new neighbours.";

function textSource(
  blocks: readonly string[],
  overrides: Partial<EvidenceSource> = {},
): EvidenceSource {
  return {
    sourceId,
    contentVersionId,
    kind: "text",
    role: "class_material",
    units: [{ id: "document", kind: "document", start: 1 }],
    blocks: blocks.map((text, index) => ({ id: `block-${index}`, unitId: "document", text })),
    ...overrides,
  };
}

function wholeBlock(source: EvidenceSource, blockId = "block-0"): SourceRef {
  const block = source.blocks.find((entry) => entry.id === blockId);
  if (!source.contentVersionId) throw new Error("fixture");
  return {
    sourceId: source.sourceId,
    contentVersionId: source.contentVersionId,
    locator: { kind: "text", blockId, start: 0, end: Array.from(block?.text ?? "").length },
  };
}

function audioSource(text: string, role: EvidenceSource["role"] = "class_audio"): EvidenceSource {
  return {
    sourceId: otherSourceId,
    contentVersionId: otherVersionId,
    kind: "audio",
    role,
    units: [{ id: "segment", kind: "time", start: 0, end: 4000 }],
    blocks: [{ id: "segment-text", unitId: "segment", text, speakerRole: "unknown" }],
  };
}

const audioRef: SourceRef = {
  sourceId: otherSourceId,
  contentVersionId: otherVersionId,
  locator: { kind: "time", startMs: 0, endMs: 4000 },
};

function recognitionModel(
  fields: { en: string; example: string; meaning?: string; note?: string; language?: string },
  refs: SourceRef[],
  claim: Partial<Claim> = {},
): KnowledgeModel {
  const meaning = fields.meaning ?? "A meaning written by the model.";
  return {
    schemaVersion: "1",
    title: "Synthetic class",
    language: { learning: "en", explanation: fields.language ?? "en" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      {
        id: "recognition",
        kind: "expression",
        front: fields.en,
        back: meaning,
        claim: {
          id: "recognition-claim",
          text: meaning,
          origin: "from_class",
          creation: "ai_generation",
          evidence: "material",
          sourceRefs: refs,
          speakerRole: "unknown",
          uncertain: false,
          ...claim,
        },
        study: {
          set: "recognition",
          en: fields.en,
          faMeaning: meaning,
          topic: "usage",
          example: fields.example,
          spoken: false,
          ...(fields.note ? { noteFa: fields.note } : {}),
        },
      },
    ],
  };
}

describe("AC-D46 recognition class provenance amended on 2026-10-09", () => {
  it("AC-D46 keeps an exact class sentence with its headword as class content with only the anchoring class refs", () => {
    const material = textSource([`😀 Class example: ${classSentence}`]);
    const audio = audioSource(classSentence);
    const model = recognitionModel({ en: "look forward to", example: classSentence }, [
      wholeBlock(material),
      audioRef,
    ]);
    const before = structuredClone(model);
    const result = finalizeGeneratedStudyPractice(model, [material, audio], context);
    const item = result.model.learningItems[0];
    expect(item?.claim).toEqual({
      ...before.learningItems[0]?.claim,
      id: expect.any(String),
      origin: "from_class",
      evidence: "material",
      speakerRole: "unknown",
      sourceRefs: [wholeBlock(material)],
    });
    expect(item?.study).toEqual({ ...before.learningItems[0]?.study, spoken: false });
    expect(result.audit).toMatchObject({
      version: "source-grounded-practice-2",
      recognitionClaimsKeptFromClass: 1,
      recognitionClaimsReclassified: 0,
      recognitionReclassifiedReasons: {},
    });
    expect(model).toEqual(before);
  });

  it("AC-D46 keeps a board photo range as class content", () => {
    const board = textSource(
      ["Turn right at the crossroads.", "crossroads = a place where roads meet"],
      {
        kind: "image",
        role: "board_photo",
        units: [{ id: "photo", kind: "document", start: 1 }],
      },
    );
    board.blocks = board.blocks.map((block) => ({ ...block, unitId: "photo" }));
    const model = recognitionModel(
      { en: "crossroads", example: "Turn right at the crossroads." },
      [wholeBlock(board)],
      { evidence: "board" },
    );
    const result = finalizeGeneratedStudyPractice(model, [board], context);
    expect(result.model.learningItems[0]?.claim).toMatchObject({
      origin: "from_class",
      evidence: "board",
      sourceRefs: [wholeBlock(board)],
    });
  });

  it.each([
    ["a one-word fragment", "recognition_example_too_short"],
    ["a match inside a word", "recognition_example_absent_from_cited_class_block"],
    ["audio-only evidence", "recognition_example_absent_from_cited_class_block"],
    ["personal notes", "recognition_user_notes_cited"],
    ["mixed class and personal-note refs", "recognition_user_notes_cited"],
    ["an uncertain claim", "recognition_uncertain"],
    ["an unrelated headword", "recognition_headword_absent_from_anchoring_block"],
    ["a model AI expansion", "recognition_model_ai_expansion"],
    ["an uncited class block", "recognition_example_absent_from_cited_class_block"],
    ["a curly-apostrophe class sentence", "recognition_example_absent_from_cited_class_block"],
  ])("AC-D46 keeps the AI Expansion label for %s", (name, reason) => {
    let sources: EvidenceSource[] = [textSource([`😀 Class example: ${classSentence}`])];
    let fields = { en: "look forward to", example: classSentence };
    let refs: SourceRef[] = [wholeBlock(first(sources))];
    let claim: Partial<Claim> = {};
    if (name === "a one-word fragment") {
      sources = [
        textSource([
          "Ask Whose ...? to ask who something belongs to: Whose jacket is this? It's Omar's.",
        ]),
      ];
      fields = { en: "possessive pronoun", example: "is" };
      refs = [wholeBlock(first(sources))];
    }
    if (name === "a match inside a word") {
      sources = [textSource(["Class example: Our relationship is strong."])];
      fields = { en: "ship", example: "ship is strong." };
      refs = [wholeBlock(first(sources))];
    }
    if (name === "audio-only evidence") {
      sources = [audioSource(classSentence)];
      refs = [audioRef];
      claim = { evidence: "audio" };
    }
    if (name === "personal notes") {
      sources = [textSource([`My notes: ${classSentence}`], { role: "user_notes" })];
      refs = [wholeBlock(first(sources))];
      claim = { evidence: "user_notes" };
    }
    if (name === "mixed class and personal-note refs") {
      const notes = textSource(["My notes: look forward to = wait happily."], {
        sourceId: otherSourceId,
        contentVersionId: otherVersionId,
        role: "user_notes",
      });
      sources = [first(sources), notes];
      refs = [wholeBlock(first(sources)), wholeBlock(notes)];
    }
    if (name === "an uncertain claim") claim = { uncertain: true };
    if (name === "an unrelated headword") {
      sources = [
        textSource([
          "A what-cleft puts the important information at the end for emphasis: What I need is more time.",
        ]),
      ];
      fields = { en: "noun clause as subject", example: "What I need is more time." };
      refs = [wholeBlock(first(sources))];
    }
    if (name === "a model AI expansion") {
      refs = [];
      claim = { origin: "ai_expansion", evidence: "ai" };
    }
    if (name === "an uncited class block") {
      sources = [
        textSource(["Look forward to is a phrasal verb.", `Class example: ${classSentence}`]),
      ];
      refs = [wholeBlock(first(sources))];
    }
    if (name === "a curly-apostrophe class sentence") {
      sources = [textSource(["Class example: It’s Omar’s jacket."])];
      fields = { en: "Omar's jacket", example: "It's Omar's jacket." };
      refs = [wholeBlock(first(sources))];
    }
    const model = recognitionModel(fields, refs, claim);
    const result = finalizeGeneratedStudyPractice(model, sources, context);
    expect(result.model.learningItems[0]?.claim).toMatchObject({
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    });
    expect(result.model.learningItems[0]?.study).toEqual(model.learningItems[0]?.study);
    expect(result.audit).toMatchObject({
      recognitionClaimsKeptFromClass: 0,
      recognitionClaimsReclassified: 1,
      recognitionReclassifiedReasons: { [reason]: 1 },
    });
  });

  it.each([
    {
      language: "fa",
      text: "Reading - Tom's first flight. Planes take off every ten minutes here, so the airport is always busy.",
      en: "take off",
      example: "Planes take off every ten minutes here",
      meaning: "۱) بلند شدن هواپیما ۲) درآوردن لباس ۳) ناگهان موفق و پرطرفدار شدن",
      note: "معنای سوم غیررسمی است: Her career took off after the film.",
    },
    {
      language: "ar",
      text: "get the hang of sth - By Friday you'll get the hang of it.",
      en: "get the hang of sth",
      example: "By Friday you'll get the hang of it.",
      meaning: "تعبير غير رسمي شائع في الإنجليزية الأمريكية، ولا يُستخدم في الكتابة الأكاديمية.",
    },
    {
      language: "es",
      text: "After can, use the base verb: She can swim.",
      en: "can + base verb",
      example: "She can swim.",
      meaning: "Después de can, must, should, might y will se usa siempre el verbo base.",
    },
    {
      language: "ja",
      text: "Capital letters: days and months. Class example: My birthday is in May.",
      en: "capital letters for nationalities",
      example: "My birthday is in May.",
      meaning: "Japanese や French のような国籍を表す語も大文字で始めます。",
    },
  ])(
    "AC-D46 documents the accepted residual: $language model-written senses on an anchored class sentence stay class content",
    ({ text, ...fields }) => {
      const source = textSource([text]);
      const model = recognitionModel(fields, [wholeBlock(source)]);
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.model.learningItems[0]?.claim.origin).toBe("from_class");
      expect(result.model.learningItems[0]?.study).toEqual(model.learningItems[0]?.study);
    },
  );
});

function homeworkModel(
  language: string,
  text: string,
  refs: SourceRef[],
  claim: Partial<Claim> = {},
): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Synthetic class",
    language: { learning: "en", explanation: language },
    summary: [],
    topics: [],
    homework: [
      {
        id: "homework",
        text,
        origin: "from_class",
        creation: "ai_generation",
        evidence: "material",
        sourceRefs: refs,
        speakerRole: "unknown",
        uncertain: false,
        ...claim,
      },
    ],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [],
  };
}

function boardPhoto(blocks: readonly string[]): EvidenceSource {
  const source = textSource(blocks, {
    kind: "image",
    role: "board_photo",
    units: [{ id: "photo", kind: "document", start: 1 }],
  });
  source.blocks = source.blocks.map((block) => ({ ...block, unitId: "photo" }));
  return source;
}

describe("PRD-NOTE-01 generated homework keeps only stated after-class assignments", () => {
  it.each([
    ["fa", "تکالیف جلسه بعد: تمرین ۳ و ۴ صفحه ۴۵", "تمرین ۳ و ۴ صفحه ۴۵ را برای جلسه بعد حل کنید."],
    ["ar", "الواجب: تمرين ٣ صفحة ٤٥", "حلّوا التمرين ٣ في الصفحة ٤٥ قبل الحصة القادمة."],
    [
      "es",
      "Deberes: ejercicio 3 de la página 45.",
      "Hagan el ejercicio 3 de la página 45 en casa.",
    ],
    ["ja", "宿題：p.45の練習問題3", "45ページの練習問題3をやってきてください。"],
    [
      "uk",
      "Домашнє завдання: вправа 3, с. 45.",
      "Виконайте вправу 3 на сторінці 45 до наступного уроку.",
    ],
  ])("PRD-NOTE-01 keeps a genuine %s class assignment as homework", (language, source, text) => {
    const material = textSource([source]);
    const model = homeworkModel(language, text, [wholeBlock(material)]);
    const result = finalizeGeneratedStudyPractice(model, [material], context);
    expect(result.model.homework).toEqual([{ ...model.homework[0], id: expect.any(String) }]);
    expect(result.model.summary).toEqual([]);
    expect(result.audit.homeworkClaimsDemoted).toBe(0);
  });

  it("PRD-NOTE-01 keeps board-photo, class-audio, personal-note and heading-announced assignments", () => {
    const board = boardPhoto(["HW:", "Workbook p. 12, ex. 1-3"]);
    const audio = audioSource("OK, for homework, do exercise three on page forty-five.");
    const notes = textSource(["HW for Monday: WB p. 34 ex 1-3"], { role: "user_notes" });
    const heading = textSource(["Homework", "Write five sentences using the present perfect."]);
    const citedHeading = textSource(["Homework:", "Workbook page 12, exercises 1-3."]);
    for (const [source, ref, evidence] of [
      [board, wholeBlock(board, "block-1"), "board"],
      [audio, audioRef, "audio"],
      [notes, wholeBlock(notes), "user_notes"],
      [heading, wholeBlock(heading, "block-1"), "material"],
      [citedHeading, wholeBlock(citedHeading), "material"],
    ] as const) {
      const model = homeworkModel("en", "Do the exercises set for after class.", [ref], {
        evidence,
      });
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.model.homework).toHaveLength(1);
      expect(result.audit.homeworkClaimsDemoted).toBe(0);
    }
  });

  it.each([
    [
      "a printed in-class task",
      "Printed task: Write your arrangement for tomorrow evening.",
      "class_material",
    ],
    [
      "a photo of another learner's homework",
      "Photo of Wei's homework from the Saturday class.",
      "user_notes",
    ],
    ["a do-not-try-this-at-home warning", "Do not do this at home.", "class_material"],
    ["a question about homework", "Did you finish your homework?", "class_material"],
    ["a no-homework statement", "No homework was assigned.", "class_material"],
  ] as const)(
    "PRD-NOTE-01 moves %s from homework to the class summary unchanged",
    (_name, text, role) => {
      const source = textSource([text], { role });
      const model = homeworkModel(
        "en",
        "Write your arrangement for tomorrow evening.",
        [wholeBlock(source)],
        {
          evidence: role === "user_notes" ? "user_notes" : "material",
        },
      );
      const claim = model.homework[0];
      for (const learner of [context, undefined]) {
        const result = finalizeGeneratedStudyPractice(model, [source], learner);
        expect(result.model.homework).toEqual([]);
        expect(result.model.summary).toEqual([{ ...claim, id: expect.any(String) }]);
        expect(result.audit).toMatchObject({ applied: !!learner, homeworkClaimsDemoted: 1 });
      }
    },
  );

  it("PRD-NOTE-01 moves homework under a distant or unrelated heading, and AI homework, to the summary", () => {
    const unrelated = textSource([
      "Exercise 2:",
      "Write five sentences using the present perfect.",
    ]);
    const distant = textSource([
      "Homework",
      ...Array.from({ length: 6 }, (_, index) => `Class sentence number ${index + 1}.`),
      "Write five sentences using the present perfect.",
    ]);
    for (const [source, refs, claim] of [
      [unrelated, [wholeBlock(unrelated, "block-1")], {}],
      [distant, [wholeBlock(distant, "block-7")], {}],
      [unrelated, [], { origin: "ai_expansion", evidence: "ai" }],
    ] as const) {
      const model = homeworkModel("en", "Write five sentences.", [...refs], claim);
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.model.homework).toEqual([]);
      expect(result.model.summary).toHaveLength(1);
      expect(result.audit.homeworkClaimsDemoted).toBe(1);
    }
  });

  it("PRD-NOTE-01 reads a heading with the content it announces, so a no-homework note moves to the summary", () => {
    for (const [source, blockId, evidence] of [
      [textSource(["Homework", "None this week."]), "block-1", "material"],
      [textSource(["Homework", "No homework this week."]), "block-1", "material"],
      [textSource(["Homework:", "None this week."]), "block-0", "material"],
      [textSource(["Homework:\nNone this week."]), "block-0", "material"],
      [boardPhoto(["HW:", "none"]), "block-1", "board"],
      [boardPhoto(["Homework", "No homework today!"]), "block-1", "board"],
    ] as const) {
      const model = homeworkModel(
        "en",
        "Write ten sentences about your weekend.",
        [wholeBlock(source, blockId)],
        { evidence },
      );
      const result = finalizeGeneratedStudyPractice(model, [source], context);
      expect(result.model.homework).toEqual([]);
      expect(result.model.summary).toEqual([{ ...model.homework[0], id: expect.any(String) }]);
      expect(result.audit.homeworkClaimsDemoted).toBe(1);
    }
  });

  it("PRD-NOTE-01 moves AI-expansion homework to the summary even when it cites a stated assignment", () => {
    const source = textSource(["Homework: Workbook page 34, exercises 1 and 2."]);
    const model = homeworkModel("en", "Do workbook page 34.", [wholeBlock(source)], {
      origin: "ai_expansion",
      evidence: "ai",
    });
    for (const learner of [context, undefined]) {
      const result = finalizeGeneratedStudyPractice(model, [source], learner);
      expect(result.model.homework).toEqual([]);
      expect(result.model.summary).toEqual([{ ...model.homework[0], id: expect.any(String) }]);
      expect(result.audit.homeworkClaimsDemoted).toBe(1);
    }
    const fromClass = homeworkModel("en", "Do workbook page 34.", [wholeBlock(source)]);
    expect(
      finalizeGeneratedStudyPractice(fromClass, [source], context).model.homework,
    ).toHaveLength(1);
  });

  it("PRD-NOTE-01 leaves an unsupported homework claim in place when the summary is already full", () => {
    const source = textSource(["Printed task: Write your arrangement for tomorrow evening."]);
    const model = homeworkModel("en", "Write your arrangement for tomorrow evening.", [
      wholeBlock(source),
    ]);
    model.summary = Array.from(
      { length: 100 },
      (_, index): Claim => ({
        id: `summary-${index}`,
        text: `Additional class summary point ${index + 1}.`,
        origin: "ai_expansion",
        creation: "ai_generation",
        evidence: "ai",
        sourceRefs: [],
        speakerRole: "unknown",
        uncertain: false,
      }),
    );
    for (const learner of [context, undefined]) {
      const result = finalizeGeneratedStudyPractice(model, [source], learner);
      expect(result.model.summary).toHaveLength(100);
      expect(result.model.homework).toEqual([{ ...model.homework[0], id: expect.any(String) }]);
      expect(result.audit).toMatchObject({
        homeworkClaimsDemoted: 0,
        homeworkClaimsKeptAtSummaryLimit: 1,
      });
    }
  });
});
