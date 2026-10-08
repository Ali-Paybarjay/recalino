import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createJsonFallbackTransport, ProviderError, structuredSchemaComplexity } from "../aip";
import {
  assignGeneratedKnowledgeIds,
  knowledgeModelSchema,
  normalizeGeneratedStudyModel,
  renderClassNotesHtml,
  validateKnowledgeModel,
} from "../lkm";
import type { RunSource } from "./contracts";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
} from "./knowledge-generation";

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("fixture");
  return value;
}

function source(kind: RunSource["kind"] = "text"): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: randomUUID(),
    sha256: "a".repeat(64),
    kind,
    mimeType: "text/plain",
    role: "class_material",
    durationMs: null,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: [{ id: "unit", kind: "document", start: 1, status: "extracted" }],
    blocks: [
      {
        id: "block",
        unitId: "unit",
        kind: "paragraph",
        text: "I look forward to meeting my new neighbours. 😀 Look forward to means anticipate with pleasure; to is a preposition.",
      },
    ],
  };
}
function input(
  sources: RunSource[] = [source()],
  explanationLanguage = "fa",
): KnowledgeGenerationInput {
  return {
    sources,
    explanationLanguage,
    missingSourceIds: [],
    teachingPreferences: { shorterExamples: true },
    lessonContext: { date: "2026-10-08", course: "Synthetic class" },
    learnerContext: { version: 1, declaredLevel: "B1", goal: "general" },
  };
}
function claim(evidenceKeys: string[] = ["r0"]) {
  return { text: "این عبارت یعنی با اشتیاق منتظر اتفاقی بودن.", evidenceKeys, uncertain: false };
}
function lexical() {
  return {
    type: "lexical",
    kind: "expression",
    studyKind: "",
    claim: claim(),
    en: "look forward to + -ing / noun",
    faMeaning: "با اشتیاق منتظر اتفاقی بودن",
    topic: "anticipation",
    ipa: "/lʊk ˈfɔːwəd tə/",
    faApprox: "لوک فُروِد تَ",
    trap: "",
    taskFa: "",
    prompt: "",
    example: "",
    fullSentence: "I look forward to meeting my new neighbours.",
    gapSentence: "I ______ meeting my new neighbours.",
    collocations: ["look forward to the weekend"],
    noteFa: "بعد از حرف اضافه to، اسم یا فعل با ing می‌آید.",
    imageFa: "کسی که مشتاق دیدن همسایه‌های تازه است.",
  };
}
function grammar() {
  const { type: _type, kind: _kind, gapSentence: _gap, ...base } = lexical();
  return {
    ...base,
    type: "grammar",
    kind: "grammar",
    gapSentence: "",
    en: "third-person positive simple present",
    fullSentence: "She walks to the small shop every morning.",
    taskFa: "فعل جمله را درست کنید.",
    prompt: "Correct the verb: She walk to the small shop every morning.",
  };
}
function output() {
  return {
    title: "Look forward to",
    learningItems: [lexical()],
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    classNotes: {
      coverage: "درس درباره منتظر بودن با اشتیاق است.",
      sourceNote: "",
      coreIntro: "",
      oralIntro: "",
      chunks: [],
      board: [],
      tasks: [],
      culture: [],
      register: [],
      mistakes: { noteFa: "", items: [] },
    },
  };
}
function recognitionItem() {
  return {
    ...lexical(),
    type: "recognition",
    kind: "vocabulary",
    fullSentence: "",
    gapSentence: "",
    taskFa: "",
    prompt: "",
    imageFa: "",
    collocations: [],
    noteFa: "",
    example: lexical().fullSentence,
  };
}
function itemsBlock(
  items: { prompt: string; learnerAnswer?: string; model: string; whyFa?: string }[],
) {
  return {
    type: "items",
    text: "",
    headers: [],
    rows: [],
    items: items.map((item) => ({ learnerAnswer: "", whyFa: "", ...item })),
  };
}
/** Group the existing content fixtures without altering any field or unknown key. */
function wire(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const result = { ...value };
  if (Array.isArray(value.learningItems))
    result.learningItems = value.learningItems.map((rawItem) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return rawItem;
      const item = rawItem as Record<string, unknown>;
      if ("identity" in item) return item;
      const {
        type,
        kind,
        studyKind,
        claim,
        en,
        faMeaning,
        topic,
        ipa,
        faApprox,
        trap,
        fullSentence,
        gapSentence,
        taskFa,
        prompt,
        example,
        collocations,
        noteFa,
        imageFa,
        ...unknownFields
      } = item;
      return {
        ...unknownFields,
        identity: { type, kind, studyKind },
        claim,
        meaning: { en, faMeaning, topic },
        pronunciation: { ipa, faApprox, trap },
        practice: { fullSentence, gapSentence, taskFa, prompt, example },
        teaching: { collocations, noteFa, imageFa },
      };
    });
  if (
    value.classNotes &&
    typeof value.classNotes === "object" &&
    !Array.isArray(value.classNotes)
  ) {
    const notes = value.classNotes as Record<string, unknown>;
    if (!("orientation" in notes)) {
      const {
        coverage,
        sourceNote,
        coreIntro,
        oralIntro,
        chunks,
        board,
        tasks,
        culture,
        register,
        mistakes,
        ...unknownFields
      } = notes;
      result.classNotes = {
        ...unknownFields,
        coverage,
        orientation: { sourceNote, coreIntro, oralIntro },
        activities: { chunks, board, tasks, culture, register },
        mistakes,
      };
    }
  }
  return result;
}
const prepare = (data = input()) => buildKnowledgeGenerationInput(data, 120000);

describe("FR-PROC-004 compact knowledge generation", () => {
  it("assembles canonical metadata and missing empty sections without asking the provider", () => {
    const data = input();
    const result = prepare(data).decode(wire(output()));
    expect(result).toMatchObject({
      schemaVersion: "1",
      language: { learning: "en", explanation: "fa" },
      coverage: { complete: true, missingSourceIds: [] },
    });
    expect(result.learningItems[0]).toMatchObject({
      kind: "expression",
      front: lexical().en,
      back: lexical().faMeaning,
      claim: {
        origin: "from_class",
        creation: "ai_generation",
        evidence: "material",
        speakerRole: "unknown",
        uncertain: false,
      },
      study: { set: "production", sourceFa: "از کلاس" },
    });
    expect(result.classNotes).toMatchObject({
      date: "2026-10-08",
      course: "Synthetic class",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
      mistakes: { speechStatus: "no_audio", items: [], patterns: [] },
    });
    expect(result.learningItems[0]?.id).toMatch(/^item-[a-f0-9]{24}-1$/);
    expect(prepare(data).decode(wire(output()))).toEqual(result);
  });

  it("maps grouped v3 content to the same complete canonical lesson contract", () => {
    const data = input();
    const original = first(data.sources);
    const item = lexical();
    const legacyCanonical = knowledgeModelSchema.parse({
      schemaVersion: "1",
      title: output().title,
      language: { learning: "en", explanation: "fa" },
      summary: [],
      topics: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
      learningItems: [
        {
          id: "item-0",
          kind: item.kind,
          front: item.en,
          back: item.faMeaning,
          claim: {
            id: "item-claim-0",
            text: item.claim.text,
            origin: "from_class",
            creation: "ai_generation",
            evidence: "material",
            speakerRole: "unknown",
            uncertain: false,
            sourceRefs: [
              {
                sourceId: original.sourceId,
                contentVersionId: original.contentVersionId,
                locator: {
                  kind: "text",
                  blockId: "block",
                  start: 0,
                  end: Array.from(first(original.blocks).text).length,
                },
              },
            ],
          },
          study: {
            set: "production",
            en: item.en,
            faMeaning: item.faMeaning,
            topic: item.topic,
            ipa: item.ipa,
            faApprox: item.faApprox,
            fullSentence: item.fullSentence,
            gapSentence: item.gapSentence,
            collocations: item.collocations,
            noteFa: item.noteFa,
            imageFa: item.imageFa,
            sourceFa: "از کلاس",
          },
        },
      ],
      classNotes: {
        coverage: output().classNotes.coverage,
        ...data.lessonContext,
        chunks: [],
        board: [],
        tasks: [],
        culture: [],
        register: [],
        gapfill: [],
        mistakes: { speechStatus: "no_audio", patterns: [], items: [] },
      },
    });
    const expected = assignGeneratedKnowledgeIds(
      normalizeGeneratedStudyModel(legacyCanonical, false, data.lessonContext),
    );
    const { sourceClassifications, ...actual } = prepare(data).decode(wire(output()));
    expect(actual).toEqual(expected);
    expect(sourceClassifications).toEqual([
      {
        sourceId: original.sourceId,
        classification: { role: "class_material", confidence: "uncertain" },
      },
    ]);
  });

  it("strictly requires all v3 groups and refuses flat, missing or additional properties", () => {
    const prepared = prepare();
    const grouped = prepared.schema.parse(wire(output()));
    expect(JSON.parse(prepared.input).format).toBe("knowledge_generation_keys_v3");
    expect(() => prepared.schema.parse(output())).toThrow();
    expect(Object.keys(first(grouped.learningItems))).toEqual([
      "identity",
      "claim",
      "meaning",
      "pronunciation",
      "practice",
      "teaching",
    ]);
    for (const key of ["identity", "claim", "meaning", "pronunciation", "practice", "teaching"])
      for (const replacement of [undefined, { invented: "content" }]) {
        const changed = structuredClone(grouped);
        Object.assign(first(changed.learningItems), { [key]: replacement });
        expect(() => prepared.assemble(changed)).toThrow();
      }
    for (const key of ["orientation", "activities", "mistakes"])
      expect(() =>
        prepared.assemble({
          ...grouped,
          classNotes: { ...grouped.classNotes, [key]: undefined },
        }),
      ).toThrow();
    expect(() =>
      prepared.assemble({
        ...grouped,
        learningItems: [{ ...first(grouped.learningItems), en: "flat target" }],
      }),
    ).toThrow();
    expect(() =>
      prepared.assemble({
        ...grouped,
        classNotes: { ...grouped.classNotes, coreIntro: "flat prose" },
      }),
    ).toThrow();
    expect(() =>
      prepared.assemble({
        ...grouped,
        learningItems: [
          {
            ...first(grouped.learningItems),
            meaning: { ...first(grouped.learningItems).meaning, invented: "content" },
          },
        ],
      }),
    ).toThrow();
  });

  it.each([
    "schemaVersion",
    "language",
    "coverage",
    "sourceClassifications",
    "date",
    "speakerRole",
  ])("rejects model-owned metadata %s rather than coercing it", (field) => {
    expect(() => prepare().decode(wire({ ...output(), [field]: "invented" }))).toThrow();
  });

  it("never expands an invented, case-changed, empty or duplicate evidence key", () => {
    const prepared = prepare();
    for (const keys of [["r999"], ["R0"], ["r0", "r0"]])
      expect(() =>
        prepared.decode(
          wire({ ...output(), learningItems: [{ ...lexical(), claim: claim(keys) }] }),
        ),
      ).toThrow();
    const data = input();
    data.sources[0]?.blocks.unshift({ id: "empty", unitId: "unit", kind: "paragraph", text: "" });
    const withEmpty = prepare(data);
    expect(JSON.parse(withEmpty.input).sources[0].evidence[0][0]).toBeNull();
    expect(() => withEmpty.decode(wire(output()))).toThrow();
  });

  it("keeps full Unicode text, learner context and native PDF/audio locators", () => {
    const pdf = source("pdf");
    pdf.units = [{ id: "unit", kind: "page", start: 7, status: "extracted" }];
    pdf.pageCount = 7;
    const audio = source("audio");
    audio.role = "class_audio";
    audio.units = [{ id: "unit", kind: "time", start: 1234, end: 5678, status: "extracted" }];
    audio.blocks[0] = {
      ...first(audio.blocks),
      speakerRole: "teacher",
      speakerId: "anonymous-A",
      timeStatus: "exact",
    };
    const data = input([pdf, audio]);
    const before = JSON.stringify(data);
    const prepared = prepare(data);
    expect(JSON.parse(prepared.input).learnerContext).toEqual(data.learnerContext);
    expect(prepared.input).toContain(JSON.stringify(pdf.blocks[0]?.text));
    const result = prepared.decode(
      wire({
        ...output(),
        uncertainties: [
          { ...claim(["r0", "r1"]), text: "توضیح دو منبع درباره این نکته متفاوت است." },
        ],
      }),
    );
    expect(result.uncertainties[0]).toMatchObject({
      uncertain: true,
      speakerRole: "unknown",
      evidence: "material",
      sourceRefs: [
        { sourceId: pdf.sourceId, locator: { kind: "page", page: 7, blockId: "block" } },
        { sourceId: audio.sourceId, locator: { kind: "time", startMs: 1234, endMs: 5678 } },
      ],
    });
    expect(result.classNotes?.mistakes?.speechStatus).toBe("unverified");
    expect(JSON.stringify(data)).toBe(before);
  });

  it("supports a joint atomic summary with all supplied supporting blocks unchanged", () => {
    const data = input([source(), source()]);
    const value = {
      ...output(),
      summary: [{ ...claim(["r0", "r1"]), text: "دو بخش متن درباره این عبارت توضیح می‌دهند." }],
    };
    const result = prepare(data).decode(wire(value));
    expect(result.summary[0]?.sourceRefs.map((ref) => ref.sourceId)).toEqual(
      data.sources.map((s) => s.sourceId),
    );
    expect(result.summary[0]?.text).toBe(value.summary[0]?.text);
    expect(prepare(data).system).toContain("ALL essential supporting rows");
  });

  it("preserves AI expansion and rejects invented AI homework or sourceless conflicts", () => {
    const prepared = prepare();
    const result = prepared.decode(
      wire({
        ...output(),
        learningItems: [{ ...lexical(), claim: claim([]) }],
      }),
    );
    expect(result.learningItems[0]?.claim).toMatchObject({
      origin: "ai_expansion",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    });
    expect(result.learningItems[0]?.study).toMatchObject({ sourceFa: "توضیح افزوده‌ی هوش مصنوعی" });
    expect(() => prepared.decode(wire({ ...output(), homework: [claim([])] }))).toThrow();
    expect(() => prepared.decode(wire({ ...output(), uncertainties: [claim([])] }))).toThrow();
  });

  it("makes grammar explicit while preserving its exact task and full answer", () => {
    const result = prepare().decode(wire({ ...output(), learningItems: [grammar()] }));
    expect(result.learningItems[0]).toMatchObject({
      kind: "grammar",
      study: {
        set: "production",
        kind: "grammar",
        prompt: grammar().prompt,
        taskFa: grammar().taskFa,
        fullSentence: grammar().fullSentence,
      },
    });
    expect(result.learningItems[0]?.study).not.toHaveProperty("gapSentence");
    const { prompt: _prompt, ...incomplete } = grammar();
    expect(() => prepare().decode(wire({ ...output(), learningItems: [incomplete] }))).toThrow();
    expect(() =>
      prepare().decode(
        wire({
          ...output(),
          learningItems: [{ ...grammar(), prompt: grammar().fullSentence }],
        }),
      ),
    ).toThrow();
    expect(() =>
      prepare().decode(
        wire({ ...output(), learningItems: [{ ...lexical(), studyKind: "expression" }] }),
      ),
    ).toThrow();
  });

  it("retains final hidden-answer, paired-sentence and Persian approximation guards", () => {
    for (const patch of [
      { gapSentence: "I look forward to ______ my new neighbours." },
      { faMeaning: "look forward to یعنی منتظر بودن." },
      { gapSentence: "We ______ meeting our neighbours." },
      { faApprox: undefined },
    ])
      expect(() =>
        prepare().decode(wire({ ...output(), learningItems: [{ ...lexical(), ...patch }] })),
      ).toThrow();
    const { gapSentence: _gap, ...incomplete } = lexical();
    expect(() => prepare().decode(wire({ ...output(), learningItems: [incomplete] }))).toThrow();
  });

  it("preserves separable lexical targets rather than hiding a complement", () => {
    const item = {
      ...lexical(),
      en: "kit sb/sth out",
      gapSentence: "We need to ______ it ______ before opening tomorrow.",
      fullSentence: "We need to kit it out before opening tomorrow.",
    };
    expect(
      prepare().decode(wire({ ...output(), learningItems: [item] })).learningItems[0]?.study,
    ).toMatchObject({
      en: item.en,
      gapSentence: item.gapSentence,
      fullSentence: item.fullSentence,
    });
  });

  it("recognition carries no generated voice assertion and retains generation AI policy", () => {
    const item = {
      ...recognitionItem(),
      claim: claim(),
      en: "look forward to",
      faMeaning: "با اشتیاق منتظر بودن",
      topic: "anticipation",
      example: lexical().fullSentence,
    };
    const data = input();
    const result = prepare(data).decode(wire({ ...output(), learningItems: [lexical(), item] }));
    expect(result.learningItems[1]?.study).toMatchObject({ set: "recognition", spoken: false });
    expect(() =>
      prepare(data).decode(wire({ ...output(), learningItems: [{ ...item, spoken: true }] })),
    ).toThrow();
    const { sourceClassifications: _sourceClassifications, ...knowledge } = result;
    const final = finalizeGeneratedStudyPractice(knowledge, data.sources, data.learnerContext);
    expect(final.model.learningItems[1]?.claim).toMatchObject({
      origin: "ai_expansion",
      evidence: "ai",
      sourceRefs: [],
    });
  });

  it("fills availability from server extraction and preserves real notebook content", () => {
    const data = input();
    const missing = source("html");
    missing.blocks = [];
    missing.units = [];
    data.sources = [...data.sources, missing];
    data.missingSourceIds = [missing.sourceId];
    const classNotes = {
      ...output().classNotes,
      coverage: "درس درباره یک عبارت است.",
      coreIntro: "بیاییم این عبارت را یاد بگیریم.",
      sourceNote: "این متن گزیده‌ای از درس است.",
      chunks: [
        {
          pattern: "look forward to + noun",
          classSentence: lexical().fullSentence,
          noteFa: "بعد از این عبارت اسم می‌آید.",
        },
      ],
      tasks: [
        {
          title: "تمرین جمله",
          blocks: [
            itemsBlock([
              {
                prompt: "Rewrite the sentence.",
                model: lexical().fullSentence,
                whyFa: "این مثال کاربرد را نشان می‌دهد.",
              },
            ]),
          ],
        },
      ],
    };
    const result = prepare(data).decode(wire({ ...output(), classNotes }));
    expect(result.coverage).toEqual({ complete: false, missingSourceIds: [missing.sourceId] });
    expect(result.classNotes).toMatchObject({
      coverage: classNotes.coverage,
      coreIntro: classNotes.coreIntro,
      sourceNote: classNotes.sourceNote,
      chunks: classNotes.chunks,
    });
    expect(result.classNotes?.tasks[0]?.blocks).toEqual([
      {
        type: "items",
        items: [
          {
            prompt: "Rewrite the sentence.",
            model: lexical().fullSentence,
            whyFa: "این مثال کاربرد را نشان می‌دهد.",
          },
        ],
      },
    ]);
  });

  it("only copies board text from actual board evidence and never from personal note roles", () => {
    const board = source("image");
    board.role = "board_photo";
    const value = {
      ...output(),
      classNotes: {
        ...output().classNotes,
        board: [{ text: "Look forward to means anticipate with pleasure", evidenceKeys: ["r0"] }],
      },
    };
    expect(prepare(input([board])).decode(wire(value)).classNotes?.board).toEqual([
      value.classNotes.board[0]?.text,
    ]);
    expect(() => prepare().decode(wire(value))).toThrow();
    expect(() =>
      prepare(input([board])).decode(
        wire({
          ...value,
          classNotes: {
            ...value.classNotes,
            board: [{ text: "Invented writing", evidenceKeys: ["r0"] }],
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects personal error attribution from anonymous/quoted/user_notes evidence", () => {
    const notes = source("image");
    notes.role = "user_notes";
    first(notes.blocks).text =
      "Public typed quote: fictional Noor wrote She walk. Correct: She walks.";
    const written = {
      said: "She **walk**",
      correct: "She **walks**",
      whyFa: "فعل سوم شخص مفرد تغییر می‌کند.",
      kind: "grammar",
      evidenceKeys: ["r0"],
      where: "",
      learningItemIndex: -1,
    };
    const value = {
      ...output(),
      classNotes: { ...output().classNotes, mistakes: { noteFa: "", items: [written] } },
    };
    expect(() => prepare(input([notes])).decode(wire(value))).toThrow();
    const task = {
      title: "تمرین",
      blocks: [
        itemsBlock([{ prompt: "Correct this.", learnerAnswer: "She walk", model: "She walks" }]),
      ],
    };
    expect(() =>
      prepare(input([notes])).decode(
        wire({
          ...output(),
          classNotes: { ...output().classNotes, tasks: [task] },
        }),
      ),
    ).toThrow();
  });

  it("rejects unsupported personal mistake notes even when their item list is empty", () => {
    const notes = source("image");
    notes.role = "user_notes";
    first(notes.blocks).text = "Public quote: Noor wrote She walk. Correction: She walks.";
    const value = {
      ...output(),
      classNotes: {
        ...output().classNotes,
        mistakes: { noteFa: "شما این اشتباه را مرتب تکرار می‌کنید.", items: [] },
      },
    };
    for (const evidence of [source(), source("audio"), notes]) {
      const prepared = prepare(input([evidence]));
      expect(prepared.schema.parse(wire(value)).classNotes.mistakes.items).toEqual([]);
      expect(() => prepared.assemble(wire(value))).toThrow(
        expect.objectContaining({
          code: "validation_failed",
          details: { fields: { output: ["learner_authorship_unconfirmed"] } },
        }),
      );
      expect(prepared.assemble(wire(output())).classNotes?.mistakes?.noteFa).toBeUndefined();
    }
  });

  it("retains explicitly authorized exact handwritten corrections and stable item links", () => {
    const notes = source("image");
    notes.role = "user_notes";
    first(notes.blocks).text = "She walk to school. Teacher correction: She walks to school.";
    const data = input([notes]);
    data.confirmedHandwritingKeys = ["r0"];
    data.confirmedTeacherCorrectionKeys = ["r0"];
    const item = {
      said: "She **walk** to school.",
      correct: "She **walks** to school.",
      whyFa: "فعل سوم شخص مفرد تغییر می‌کند.",
      kind: "grammar",
      evidenceKeys: ["r0"],
      learningItemIndex: 0,
      where: "",
    };
    const result = prepare(data).decode(
      wire({
        ...output(),
        learningItems: [grammar()],
        classNotes: {
          ...output().classNotes,
          mistakes: { noteFa: "در این نوشته فعل سوم شخص مفرد تصحیح شده است.", items: [item] },
        },
      }),
    );
    expect(result.classNotes?.mistakes?.noteFa).toBe(
      "در این نوشته فعل سوم شخص مفرد تصحیح شده است.",
    );
    expect(result.classNotes?.mistakes?.items[0]).toMatchObject({
      source: "handwriting",
      said: item.said,
      correct: item.correct,
      teacherCorrected: true,
      itemId: result.learningItems[0]?.id,
    });
    expect(() =>
      prepare(data).decode(
        wire({
          ...output(),
          classNotes: {
            ...output().classNotes,
            mistakes: { noteFa: "", items: [{ ...item, said: "Invented learner words" }] },
          },
        }),
      ),
    ).toThrow();
  });

  it("never accepts provider voice assertions or aggregate patterns", () => {
    for (const mistakes of [
      { noteFa: "", speechStatus: "verified", items: [] },
      {
        noteFa: "",
        patterns: [{ labelFa: "الگو", count: 2, examples: [], ruleFa: "قاعده" }],
        items: [],
      },
      {
        noteFa: "",
        items: [
          {
            source: "speech",
            said: "Secret voice",
            correct: "Other words",
            whyFa: "توضیح",
            kind: "grammar",
            evidenceKeys: ["r0"],
            where: "",
            learningItemIndex: -1,
          },
        ],
      },
    ])
      expect(() =>
        prepare().decode(wire({ ...output(), classNotes: { ...output().classNotes, mistakes } })),
      ).toThrow();
  });

  it.each(["en", "es", "zh-Hans"])(
    "derives honest reviewed source labels for %s without assuming Persian",
    (language) => {
      const explanations = {
        en: "Anticipate a future event with pleasure.",
        es: "Esperar un acontecimiento con ilusión.",
        "zh-Hans": "怀着期待等待未来的事情。",
      };
      const explanation = explanations[language as keyof typeof explanations];
      const { faApprox: _faApprox, ...item } = lexical();
      const value = {
        ...output(),
        learningItems: [
          {
            ...item,
            claim: { ...claim(), text: explanation },
            faApprox: "",
            faMeaning: explanation,
            noteFa: explanation,
            imageFa: explanation,
          },
        ],
        classNotes: { ...output().classNotes, coverage: explanation },
      };
      const result = prepare(input([source()], language)).decode(wire(value));
      expect(result.language.explanation).toBe(language);
      expect(result.learningItems[0]?.study).not.toHaveProperty("faApprox");
      expect(result.learningItems[0]?.claim.speakerRole).toBe("unknown");
      expect(
        result.learningItems[0]?.study?.set === "production" &&
          result.learningItems[0].study.sourceFa,
      ).toBeTruthy();
    },
  );

  it("permits only exact origin-matched D31 provenance chrome and tags English fallback", () => {
    const data = input([source()], "th");
    const explanation = "รอคอยเหตุการณ์ด้วยความยินดี";
    const { faApprox: _faApprox, ...item } = lexical();
    const value = {
      ...output(),
      learningItems: [
        {
          ...item,
          claim: { ...claim(), text: explanation },
          faApprox: "",
          faMeaning: explanation,
          noteFa: explanation,
          imageFa: explanation,
        },
      ],
      classNotes: { ...output().classNotes, coverage: explanation },
    };
    const result = prepare(data).decode(wire(value));
    expect(result.learningItems[0]?.study).toMatchObject({ sourceFa: "From class" });
    expect(renderClassNotesHtml(result)).toContain('<span lang="en" dir="ltr">From class</span>');
    const changed = structuredClone(result);
    if (changed.learningItems[0]?.study?.set !== "production") throw new Error("fixture");
    changed.learningItems[0].study.sourceFa = "Additional AI explanation";
    expect(() => validateKnowledgeModel(changed, data.sources, "th")).toThrow();
    changed.learningItems[0].study.sourceFa = "From class with invented extra prose";
    expect(() => validateKnowledgeModel(changed, data.sources, "th")).toThrow();
  });

  it("preserves the exact input cap and never silently clips a large source", () => {
    const data = input();
    first(first(data.sources).blocks).text = "Original evidence 😀 ".repeat(2000);
    expect(() => buildKnowledgeGenerationInput(data, 1000)).toThrow(ProviderError);
    expect(prepare(data).input).toContain(JSON.stringify(data.sources[0]?.blocks[0]?.text));
  });

  it("keeps grouped strict type branches intact for direct JSON decoding", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    expect(transport.schema).toHaveProperty("properties");
    expect(structuredSchemaComplexity(transport.schema)).toEqual({
      optionalParameters: 0,
      unionParameters: 1,
    });
    expect(prepared.schema.shape.learningItems.element.options).toHaveLength(3);
    for (const branch of prepared.schema.shape.learningItems.element.options)
      expect(Object.keys(branch.shape)).toHaveLength(6);
    expect(Object.keys(prepared.schema.shape.classNotes.shape)).toHaveLength(4);
    expect(
      prepared.schema.parse(wire(transport.decode(wire(output())))).learningItems[0]?.identity.type,
    ).toBe("lexical");
    expect(() =>
      prepared.schema.parse(
        wire(
          transport.decode(wire({ ...output(), learningItems: [{ ...lexical(), type: "other" }] })),
        ),
      ),
    ).toThrow();
  });

  it("rejects nonempty inapplicable item fields instead of silently clearing them", () => {
    for (const item of [
      { ...lexical(), example: "Real extra content" },
      { ...lexical(), prompt: "A different task" },
      { ...lexical(), kind: "grammar" },
      { ...grammar(), gapSentence: "She ______ to the shop." },
      { ...grammar(), studyKind: "register" },
      { ...recognitionItem(), fullSentence: lexical().fullSentence },
      { ...recognitionItem(), imageFa: "واقعیت اضافی" },
    ])
      expect(() => prepare().assemble(wire({ ...output(), learningItems: [item] }))).toThrow();
    const { example: _example, ...missingWireProperty } = lexical();
    expect(() =>
      prepare().assemble(wire({ ...output(), learningItems: [missingWireProperty] })),
    ).toThrow();
  });

  it("reserves practice.example for recognition while retaining production examples and notes", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    expect(JSON.stringify(transport.schema)).toContain("practice.example is only for recognition");
    expect(prepared.system).toContain("FINAL type-applicability check for EVERY item");
    expect(prepared.system).toContain("never practice.example");
    for (const item of [lexical(), grammar()]) {
      const proper = wire({ ...output(), learningItems: [item] });
      expect(prepared.schema.safeParse(transport.decode(proper)).success).toBe(true);
      expect(prepared.assemble(proper).learningItems[0]?.study).toMatchObject({
        fullSentence: item.fullSentence,
        noteFa: item.noteFa,
      });
      const extra = wire({
        ...output(),
        learningItems: [{ ...item, example: item.fullSentence }],
      });
      expect(prepared.schema.safeParse(transport.decode(extra)).success).toBe(false);
      expect(() => prepared.assemble(transport.decode(extra))).toThrow();
    }
    const recognition = prepared.assemble(
      wire({
        ...output(),
        learningItems: [recognitionItem()],
      }),
    );
    expect(recognition.learningItems[0]?.study).toMatchObject({
      set: "recognition",
      example: recognitionItem().example,
    });
  });

  it("never accepts empty required teaching fields as transport absence sentinels", () => {
    const prepared = prepare();
    for (const item of [lexical(), grammar()])
      for (const field of ["en", "faMeaning", "topic", "ipa", "fullSentence", "noteFa", "imageFa"])
        expect(() =>
          prepared.assemble(wire({ ...output(), learningItems: [{ ...item, [field]: "" }] })),
        ).toThrow();
    for (const field of ["en", "faMeaning", "topic", "example"])
      expect(() =>
        prepared.assemble(
          wire({
            ...output(),
            learningItems: [{ ...recognitionItem(), [field]: "" }],
          }),
        ),
      ).toThrow();
    expect(prepared.system).toContain(
      "Every learningItem requires nonempty meaning.en, meaning.faMeaning and meaning.topic",
    );
    expect(prepared.system).toContain(
      "require nonempty pronunciation.ipa, practice.fullSentence, teaching.noteFa and teaching.imageFa",
    );
    expect(prepared.system).toContain('Set mistakes.noteFa="", mistakes.items=[]');
  });

  it.each(["fa", "fa-IR"])(
    "requires a nonempty Persian approximation in both production branches for %s",
    (language) => {
      const prepared = prepare(input([source()], language));
      const transport = createJsonFallbackTransport(prepared.schema);
      for (const item of [lexical(), grammar()]) {
        expect(
          prepared.schema.safeParse(wire({ ...output(), learningItems: [item] })).success,
        ).toBe(true);
        for (const approximation of ["", null, undefined]) {
          const raw = wire({ ...output(), learningItems: [{ ...item, faApprox: approximation }] });
          expect(prepared.schema.safeParse(transport.decode(raw)).success).toBe(false);
          expect(() => prepared.assemble(transport.decode(raw))).toThrow();
        }
      }
      expect(
        prepared.schema.safeParse(
          wire({
            ...output(),
            learningItems: [{ ...recognitionItem(), faApprox: "" }],
          }),
        ).success,
      ).toBe(true);
      expect(prepared.system).toContain("learning language en does NOT determine transliteration");
      expect(prepared.system).toContain(
        "study_approximation_missing refers to this exact nested pronunciation.faApprox field",
      );
    },
  );

  it.each(["en", "es", "zh-Hans", "ar"])(
    "requires exact empty approximation for every item type outside Persian: %s",
    (language) => {
      const prepared = prepare(input([source()], language));
      const transport = createJsonFallbackTransport(prepared.schema);
      for (const item of [lexical(), grammar(), recognitionItem()]) {
        expect(
          prepared.schema.safeParse(
            wire({
              ...output(),
              learningItems: [{ ...item, faApprox: "" }],
            }),
          ).success,
        ).toBe(true);
        const raw = wire({ ...output(), learningItems: [item] });
        expect(prepared.schema.safeParse(transport.decode(raw)).success).toBe(false);
        expect(() => prepared.assemble(transport.decode(raw))).toThrow();
      }
      expect(prepared.system).toContain(
        'Every lexical, grammar and recognition item MUST use pronunciation.faApprox=""',
      );
    },
  );

  it("rejects Latin IPA or explanatory words inside a Persian phonetic approximation", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    for (const approximation of [
      "لوک ð",
      "θ لوک",
      "لوک ə",
      "لوک ʃ",
      "لوک ŋ",
      "لوک nk",
      "لوک for you",
      "/lʊk/ لوک",
    ])
      for (const item of [lexical(), grammar(), recognitionItem()]) {
        const raw = wire({ ...output(), learningItems: [{ ...item, faApprox: approximation }] });
        expect(prepared.schema.safeParse(transport.decode(raw)).success).toBe(false);
        expect(() => prepared.assemble(transport.decode(raw))).toThrow();
      }
    expect(
      prepared.schema.safeParse(
        wire({
          ...output(),
          learningItems: [{ ...lexical(), faApprox: "لوک فُروِد تَ" }],
        }),
      ).success,
    ).toBe(true);
  });

  it("makes source order, native-script approximation and task scope explicit without lesson gold", () => {
    const prepared = prepare();
    const jsonSchema = JSON.stringify(createJsonFallbackTransport(prepared.schema).schema);
    expect(prepared.system).toContain('For Persian explanations, use "پس از X، Y می‌آید"');
    expect(prepared.system).toContain('NEVER explain X + Y as "X بعد از Y می‌آید"');
    expect(prepared.system).toContain("exact English left-to-right pattern");
    expect(prepared.system).toContain("ALL IPA or Latin letters are banned in faApprox");
    expect(prepared.system).toContain("kind /kaɪnd/ → کایند; kind of /kaɪnd əv/ → کایند اَو");
    expect(prepared.system).toContain(
      "Do not teach or add these words unless they occur in the supplied sources",
    );
    expect(prepared.system).toContain("changing only the requested scope");
    expect(jsonSchema).toContain("including ə, ð, θ, ʃ, ŋ and English fragments such as nk");
    expect(jsonSchema).toContain(
      "Instruction only: explain the requested operation and scope, without a worked answer or solution hints",
    );
  });

  it("labels every claim as explanation prose while retaining canonical language repair checks", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    expect(JSON.stringify(transport.schema)).toContain(
      "every learning item, summary, topic, homework and uncertainty claim",
    );
    expect(JSON.stringify(transport.schema)).toContain("must not be copied wholesale in English");
    for (const value of [
      {
        ...output(),
        learningItems: [{ ...lexical(), claim: { ...claim(), text: "Anticipate with pleasure." } }],
      },
      {
        ...output(),
        topics: [
          { title: "معنی عبارت", claims: [{ ...claim(), text: "Anticipate with pleasure." }] },
        ],
      },
    ]) {
      // Preserve completed accounting/checkpoint behaviour: prose semantics are
      // checked after a structurally canonical response, not silently translated.
      expect(prepared.assemble(wire(value)).learningItems).toHaveLength(1);
      expect(() => prepared.decode(wire(value))).toThrow(
        expect.objectContaining({
          details: { fields: { output: ["language_script_mismatch"] } },
        }),
      );
    }
    expect(prepared.system).toContain("topics[].claims[].text");
    expect(prepared.system).toContain("Do not leave claim.text or topic claims in English");
  });

  it("keeps core contrasts, source conflicts and assignments ahead of duplicate summaries", () => {
    const material = source();
    first(material.blocks).text += " Homework: read a short story.";
    const conflicting = source();
    first(conflicting.blocks).text =
      "A conflicting worksheet says look forward to takes a base verb instead of an -ing form. Homework: write a short paragraph.";
    const data = input([material, conflicting]);
    const primary = buildKnowledgeGenerationInput(data, 120000, { maxOutputTokens: 6144 });
    const compact = buildKnowledgeGenerationInput(data, 120000, {
      maxOutputTokens: 4096,
      compact: true,
      repairReason: "language_script_mismatch",
    });
    for (const prepared of [primary, compact]) {
      expect(prepared.system).toContain("inventory every distinct taught concept, paired contrast");
      expect(prepared.system).toContain(
        "Map each core concept and both sides of a taught contrast",
      );
      expect(prepared.system).toContain("disagreement is not corroboration");
      expect(prepared.system).toContain(
        "add a concise uncertainties claim with uncertain=true and ALL conflicting keys",
      );
      expect(prepared.system).toContain(
        "Homework and uncertainties have their own source-driven priority",
      );
      expect(prepared.system).not.toContain(
        "Across summary/topics/homework/uncertainties use at most",
      );
      expect(prepared.system).toContain(
        "Recognition practice.example must be a correct usable English example",
      );
      expect(prepared.system).toContain("with the same auxiliaries, particles and participle");
      expect(prepared.system).toContain("an explicit X + Y schematic is safer");
    }
    const result = primary.decode(
      wire({
        ...output(),
        homework: [
          { ...claim(["r0"]), text: "برای تکلیف یک داستان کوتاه بخوانید." },
          { ...claim(["r1"]), text: "برای تکلیف یک بند کوتاه بنویسید." },
        ],
        uncertainties: [
          { ...claim(["r0", "r1"]), text: "این دو منبع درباره یک نکته اختلاف دارند." },
        ],
      }),
    );
    expect(result.homework).toHaveLength(2);
    expect(result.uncertainties[0]).toMatchObject({ uncertain: true });
    expect(result.uncertainties[0]?.sourceRefs.map((reference) => reference.sourceId)).toEqual(
      data.sources.map((entry) => entry.sourceId),
    );
    expect(compact.input).toBe(primary.input);
  });

  it("retains ordered text, quote, table and exercise content in tasks and culture", () => {
    const blocks = [
      { type: "text", text: "توضیح یک تمرین کلاسی", headers: [], rows: [], items: [] },
      {
        type: "quote",
        text: "This is the unchanged source quotation.",
        headers: [],
        rows: [],
        items: [],
      },
      {
        type: "table",
        text: "",
        headers: ["Question", "Answer"],
        rows: [["Why?", "Because."]],
        items: [],
      },
      itemsBlock([
        {
          prompt: "Rewrite this example.",
          model: lexical().fullSentence,
          whyFa: "این جمله کاربرد را نشان می‌دهد.",
        },
      ]),
    ];
    const group = { title: "تمرین اصلی", blocks };
    const result = prepare().decode(
      wire({
        ...output(),
        classNotes: { ...output().classNotes, tasks: [group], culture: [group] },
      }),
    );
    const expected = [
      { type: "text", textFa: blocks[0]?.text },
      { type: "quote", quoteEn: blocks[1]?.text },
      { type: "table", headers: ["Question", "Answer"], rows: [["Why?", "Because."]] },
      {
        type: "items",
        items: [
          {
            prompt: "Rewrite this example.",
            model: lexical().fullSentence,
            whyFa: "این جمله کاربرد را نشان می‌دهد.",
          },
        ],
      },
    ];
    expect(result.classNotes?.tasks[0]?.blocks).toEqual(expected);
    expect(result.classNotes?.culture?.[0]?.blocks).toEqual(expected);
    for (const block of [
      { ...blocks[0], headers: ["Undiscardable heading"] },
      { ...blocks[2], text: "Undiscardable prose" },
      { type: "quote", text: "", headers: [], rows: [], items: [] },
      { type: "items", text: "", headers: [], rows: [], items: [] },
    ])
      expect(() =>
        prepare().assemble(
          wire({
            ...output(),
            classNotes: { ...output().classNotes, tasks: [{ title: "تمرین", blocks: [block] }] },
          }),
        ),
      ).toThrow();
  });

  it("direct JSON absence never turns invalid required prose or enums into accepted content", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    for (const patch of [
      { faMeaning: "" },
      { type: "expression" },
      { kind: "" },
      { studyKind: "expression" },
    ]) {
      expect(() =>
        prepared.assemble(
          wire(
            transport.decode(wire({ ...output(), learningItems: [{ ...lexical(), ...patch }] })),
          ),
        ),
      ).toThrow();
    }
    expect(() =>
      prepared.assemble(
        wire(
          transport.decode(
            wire({ ...output(), classNotes: { ...output().classNotes, coverage: "" } }),
          ),
        ),
      ),
    ).toThrow();
    expect(() =>
      prepared.assemble(wire(transport.decode(wire({ ...output(), classNotes: null })))),
    ).toThrow();
  });

  it("authority checks fail closed for invalid confirmed keys or nonproduction mistake links", () => {
    for (const evidenceKey of ["invented", "r0"]) {
      const data = input();
      data.confirmedHandwritingKeys = [evidenceKey];
      expect(() => prepare(data)).toThrow();
    }
    const notes = source("image");
    notes.role = "user_notes";
    first(notes.blocks).text = "She walk. Correct: She walks.";
    const data = input([notes]);
    data.confirmedHandwritingKeys = ["r0"];
    const mistake = {
      said: "She **walk**.",
      correct: "She **walks**.",
      whyFa: "فعل تغییر می‌کند.",
      kind: "grammar",
      evidenceKeys: ["r0"],
      learningItemIndex: 20,
      where: "",
    };
    expect(() =>
      prepare(data).assemble(
        wire({
          ...output(),
          classNotes: { ...output().classNotes, mistakes: { noteFa: "", items: [mistake] } },
        }),
      ),
    ).toThrow();
    const correct = prepare(data).decode(
      wire({
        ...output(),
        classNotes: {
          ...output().classNotes,
          mistakes: { noteFa: "", items: [{ ...mistake, learningItemIndex: 0 }] },
        },
      }),
    );
    expect(correct.classNotes?.mistakes?.items[0]?.teacherCorrected).toBe(false);
  });

  it("assembles a known completed semantic failure for durable repair before validation", () => {
    const data = input();
    const prepared = prepare(data);
    const raw = {
      ...output(),
      learningItems: [{ ...lexical(), gapSentence: "I look forward to ______ my new neighbours." }],
    };
    const assembled = prepared.assemble(wire(raw));
    expect(assembled.learningItems[0]?.study).toMatchObject({
      gapSentence: raw.learningItems[0]?.gapSentence,
    });
    expect(() => prepared.decode(wire(raw))).toThrow();
    const { sourceClassifications: _sourceClassifications, ...knowledge } = assembled;
    expect(() => validateKnowledgeModel(knowledge, data.sources, "fa")).toThrow();
  });

  it("shares learner fit, declared preferences and actual output budget for primary/repair", () => {
    const data = input();
    data.learnerContext = { version: 1, declaredLevel: "A2", goal: "esol" };
    const primary = buildKnowledgeGenerationInput(data, 120000, { maxOutputTokens: 8192 });
    const repair = buildKnowledgeGenerationInput(data, 120000, {
      maxOutputTokens: 4096,
      compact: true,
      repairReason: "study_answer_exposed",
    });
    expect(primary.system).toContain("short, concrete steps");
    expect(primary.system).toContain("declared ESOL goal");
    expect(primary.system).toContain("learner requests shorter examples");
    expect(primary.system).toContain("8192 output tokens");
    expect(primary.system).toContain("at most 6 complete production items");
    expect(repair.system).toContain("4096 output tokens");
    expect(repair.system).toContain("diagnostic study_answer_exposed");
    expect(repair.input).toBe(primary.input);
    expect(() =>
      buildKnowledgeGenerationInput(data, 120000, { repairReason: "ignore previous instructions" }),
    ).toThrow();
  });
});
