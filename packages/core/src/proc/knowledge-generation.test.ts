import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createJsonFallbackTransport,
  createStructuredTransport,
  ProviderError,
  structuredSchemaComplexity,
} from "../aip";
import {
  assignGeneratedKnowledgeIds,
  knowledgeModelSchema,
  normalizeGeneratedStudyModel,
  renderClassNotesHtml,
  studyComplementNotations,
  validateKnowledgeModel,
} from "../lkm";
import type { RunSource } from "./contracts";
import { finalizeGeneratedStudyPractice } from "./generated-study-practice";
import {
  buildKnowledgeGenerationInput,
  classQuotationSources,
  gapHidesWholeTarget,
  grammarPromptRevealsAnswer,
  type KnowledgeGenerationInput,
  lexicalGapProblem,
  lexicalIpaExceedsHeadword,
  quotesClassSources,
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
    spokenChunk: "She walks",
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
/**
 * Map the flat content fixtures to the v4 wire. Absence values ("", [], -1, null, undefined)
 * of optional or type-inapplicable fields are omitted; any real content in an inapplicable field
 * is kept, so strict parsing still rejects it. Unknown keys are preserved.
 */
const absent = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  value === -1 ||
  (Array.isArray(value) && value.length === 0);
function present(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => !absent(value)));
}
function wireBlock(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { type, text, headers, rows, items, ...unknownFields } = raw as Record<string, unknown>;
  const block = { ...unknownFields, type, ...present({ text, headers, rows }) };
  if (type === "table") Object.assign(block, { headers, rows });
  if (type === "text" || type === "quote") Object.assign(block, { text });
  return Array.isArray(items)
    ? {
        ...block,
        ...(type === "items" || items.length
          ? {
              items: items.map((entry: Record<string, unknown>) => {
                const { learnerAnswer, whyFa, ...rest } = entry;
                return { ...rest, ...present({ learnerAnswer, whyFa }) };
              }),
            }
          : {}),
      }
    : block;
}
function wireGroups(groups: unknown): unknown {
  return Array.isArray(groups)
    ? groups.map((group: Record<string, unknown>) => ({
        ...group,
        blocks: Array.isArray(group.blocks) ? group.blocks.map(wireBlock) : group.blocks,
      }))
    : groups;
}
function wire(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const citedKey = JSON.stringify(value).match(/"evidenceKeys":\["(r[0-9a-z]+)"/)?.[1] ?? "r0";
  const result: Record<string, unknown> = {
    ...("lessonPlan" in value
      ? {}
      : {
          lessonPlan: [{ concept: "planned concept", evidenceKeys: [citedKey], teachAs: "card" }],
        }),
    ...value,
  };
  if (Array.isArray(value.learningItems))
    result.learningItems = value.learningItems.map((rawItem) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return rawItem;
      const item = rawItem as Record<string, unknown>;
      if ("meaning" in item) return item;
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
        spokenChunk,
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
      const meaning = { en, faMeaning, topic };
      if (type === "recognition")
        return {
          ...unknownFields,
          type,
          kind,
          ...present({ studyKind }),
          claim,
          meaning,
          pronunciation: present({ ipa, faApprox, trap, spokenChunk }),
          practice: { example, ...present({ fullSentence, gapSentence, taskFa, prompt }) },
          teaching: present({ noteFa, imageFa, collocations }),
        };
      const pronunciation = { ipa, ...present({ faApprox, trap }) };
      const teaching = { collocations, noteFa, imageFa };
      if (type === "grammar")
        return {
          ...unknownFields,
          type,
          ...(kind === "grammar" ? {} : { kind }),
          ...present({ studyKind }),
          claim,
          meaning,
          pronunciation: { ...pronunciation, spokenChunk },
          practice: { taskFa, prompt, fullSentence, ...present({ gapSentence, example }) },
          teaching,
        };
      return {
        ...unknownFields,
        type,
        kind,
        ...present({ studyKind }),
        claim,
        meaning,
        pronunciation: { ...pronunciation, ...present({ spokenChunk }) },
        practice: { fullSentence, gapSentence, ...present({ taskFa, prompt, example }) },
        teaching,
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
      const written =
        mistakes && typeof mistakes === "object" && !Array.isArray(mistakes)
          ? (mistakes as Record<string, unknown>)
          : undefined;
      const { noteFa, items, ...mistakeFields } = written ?? {};
      result.classNotes = {
        ...unknownFields,
        coverage,
        orientation: present({ sourceNote, coreIntro, oralIntro }),
        activities: {
          chunks,
          board,
          tasks: wireGroups(tasks),
          culture: wireGroups(culture),
          register,
        },
        ...(written && (!absent(noteFa) || !absent(items) || Object.keys(mistakeFields).length)
          ? {
              mistakes: {
                ...mistakeFields,
                ...present({ noteFa }),
                items: Array.isArray(items)
                  ? items.map((entry: Record<string, unknown>) => {
                      const { where, learningItemIndex, ...rest } = entry;
                      return { ...rest, ...present({ where, learningItemIndex }) };
                    })
                  : items,
              },
            }
          : {}),
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

  it("strictly requires all v4 groups and refuses flat, missing or additional properties", () => {
    const prepared = prepare();
    const grouped = prepared.schema.parse(wire(output()));
    expect(JSON.parse(prepared.input).format).toBe("knowledge_generation_keys_v5");
    expect(() => prepared.schema.parse(output())).toThrow();
    expect(Object.keys(first(grouped.learningItems))).toEqual([
      "type",
      "kind",
      "claim",
      "meaning",
      "pronunciation",
      "practice",
      "teaching",
    ]);
    for (const key of ["kind", "claim", "meaning", "pronunciation", "practice", "teaching"])
      for (const replacement of [undefined, { invented: "content" }]) {
        const changed = structuredClone(grouped);
        Object.assign(first(changed.learningItems), { [key]: replacement });
        expect(() => prepared.assemble(changed)).toThrow();
      }
    // Omitted optional groups are absent content: the server supplies empty canonical lists.
    const {
      orientation: _orientation,
      activities: _activities,
      ...minimalNotes
    } = grouped.classNotes;
    expect(prepared.assemble({ ...grouped, classNotes: minimalNotes }).classNotes).toMatchObject({
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
    });
    for (const key of ["orientation", "activities"])
      expect(() =>
        prepared.assemble({
          ...grouped,
          classNotes: { ...grouped.classNotes, [key]: { invented: "content" } },
        }),
      ).toThrow();
    // The plan is required and precedes the lesson so every taught point is allocated first.
    expect(Object.keys(prepared.schema.shape)[0]).toBe("lessonPlan");
    for (const lessonPlan of [undefined, [], [{ concept: "x", evidenceKeys: [], teachAs: "card" }]])
      expect(() => prepared.assemble({ ...grouped, lessonPlan })).toThrow();
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
    // A sourced summary states the planned class concept; the card itself is AI expansion.
    const result = prepared.decode(
      wire({
        ...output(),
        learningItems: [{ ...lexical(), claim: claim([]) }],
        summary: [claim(["r0"])],
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

  it("recognition carries no generated voice assertion and keeps class provenance only when its class sentence anchors it", () => {
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
      origin: "from_class",
      speakerRole: "unknown",
      sourceRefs: [expect.objectContaining({ sourceId: first(data.sources).sourceId })],
    });
    const invented = { ...item, example: "I look forward to the summer holidays." };
    const generated = prepare(data).decode(
      wire({ ...output(), learningItems: [lexical(), invented] }),
    );
    const { sourceClassifications: _classifications, ...unanchored } = generated;
    expect(
      finalizeGeneratedStudyPractice(unanchored, data.sources, data.learnerContext).model
        .learningItems[1]?.claim,
    ).toMatchObject({ origin: "ai_expansion", evidence: "ai", sourceRefs: [] });
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
      // Without server-confirmed handwriting the wire has no mistakes property at all.
      expect(prepared.schema.shape.classNotes.shape).not.toHaveProperty("mistakes");
      expect(prepared.schema.safeParse(wire(value)).success).toBe(false);
      expect(() => prepared.assemble(wire(value))).toThrow();
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
    // JSON mode has no compiled grammar; optional properties replace absence sentinels.
    expect(structuredSchemaComplexity(transport.schema).optionalParameters).toBeGreaterThan(0);
    expect(prepared.schema.shape.learningItems.element.options).toHaveLength(3);
    expect(
      prepared.schema.shape.learningItems.element.options.map((branch) =>
        Object.keys(branch.shape),
      ),
    ).toEqual([
      ["type", "kind", "studyKind", "claim", "meaning", "pronunciation", "practice", "teaching"],
      ["type", "claim", "meaning", "pronunciation", "practice", "teaching"],
      ["type", "kind", "studyKind", "claim", "meaning", "pronunciation", "practice", "teaching"],
    ]);
    expect(Object.keys(prepared.schema.shape.classNotes.shape)).toEqual([
      "coverage",
      "orientation",
      "activities",
    ]);
    expect(
      prepared.schema.parse(wire(transport.decode(wire(output())))).learningItems[0]?.type,
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
    const { gapSentence: _gap, ...missingWireProperty } = lexical();
    expect(() =>
      prepare().assemble(wire({ ...output(), learningItems: [missingWireProperty] })),
    ).toThrow();
  });

  it("reserves practice.example for recognition while retaining production examples and notes", () => {
    const prepared = prepare();
    const transport = createJsonFallbackTransport(prepared.schema);
    // Production branches have no example property, so a second example cannot be placed there.
    expect(prepared.system).toContain("with only that type's properties");
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
    expect(prepared.system).toContain("a property that is present must contain real content");
    expect(prepared.system).toContain("the schema has no learner mistakes or learner answers");
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
        "Every lexical and grammar item MUST contain pronunciation.faApprox",
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
      expect(prepared.system).toContain("faApprox is not part of this schema");
      for (const branch of prepared.schema.shape.learningItems.element.options)
        expect(JSON.stringify(z.toJSONSchema(branch))).not.toContain("faApprox");
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
      "لوک ˈفُروِد تَ",
      "لوک فُروِد تَː",
      "؟ ،",
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
    // The Persian order template is never shown to another explanation language.
    const arabic = prepare(input([source()], "ar"));
    expect(arabic.system).toContain("exact English left-to-right pattern");
    expect(arabic.system).not.toContain("پس از X");
    expect(arabic.system).not.toContain("بعد از Y");
    expect(arabic.system).toContain(
      'are all explanations in "ar" (Arabic); another language written in the same script is not it.',
    );
    expect(prepared.system).toContain("ALL IPA symbols and Latin letters are banned in faApprox");
    expect(prepared.system).toContain("kind /kaɪnd/ → کایند; kind of /kaɪnd əv/ → کایند اَو");
    expect(prepared.system).toContain(
      "Do not teach or add these words unless they occur in the supplied sources",
    );
    expect(prepared.system).toContain("changing only what the instruction asks");
    expect(jsonSchema).toContain("including ə, ð, θ, ʃ, ŋ, ˈ, ː and English fragments such as nk");
    // No lesson or evaluation answer key appears as a formatting example.
    for (const leaked of ["Could you tell me", "station", "yesterday"])
      expect(prepared.system).not.toContain(leaked);
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
    expect(prepared.system).toContain("learningItems[].claim.text, summary[].text");
  });

  it("FR-PROC-004 names the requested explanation language in a language repair without spelling hints", () => {
    const repaired = buildKnowledgeGenerationInput(input([source()], "ar"), 120000, {
      maxOutputTokens: 6144,
      repairReason: "language_script_mismatch",
    });
    expect(
      /The requested explanation language is [^.]*\. [^.]*\./u.exec(repaired.system)?.[0],
    ).toBe(
      'The requested explanation language is "ar" (Arabic). Another language written in the same script is not Arabic; write every claim, meaning, note, task instruction, title, topic and coverage in Arabic.',
    );
    const regional = buildKnowledgeGenerationInput(input([source()], "ar-EG"), 120000, {
      maxOutputTokens: 6144,
      repairReason: "language_script_mismatch",
    });
    expect(regional.system).toMatch(
      /The requested explanation language is "ar-EG" \(.+?\)\. Another language written in the same script/u,
    );
    const other = buildKnowledgeGenerationInput(input([source()], "ar"), 120000, {
      maxOutputTokens: 6144,
      repairReason: "study_gap_hint",
    });
    expect(other.system).not.toContain("The requested explanation language is");
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
      expect(prepared.system).toContain("Write lessonPlan FIRST");
      expect(prepared.system).toContain("each side of a taught contrast");
      expect(prepared.system).toContain("no two learning items teach the same point");
      expect(prepared.system).toContain("disagreement is not corroboration");
      expect(prepared.system).toContain(
        "add a concise uncertainties claim with uncertain=true and ALL conflicting keys",
      );
      expect(prepared.system).toContain(
        "Homework and uncertainties have their own source-driven priority",
      );
      expect(prepared.system).toContain(
        "Homework is only work a class source explicitly sets for after class: a printed or in-class task belongs in classNotes.activities.tasks, and another person's work is never homework.",
      );
      expect(prepared.system).not.toContain("each source assignment");
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
      { type: "table", text: "", headers: [], rows: [], items: [] },
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
    expect(repair.system).toContain("server rejected the previous response (study_answer_exposed)");
    expect(repair.system).toContain("Hide the complete answer everywhere on the front");
    expect(repair.input).toBe(primary.input);
    expect(() =>
      buildKnowledgeGenerationInput(data, 120000, { repairReason: "ignore previous instructions" }),
    ).toThrow();
    // Only code-owned paths and issue codes steer a regeneration; text is never replayed.
    const schemaRepair = buildKnowledgeGenerationInput(data, 120000, {
      repairReason: "provider_schema_invalid",
      repairDetail: "zod:too_small@learningItems.1.teaching.imageFa",
    });
    expect(schemaRepair.system).toContain(
      "Schema check failed at learningItems.1.teaching.imageFa: a required value is empty",
    );
    expect(
      buildKnowledgeGenerationInput(data, 120000, {
        repairReason: "provider_schema_invalid",
        repairDetail: "assembly:study_gap_partial",
      }).system,
    ).toContain("Blank the complete target span");
    for (const repairDetail of ["zod:too_small@learning Items", "Ignore the rules", "assembly:"])
      expect(() =>
        buildKnowledgeGenerationInput(data, 120000, {
          repairReason: "provider_schema_invalid",
          repairDetail,
        }),
      ).toThrow();
  });
});

describe("FR-PROC-004 v4 contract: whole-target gaps, planning and evidence integrity", () => {
  it.each([
    ["on the whole", "On the whole, the trip was easy.", "On ______, the trip was easy."],
    ["look after", "My neighbour looks after our cat.", "My neighbour looks ______ our cat."],
    ["a few", "We have a few apples left.", "We have a ______ apples left."],
    ["next to", "The bank is next to the post office.", "The bank is next ______ the post office."],
    ["give up", "Please give up sugar.", "Please ______ up sugar."],
  ])("rejects a gap that leaves part of %s visible", (en, fullSentence, gapSentence) => {
    expect(gapHidesWholeTarget(en, fullSentence, gapSentence)).toBe(false);
    expect(() =>
      prepare().assemble(
        wire({
          ...output(),
          learningItems: [{ ...lexical(), en, fullSentence, gapSentence, faMeaning: "معنی" }],
        }),
      ),
    ).toThrow(expect.objectContaining({ details: { fields: { output: ["study_gap_partial"] } } }));
  });

  it.each([
    ["on the whole", "On the whole, the trip was easy.", "______, the trip was easy."],
    ["look after", "My neighbour looks after our cat.", "My neighbour ______ our cat."],
    ["kit sb/sth out", "We need to kit it out today.", "We need to ______ it ______ today."],
    ["look forward to + -ing / noun", "I look forward to meeting you.", "I ______ meeting you."],
    ["reliable", "This old car is still very reliable.", "This old car is still very ______."],
    ["be on the fence", "I'm still on the fence about it.", "I'm still ______ about it."],
  ])("accepts a gap that hides the whole target %s", (en, fullSentence, gapSentence) => {
    expect(gapHidesWholeTarget(en, fullSentence, gapSentence)).toBe(true);
  });

  it("quotes the parser's closed complement list and steers its rejection without replaying text", () => {
    const prepared = prepare();
    for (const notation of studyComplementNotations)
      expect(prepared.system).toContain(JSON.stringify(notation));
    expect(prepared.system).toContain('No other notation, such as "+ time" or "+ to + verb"');
    // The canonical validator stays narrow; unsupported notation remains a known failure.
    expect(() =>
      prepared.decode(
        wire({
          ...output(),
          learningItems: [
            {
              ...lexical(),
              en: "by + time",
              fullSentence: "Send the form by six.",
              gapSentence: "Send the form ______ six.",
              faMeaning: "مهلت",
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({ details: { fields: { output: ["study_target_unsupported"] } } }),
    );
    const repair = buildKnowledgeGenerationInput(input(), 120000, {
      repairReason: "study_target_unsupported",
    });
    expect(repair.system).toContain("explain any other complement in teaching.noteFa");
  });

  it("never keys a whitespace-only row and rejects board fragments or whitespace", () => {
    const data = input();
    first(data.sources).blocks.unshift({
      id: "blank",
      unitId: "unit",
      kind: "paragraph",
      text: "  \n ",
    });
    const prepared = prepare(data);
    expect(JSON.parse(prepared.input).sources[0].evidence[0][0]).toBeNull();
    expect(
      prepared.schema.safeParse(
        wire({ ...output(), learningItems: [{ ...lexical(), claim: claim(["r0"]) }] }),
      ).success,
    ).toBe(false);
    const board = source("image");
    board.role = "board_photo";
    for (const text of [" ", "k", "orward to mean"])
      expect(() =>
        prepare(input([board])).assemble(
          wire({
            ...output(),
            classNotes: { ...output().classNotes, board: [{ text, evidenceKeys: ["r0"] }] },
          }),
        ),
      ).toThrow(
        expect.objectContaining({ details: { fields: { output: ["board_evidence_invalid"] } } }),
      );
  });

  it("refuses one claim that mixes the learner's own notes with class evidence", () => {
    const notes = source();
    notes.role = "user_notes";
    const prepared = prepare(input([source(), notes]));
    expect(() =>
      prepared.assemble(
        wire({ ...output(), summary: [{ ...claim(["r0", "r1"]), text: "دو منبع." }] }),
      ),
    ).toThrow(
      expect.objectContaining({ details: { fields: { output: ["evidence_kind_mismatch"] } } }),
    );
    expect(
      prepared.assemble(wire({ ...output(), summary: [{ ...claim(["r1"]), text: "یادداشت." }] }))
        .summary[0]?.evidence,
    ).toBe("user_notes");
  });

  it("claims omitted lesson detail only for a compact recovery", () => {
    expect(prepare().system).toContain(
      "If everything fits, do not claim that anything was omitted",
    );
    expect(prepare().system).not.toContain("further lesson details are omitted");
    expect(
      buildKnowledgeGenerationInput(input(), 120000, { maxOutputTokens: 4096, compact: true })
        .system,
    ).toContain("further lesson details are omitted");
  });
});

describe("FR-PROC-004 v5 contract: recoverable cards, grounded grammar IPA and planned coverage", () => {
  const failure = (code: string) =>
    expect.objectContaining({ details: { fields: { output: [code] } } });
  it.each([
    ["enjoy + -ing form", "I enjoy cooking for my friends.", "I ______ ______ for my friends."],
    ["stop + -ing", "He stopped smoking.", "He ______ ______."],
    ["look forward to", "I look forward to meeting you.", "I ______ you."],
  ])("rejects a gap for %s that also hides words outside the target", (en, full, gap) => {
    expect(lexicalGapProblem(en, full, gap)).toBe("study_gap_overhidden");
    expect(() =>
      prepare().assemble(
        wire({
          ...output(),
          learningItems: [
            { ...lexical(), en, fullSentence: full, gapSentence: gap, faMeaning: "معنی" },
          ],
        }),
      ),
    ).toThrow(failure("study_gap_overhidden"));
  });

  it("accepts inflected or separated targets whose blanks hide only the target", () => {
    for (const [en, full, gap] of [
      ["make a mistake", "Everyone makes mistakes sometimes.", "Everyone ______ sometimes."],
      ["kit sth out", "We need to kit the office out.", "We need to ______ the office ______."],
      ["a lot of", "A lot of people came.", "______ people came."],
      // Several blanks may split one multiword target without hiding anything else.
      ["give up", "Please give up sugar.", "Please ______ ______ sugar."],
      ["do homework", "I do my homework after dinner.", "I ______ my ______ after dinner."],
    ] as const)
      expect(lexicalGapProblem(en, full, gap)).toBeUndefined();
  });

  it("ties grammar IPA to exact consecutive words of the answer, never a label", () => {
    const prepared = prepare();
    expect(
      prepared.assemble(wire({ ...output(), learningItems: [grammar()] })).learningItems[0]?.study,
    ).toMatchObject({ ipa: grammar().ipa });
    // Punctuation and case are ignored; the chunk may also come from the item's class evidence.
    for (const spokenChunk of ["she walks", "She walks,", "look forward to"])
      expect(
        prepared.assemble(wire({ ...output(), learningItems: [{ ...grammar(), spokenChunk }] }))
          .learningItems,
      ).toHaveLength(1);
    for (const spokenChunk of [
      "third person + verb + s",
      "subject verb",
      "She walks to the small shop every",
      "walks every",
    ])
      expect(() =>
        prepared.assemble(wire({ ...output(), learningItems: [{ ...grammar(), spokenChunk }] })),
      ).toThrow(failure("study_ipa_chunk_invalid"));
    const { spokenChunk: _chunk, ...missing } = grammar();
    expect(() => prepared.assemble(wire({ ...output(), learningItems: [missing] }))).toThrow();
    // The chunk is a wire-only scope control; canonical study content is unchanged.
    expect(
      prepared.assemble(wire({ ...output(), learningItems: [grammar()] })).learningItems[0]?.study,
    ).not.toHaveProperty("spokenChunk");
  });

  it("stores the transcribed grammar words exactly as written where the chunk was found", () => {
    const prepared = prepare();
    const assembled = (spokenChunk: string, fields: Record<string, unknown> = {}) =>
      prepared.assemble(
        wire({ ...output(), learningItems: [{ ...grammar(), ...fields, spokenChunk }] }),
      ).learningItems[0];
    const stored = (spokenChunk: string, fields: Record<string, unknown> = {}) =>
      assembled(spokenChunk, fields)?.study;
    // The answer's own case, spelling and inner punctuation win over the copied chunk.
    for (const spokenChunk of ["she walks", "She walks,", "SHE WALKS"])
      expect(stored(spokenChunk)).toMatchObject({ ipaText: "She walks", ipa: grammar().ipa });
    // Content identities follow the stored words, not the spelling of the copied chunk.
    expect(assembled("SHE WALKS")?.id).toBe(assembled("she walks")?.id);
    expect(assembled("look forward to")?.id).not.toBe(assembled("she walks")?.id);
    expect(
      stored("mondays she walks", {
        fullSentence: "On Mondays, she walks to the small shop.",
        prompt: "Correct the verb: On Mondays, she walk to the small shop.",
      }),
    ).toMatchObject({ ipaText: "Mondays, she walks" });
    // An inverted question keeps its subject between the auxiliary and the verb.
    const question = {
      fullSentence: "Does she walk to the small shop every morning?",
      prompt: "Make a question: She walks to the small shop every morning.",
    };
    expect(stored("does she walk", question)).toMatchObject({ ipaText: "Does she walk" });
    expect(() => stored("does walk", question)).toThrow(failure("study_ipa_chunk_invalid"));
    // A chunk from the item's cited class block keeps that block's text.
    expect(stored("LOOK FORWARD TO")).toMatchObject({ ipaText: "look forward to" });
    // Words that are not English Latin-script text never become the transcribed words.
    const mixed = { fullSentence: "She walks to the small shop فعل را every morning." };
    for (const spokenChunk of ["فعل را", "shop فعل"])
      expect(() => stored(spokenChunk, mixed)).toThrow(failure("study_ipa_chunk_invalid"));
    expect(() =>
      stored("فعل را", { prompt: "Correct the verb (فعل را): She walk to the small shop." }),
    ).toThrow(failure("study_ipa_chunk_invalid"));
    // Shared symbols and a modifier-letter apostrophe are copied words, not another script.
    for (const [spokenChunk, fullSentence, ipaText] of [
      ["it costs £5", "It costs £5 to visit the small shop every morning.", "It costs £5"],
      ["is 20°C", "The temperature is 20°C every morning.", "is 20°C"],
      ["she doesnʼt walk", "She doesnʼt walk to the small shop.", "She doesnʼt walk"],
    ] as const)
      expect(stored(spokenChunk, { fullSentence })).toMatchObject({ ipaText });
    // Lexical IPA transcribes meaning.en itself, so it stores no transcribed words.
    expect(prepared.assemble(wire(output())).learningItems[0]?.study).not.toHaveProperty("ipaText");
  });

  it("AC-D46-04 never stores a prompt's uncorrected form, blank or cue as the transcribed words", () => {
    const exercise = {
      ...source(),
      blocks: [
        {
          id: "block",
          unitId: "unit",
          kind: "paragraph" as const,
          text: "Complete: she ______ (walks) home. Answer: she walks home.",
        },
      ],
    };
    const prepared = prepare(input([exercise]));
    const stored = (spokenChunk: string, fields: Record<string, unknown> = {}) =>
      prepared.assemble(
        wire({ ...output(), learningItems: [{ ...grammar(), ...fields, spokenChunk }] }),
      ).learningItems[0]?.study;
    // The prompt holds the learner's uncorrected form; the answer is where words are copied from.
    expect(grammar().prompt).toContain("She walk to");
    expect(() => stored("she walk")).toThrow(failure("study_ipa_chunk_invalid"));
    const cue = { prompt: "She ______ (walks / walk) to the small shop every morning." };
    for (const spokenChunk of ["she walks walk", "she walk to", "walk to the"])
      expect(() => stored(spokenChunk, cue)).toThrow(failure("study_ipa_chunk_invalid"));
    expect(stored("she walks", cue)).toMatchObject({ ipaText: "She walks" });
    // A class block's run across a blank or cue is skipped for its clean run of the same words.
    expect(() => stored("complete she walks")).toThrow(failure("study_ipa_chunk_invalid"));
    expect(stored("she walks home")).toMatchObject({ ipaText: "she walks home" });
  });

  it("shows the transcribed grammar words beside the IPA in the Persian Class Notes", () => {
    const decoded = prepare().decode(
      wire({
        ...output(),
        learningItems: [{ ...grammar(), spokenChunk: "she walks", ipa: "/ʃi wɔːks/" }],
      }),
    );
    const html = renderClassNotesHtml(decoded);
    const transcribed = 'She walks <bdi dir="ltr" class="ipa">/ʃi wɔːks/</bdi>';
    expect(html).toContain(`<p class="pron">🔊 <bdi dir="ltr">${transcribed}</bdi>`);
    expect(html).toContain(`<td dir="ltr">${transcribed}</td>`);
    // The decoded model already passed canonical validation with the stored words.
    expect(decoded.learningItems[0]?.study).toMatchObject({ ipaText: "She walks" });
  });

  it("rejects a planned concept that no claim states with its evidence", () => {
    const data = input([source(), source()]);
    const prepared = prepare(data);
    const planned = (keys: string[]) =>
      wire({
        ...output(),
        lessonPlan: keys.map((key) => ({ concept: key, evidenceKeys: [key], teachAs: "card" })),
      });
    expect(() => prepared.assemble(planned(["r0", "r1"]))).toThrow(failure("study_plan_uncovered"));
    // A concept planned for notes may be taught in tasks or notes without its own claim.
    expect(
      prepared.assemble(
        wire({
          ...output(),
          lessonPlan: [
            { concept: "r0", evidenceKeys: ["r0"], teachAs: "card" },
            { concept: "r1", evidenceKeys: ["r1"], teachAs: "notes" },
          ],
        }),
      ).learningItems,
    ).toHaveLength(1);
    expect(prepared.assemble(planned(["r0"])).learningItems).toHaveLength(1);
    expect(
      prepared.assemble(
        wire({
          ...output(),
          lessonPlan: [
            { concept: "r0", evidenceKeys: ["r0"], teachAs: "card" },
            { concept: "r1", evidenceKeys: ["r1"], teachAs: "notes" },
          ],
          summary: [{ ...claim(["r1"]), text: "نکتهٔ دوم در یادداشت آمده است." }],
        }),
      ).summary,
    ).toHaveLength(1);
  });

  it("treats omitted optional lists as empty, never as an error or invented content", () => {
    const prepared = prepare();
    const grouped = prepared.schema.parse(wire({ ...output(), learningItems: [grammar()] })) as {
      learningItems: { teaching: Record<string, unknown> }[];
      [key: string]: unknown;
    };
    const item = first(grouped.learningItems);
    const { collocations: _collocations, ...teaching } = item.teaching;
    const {
      summary: _summary,
      topics: _topics,
      homework: _homework,
      uncertainties: _uncertainties,
      ...rest
    } = grouped;
    const assembled = prepared.assemble({ ...rest, learningItems: [{ ...item, teaching }] });
    expect(assembled.learningItems[0]?.study).toMatchObject({ collocations: [] });
    expect(assembled).toMatchObject({ summary: [], topics: [], homework: [], uncertainties: [] });
    expect(prepared.system).toContain("omit collocations otherwise");
  });
});

/** [path, node] for every schema node; property names are data, not keywords. */
function schemaNodes(
  node: unknown,
  path = "#",
  found: [string, Record<string, unknown>][] = [],
): [string, Record<string, unknown>][] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return found;
  const schema = node as Record<string, unknown>;
  found.push([path, schema]);
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object")
      for (const [name, child] of Object.entries(value))
        schemaNodes(child, `${path}.${name}`, found);
    else if ((key === "anyOf" || key === "oneOf") && Array.isArray(value))
      value.forEach((child, index) => {
        schemaNodes(child, `${path}|${index}`, found);
      });
    else if (key === "items" || key === "additionalProperties")
      schemaNodes(value, `${path}[]`, found);
  }
  return found;
}

describe("FR-PROC-004 v5 contract over the Gemini json_schema transport", () => {
  const gemini = "google/gemini-3.8-flash";
  // A JSON Schema validator stands in for the remote grammar: it must accept every valid lesson.
  const grammarOf = (schema: Record<string, unknown>) =>
    z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema);
  const keywords = (schema: unknown) =>
    new Set(schemaNodes(schema).flatMap(([, node]) => Object.keys(node)));
  const objects = (schema: unknown) =>
    schemaNodes(schema)
      .filter(([, node]) => node.type === "object")
      .map(([path, node]) => [path, node.required, node.additionalProperties]);
  const items = (language: string, ...learningItems: Record<string, unknown>[]) =>
    learningItems.map((item) => (language === "fa" ? item : { ...item, faApprox: "" }));

  it.each(["fa", "ja"])(
    "sends the %s lesson schema inlined in Gemini's documented subset with literal discriminators",
    (language) => {
      const prepared = prepare(input([source()], language));
      const original = z.toJSONSchema(prepared.schema);
      const transport = createStructuredTransport(prepared.schema, gemini);
      const forbidden = ["const", "oneOf", "pattern", "minLength", "maxLength", "maxItems"];
      expect(forbidden.filter((keyword) => !keywords(original).has(keyword))).toEqual(
        language === "fa" ? [] : ["pattern"],
      );
      expect(
        [...forbidden, "$schema", "$ref", "$defs"].filter((keyword) =>
          keywords(transport.schema).has(keyword),
        ),
      ).toEqual([]);
      const nodes = schemaNodes(transport.schema);
      expect(nodes.filter(([, node]) => Number(node.minItems) > 1)).toEqual([]);
      const byPath = new Map(nodes);
      expect([0, 1, 2].map((index) => byPath.get(`#.learningItems[]|${index}.type`))).toEqual(
        ["lexical", "grammar", "recognition"].map((type) => ({ type: "string", enum: [type] })),
      );
      expect(
        [0, 1, 2, 3].map((index) =>
          byPath.get(`#.classNotes.activities.tasks[].blocks[]|${index}.type`),
        ),
      ).toEqual(
        ["text", "quote", "table", "items"].map((type) => ({ type: "string", enum: [type] })),
      );
      expect(byPath.get("#.lessonPlan[].evidenceKeys[]")).toEqual({ type: "string", enum: ["r0"] });
      // Every object keeps its exact required list and additionalProperties:false.
      expect(objects(transport.schema)).toEqual(objects(original));
      expect(objects(transport.schema).length).toBeGreaterThan(30);
      expect(objects(transport.schema).every(([, , additional]) => additional === false)).toBe(
        true,
      );

      const grammarCheck = grammarOf(transport.schema);
      const valid = wire({
        ...output(),
        learningItems: items(language, lexical(), grammar(), recognitionItem()),
      });
      expect(transport.decode(valid)).toBe(valid);
      expect(prepared.schema.safeParse(valid).success).toBe(true);
      expect(grammarCheck.safeParse(valid).success).toBe(true);
      // Dropped length, list and script bounds remain local rejections.
      for (const loosened of [
        wire({ ...output(), learningItems: items(language, { ...lexical(), imageFa: "" }) }),
        wire({
          ...output(),
          lessonPlan: Array.from({ length: 41 }, () => ({
            concept: "planned concept",
            evidenceKeys: ["r0"],
            teachAs: "notes",
          })),
          learningItems: items(language, lexical()),
        }),
        ...(language === "fa"
          ? [wire({ ...output(), learningItems: [{ ...lexical(), faApprox: "لوک nk" }] })]
          : []),
      ]) {
        expect(grammarCheck.safeParse(loosened).success).toBe(true);
        expect(transport.decode(loosened)).toBe(loosened);
        expect(prepared.schema.safeParse(transport.decode(loosened)).success).toBe(false);
      }
      for (const invalid of [
        wire({ ...output(), learningItems: items(language, { ...lexical(), type: "other" }) }),
        wire({
          ...output(),
          learningItems: items(language, { ...lexical(), claim: claim(["zz"]) }),
        }),
        wire({ ...output(), learningItems: items(language, { ...lexical(), invented: "key" }) }),
      ]) {
        expect(grammarCheck.safeParse(invalid).success).toBe(false);
        expect(prepared.schema.safeParse(transport.decode(invalid)).success).toBe(false);
      }
    },
  );

  it("sends a long class's evidence keys as typed strings that local validation still checks", () => {
    const long = source();
    long.blocks = Array.from({ length: 65 }, (_, index) => ({
      ...first(long.blocks),
      id: `block-${index}`,
      text: `Synthetic class line ${index}.`,
    }));
    const prepared = prepare(input([long], "ja"));
    const transport = createStructuredTransport(prepared.schema, gemini);
    const byPath = new Map(schemaNodes(transport.schema));
    for (const path of [
      "#.lessonPlan[].evidenceKeys[]",
      "#.learningItems[]|0.claim.evidenceKeys[]",
      "#.homework[].evidenceKeys[]",
      "#.classNotes.activities.board[].evidenceKeys[]",
    ])
      expect(byPath.get(path)).toEqual({ type: "string" });
    const invented = wire({
      ...output(),
      learningItems: items("ja", { ...lexical(), claim: claim(["zz"]) }),
    });
    expect(grammarOf(transport.schema).safeParse(invented).success).toBe(true);
    expect(transport.decode(invented)).toBe(invented);
    expect(prepared.schema.safeParse(transport.decode(invented)).success).toBe(false);
    expect(
      prepared.schema.safeParse(
        wire({ ...output(), learningItems: items("ja", { ...lexical(), claim: claim(["r1s"]) }) }),
      ).success,
    ).toBe(true);
  });
});

describe("FR-PROC-004 v5 wire checks: hidden grammar answers, headword answers and class quotations", () => {
  const failure = (code: string) =>
    expect.objectContaining({ details: { fields: { output: [code] } } });
  const card = (taskFa: string, prompt: string, fullSentence: string) => ({
    ...grammar(),
    taskFa,
    prompt,
    fullSentence,
    spokenChunk: fullSentence.split(" ").slice(0, 2).join(" "),
  });
  const instruction = "جمله را طبق دستور بنویسید.";

  it.each([
    // Accepted comparison outputs whose front already showed the answer.
    [
      "Completa la frase formal utilizando la estructura de subjuntivo con el verbo entre paréntesis.",
      "Complete with the subjunctive form of 'rest': The doctor recommended that he (rest) for a week.",
      "The doctor recommended that he rest for a week.",
    ],
    [
      "Conjuga el verbo entre paréntesis conforme a la estructura de subjuntivo requerida por la expresión impersonal.",
      "Use the formal subjunctive of 'attend': It is essential that every student (attend) the first class.",
      "It is essential that every student attend the first class.",
    ],
    [
      "指示語の単数・複数および距離に注意して文を完成させてください。",
      "(this) bag is mine.",
      "This bag is mine.",
    ],
    [
      "استخدم 'of' لربط الشيء بالمكان أو الشيء الآخر.",
      "Complete: The color of the wall is blue. The ______ of the wall is blue.",
      "The color of the wall is blue.",
    ],
    [
      "Перетворіть прохання на наказ, використовуючи базову форму дієслова stop.",
      "Give an instruction to stop at the lights.",
      "Stop at the lights.",
    ],
    [
      "Напишіть заперечний наказ з Don't для дії open the door.",
      "Write a negative instruction with Don't: open the door.",
      "Don't open the door.",
    ],
    [
      "Напишіть наказ, використовуючи базову форму дієслова.",
      "Write an instruction: (touch / the oven)",
      "Touch the oven.",
    ],
    [
      "Перепишіть речення, починаючи з It is believed that, і збережіть той самий зміст.",
      "Rewrite with It is believed that: The painting is a copy.",
      "It is believed that the painting is a copy.",
    ],
    [
      "با استفاده از ساختار Why don't you یک پیشنهاد دوستانه برای استراحت کردن بسازید.",
      "Suggest a break to someone: (Why don't you / take) a break?",
      "Why don't you take a break?",
    ],
    [
      "یک تصمیم لحظه‌ای بگو که همین الان با will گرفته‌ای.",
      "Someone knocks at the door. Say that you will open the door.",
      "I'll open the door.",
    ],
    // Repair-generation cards with the same defect.
    [
      "Reescribe la recomendación médica usando la estructura formal de subjuntivo.",
      "The doctor advised rest for him: The doctor recommended (that / he / rest for a week).",
      "The doctor recommended that he rest for a week.",
    ],
    [
      "Completa la pauta formal usando el subjuntivo mandativo con la forma base.",
      "State the formal requirement: It is essential (that / every student attend the first class).",
      "It is essential that every student attend the first class.",
    ],
    // The cue moved away from its blank, and lead-ins behind other separators.
    [
      instruction,
      "The doctor recommended that he ______ for a week. (rest)",
      "The doctor recommended that he rest for a week.",
    ],
    [
      instruction,
      "The doctor recommended that he ______ for a week (rest).",
      "The doctor recommended that he rest for a week.",
    ],
    [
      instruction,
      "(rest) The doctor recommended that he ______ for a week.",
      "The doctor recommended that he rest for a week.",
    ],
    [instruction, "______ bag is mine. (this)", "This bag is mine."],
    [
      instruction,
      "The painting is a copy. -> It is believed that ...",
      "It is believed that the painting is a copy.",
    ],
    [
      instruction,
      "Rewrite with It is believed that：The painting is a copy.",
      "It is believed that the painting is a copy.",
    ],
    [
      instruction,
      "Rewrite with It is believed that — The painting is a copy.",
      "It is believed that the painting is a copy.",
    ],
    [
      instruction,
      "Rewrite with It is believed that → The painting is a copy.",
      "It is believed that the painting is a copy.",
    ],
  ])(
    "rejects a grammar front that already shows its answer: %s / %s",
    (taskFa, prompt, fullSentence) => {
      expect(grammarPromptRevealsAnswer(taskFa, prompt, fullSentence)).toBe(true);
      expect(() =>
        prepare().assemble(
          wire({ ...output(), learningItems: [card(taskFa, prompt, fullSentence)] }),
        ),
      ).toThrow(failure("study_prompt_reveals_answer"));
    },
  );

  it.each([
    // Contractions are a real change outside a clause the learner must say.
    ["Write the short form: I am not ready.", "I'm not ready."],
    ["They are not at home.", "They aren't at home."],
    ["We've finished the report.", "We have finished the report."],
    ["Write the full form: They're late.", "They are late."],
    ["Write the full form: She doesn't eat meat.", "She does not eat meat."],
    ["Write the full form: I'd like a coffee.", "I would like a coffee."],
    ["She won't come today.", "She will not come today."],
    ["Use contractions: They are late.", "They're late."],
    ["Using a short form, say that you are not ready.", "I'm not ready."],
    // Punctuation that the answer uses is part of the task.
    ["Add the apostrophe: My parents house is near the sea.", "My parents' house is near the sea."],
    ["The teachers room is on the left.", "The teachers' room is on the left."],
    ["Add the hyphen: I need an up to date timetable.", "I need an up-to-date timetable."],
    ["Correct the mistake: She is a well known writer.", "She is a well-known writer."],
    [
      "Replace the comma with a semicolon: I love tea, my sister loves coffee.",
      "I love tea; my sister loves coffee.",
    ],
    ["Add a capital letter and a question mark: where do you live", "Where do you live?"],
    ["Correct the punctuation: Do you like coffee.", "Do you like coffee?"],
    ["What a beautiful day.", "What a beautiful day!"],
    ["We read Animal Farm in class.", 'We read "Animal Farm" in class.'],
    [
      "Add brackets: My brother who lives in Kyiv is a doctor.",
      "My brother (who lives in Kyiv) is a doctor.",
    ],
    ["Add a comma: When I arrived the shop was closed.", "When I arrived, the shop was closed."],
    // Removing a wrong hyphen, plural apostrophe or semicolon is a real task.
    ["Correct the mistake: My son is five-years-old.", "My son is five years old."],
    ["My son is five-years-old.", "My son is five years old."],
    ["Correct the mistake: The writer is well-known.", "The writer is well known."],
    ["Correct the mistake: The dogs' are barking.", "The dogs are barking."],
    ["Correct the mistake: I bought some apple's.", "I bought some apples."],
    ["Correct the punctuation: I like tea; and coffee.", "I like tea and coffee."],
    // A blank may need nothing at all, such as a zero article or a bare infinitive.
    [
      "Complete with a, an, the or – (no article): ______ dogs are loyal animals.",
      "Dogs are loyal animals.",
    ],
    ["I like ______ music.", "I like music."],
    ["I'm going ______ home now.", "I'm going home now."],
    ["My parents made me ______ clean my room.", "My parents made me clean my room."],
    ["______ life is beautiful.", "Life is beautiful."],
    ["I play ______ tennis on Sundays. (the / –)", "I play tennis on Sundays."],
    ["Put in the if necessary: I love ______ chocolate.", "I love chocolate."],
    // A reported-to-direct change of pronoun is the point being taught.
    ["Change to direct speech: Anna says that I can leave early.", "You can leave early."],
    ["Change to direct speech: Sara told me that I looked tired.", "You looked tired."],
    // Sentence and word options leave the learner a choice.
    [
      "Choose the correct sentence. A. I have lived here since 2010. B. I am living here since 2010.",
      "I have lived here since 2010.",
    ],
    ["Which is correct? There is two chairs. / There are two chairs.", "There are two chairs."],
    [
      "The doctor recommended that he (rest / rests) for a week.",
      "The doctor recommended that he rest for a week.",
    ],
    ["You (must / mustn't) wear a helmet here.", "You must wear a helmet here."],
    ["You ______ wear a helmet here. (must / mustn't)", "You must wear a helmet here."],
    ["Complete with this, that, these or those: _____ shoes are new.", "Those shoes are new."],
    ["Complete with this / that / these / those: _____ shoes are new.", "Those shoes are new."],
    // A cue that needs a change, and transformations.
    ["If it ___ (rain), we will stay at home.", "If it rains, we will stay at home."],
    ["Join with because: I stayed in. It was raining.", "I stayed in because it was raining."],
    [
      "Join with Although: The bus was late. We arrived on time.",
      "Although the bus was late, we arrived on time.",
    ],
    [
      "Rewrite using It is essential that: Every student must attend the first class.",
      "It is essential that every student attend the first class.",
    ],
    ["Rewrite starting with Never: I have seen such a mess.", "Never have I seen such a mess."],
    // Named-insertion gaps are steered by the generation prompt, not rejected.
    ["Ask about the owner of the pen: ______ pen is this?", "Whose pen is this?"],
    [
      "Complete with a precaution: Take an umbrella ______ it rains.",
      "Take an umbrella in case it rains.",
    ],
    [
      "Complete with when: I was cooking [...] the phone rang.",
      "I was cooking when the phone rang.",
    ],
    [
      "Join with and, both in the past continuous: The sun was shining. People were walking in the park.",
      "The sun was shining and people were walking in the park.",
    ],
  ])("accepts a grammar front that leaves a real task: %s", (prompt, fullSentence) => {
    expect(grammarPromptRevealsAnswer(instruction, prompt, fullSentence)).toBe(false);
    expect(
      prepare().assemble(
        wire({ ...output(), learningItems: [card(instruction, prompt, fullSentence)] }),
      ).learningItems,
    ).toHaveLength(1);
  });

  it("keeps capitalisation-only fronts rejected where the bare prompt already is", () => {
    // The existing case-insensitive study_answer_exposed already rejects the bare prompt, so an
    // instruction in front of it does not turn the same card into a task.
    for (const prompt of [
      "monday is my favourite day.",
      "Correct the capital letter: monday is my favourite day.",
    ])
      expect(grammarPromptRevealsAnswer(instruction, prompt, "Monday is my favourite day.")).toBe(
        true,
      );
    // A mid-sentence capital is a change the learner must make.
    expect(
      grammarPromptRevealsAnswer(
        instruction,
        "Correct the capitals: my sister lives in london.",
        "My sister lives in London.",
      ),
    ).toBe(false);
  });

  it("steers a revealed grammar front and a named insertion toward a real task", () => {
    const repair = buildKnowledgeGenerationInput(input(), 120000, {
      repairReason: "provider_schema_invalid",
      repairDetail: "assembly:study_prompt_reveals_answer",
    });
    expect(repair.system).toContain(
      "Give a cue the learner must change or choose from, for example two forms in brackets",
    );
    expect(prepare().system).toContain(
      "Never name in taskFa or the instruction the only word(s) that fill the blank unless real alternatives are offered",
    );
    expect(prepare().system).toContain("it is never already the required form");
  });

  it("asks for a rewritten cue instead of a class-printed answer and for an uncut inverted chunk", () => {
    const prepared = prepare();
    const schemaText = JSON.stringify(z.toJSONSchema(prepared.schema));
    for (const text of [prepared.system, schemaText]) {
      expect(text).toContain("printed its exercise that way");
      expect(text).toContain("plausible wrong form");
      // Options in a fixed order would let the learner answer by position.
      expect(text).toContain("in varying order so the required form is not always first");
      expect(text).toContain("the subject between the auxiliary and the verb");
    }
    expect(schemaText).toContain("IPA transcription of exactly the words in spokenChunk");
    expect(prepared.system).toContain("for a grammar item, exactly its spokenChunk");
    expect(prepared.system).toContain("fullSentence stays the correct class sentence");
    expect(prepared.system).toContain("The server rejects a front whose cue is already the answer");
    for (const [code, guidance] of [
      ["study_prompt_reveals_answer", "rewrite the prompt so the learner must choose or change"],
      [
        "study_prompt_reveals_answer",
        'the required form and a plausible wrong form separated by " / "',
      ],
      ["study_prompt_reveals_answer", "in varying order so the required form is not always first"],
      ["study_ipa_chunk_invalid", "never skip one: in a question with subject-auxiliary inversion"],
      [
        "study_ipa_chunk_invalid",
        "Never copy the chunk from practice.prompt or across a blank, bracket or slash",
      ],
      ["study_ipa_chunk_invalid", "pronunciation.ipa transcribes exactly those words"],
    ] as const)
      expect(
        buildKnowledgeGenerationInput(input(), 120000, {
          repairReason: "provider_schema_invalid",
          repairDetail: `assembly:${code}`,
        }).system,
      ).toContain(guidance);
  });

  it.each([
    ["object pronoun", "Can you help me?", "Can you help ______?"],
    ["object pronoun me", "Can you help me?", "Can you help ______?"],
    ["question word", "Where do you live?", "______ do you live?"],
    ["subject pronoun", "She works in a bank.", "______ works in a bank."],
    ["preposition of place", "The keys are on the table.", "The keys are ______ the table."],
    ["definite article", "Close the door, please.", "Close ______ door, please."],
    ["reflexive pronoun", "She hurt herself.", "She hurt ______."],
  ])("AC-D46-01 rejects the grammar label %s as a lexical answer", (en, full, gap) => {
    expect(lexicalGapProblem(en, full, gap)).toBe("study_answer_label");
    expect(gapHidesWholeTarget(en, full, gap)).toBe(false);
    expect(() =>
      prepare().assemble(
        wire({
          ...output(),
          learningItems: [
            {
              ...lexical(),
              en,
              fullSentence: full,
              gapSentence: gap,
              faMeaning: "معنی",
              ipa: "/miː/",
            },
          ],
        }),
      ),
    ).toThrow(failure("study_answer_label"));
  });

  it.each([
    // No grammar term: abbreviations, numerals and suppletive forms stay valid headwords.
    ["the eighth", "Henry VIII had six wives.", "Henry ______ had six wives."],
    ["in the afternoon", "The film starts at 3 p.m.", "The film starts at 3 ______."],
    ["because", "I stayed at home cos I was ill.", "I stayed at home ______ I was ill."],
    ["pounds", "The baby weighed 7 lbs.", "The baby weighed 7 ______."],
    ["toilet", "Excuse me, where is the WC?", "Excuse me, where is the ______?"],
    [
      "namely",
      "Two cities, viz. Leeds and York, applied.",
      "Two cities, ______ Leeds and York, applied.",
    ],
    ["badly", "He played worse than last week.", "He played ______ than last week."],
    ["twelve", "The clock showed XII.", "The clock showed ______."],
    ["make a mistake", "Everyone makes mistakes.", "Everyone ______ ______."],
    ["teach", "My aunt taught me to swim.", "My aunt ______ me to swim."],
    ["mouse", "The mice ran away.", "The ______ ran away."],
    ["refrigerator", "Put the milk in the fridge.", "Put the milk in the ______."],
    ["twenty-one", "She is 21 years old.", "She is ______ years old."],
    ["would rather", "I'd rather stay at home.", "I'd ______ stay at home."],
    ["enjoy oneself", "We enjoyed ourselves at the party.", "We ______ ourselves at the party."],
    ["United Kingdom", "She moved to the UK.", "She moved to the ______."],
    // A grammar term used as ordinary vocabulary is hidden by its own word.
    ["article", "I read an article about bees.", "I read an ______ about bees."],
    ["question word", "Who is a question word.", "Who is a ______ ______."],
    ["linking word", "However is a linking word.", "However is a ______ ______."],
  ])("AC-D46-01 accepts the headword %s whose blanks hide its own words", (en, full, gap) => {
    expect(lexicalGapProblem(en, full, gap)).toBeUndefined();
  });

  it("AC-D46-01 steers a label answer to a headword or a grammar item", () => {
    expect(
      buildKnowledgeGenerationInput(input(), 120000, {
        repairReason: "provider_schema_invalid",
        repairDetail: "assembly:study_answer_label",
      }).system,
    ).toContain("never replace the headword with a category name or add one to it");
    expect(
      buildKnowledgeGenerationInput(input(), 120000, { repairReason: "study_target_unsupported" })
        .system,
    ).toContain("Never replace a list or set of forms with a grammar category name");
  });

  it.each([
    ["however", "/haʊˈevə ɪt wəz sləʊ/"],
    ["reliable", "/ðɪs kɑː ɪz rɪˈlaɪəbl/"],
    ["on time", "/ðə treɪn ɪz ɒn taɪm/"],
    ["headache", "/aɪ hæv ə ˈhedeɪk/"],
    ["make a decision", "/aɪ ˈmeɪd ə dɪˈsɪʒn ˈjestədeɪ/"],
    ["put sth off", "/wiː hæd tə pʊt ðə ˈmiːtɪŋ ɒf/"],
    // Optional sounds, syllable-sized words and letter names do not hide added sentence words.
    ["comfortable", "/ðɪs ˈtʃeə(r) ɪz ˈkʌmf(ə)təb(ə)l/"],
    ["controversy", "/ðə ˌkɒntrəˈvɜːsi ɪz ˈbɪɡ/"],
    ["rain", "/ɪt wɪl reɪn təˈmɒrəʊ/"],
    ["asap", "/pliːz ˈkɔːl miː ˌeɪ es eɪ ˈpiː/"],
  ])("AC-D46-04 rejects lexical IPA of %s that adds sentence words", (en, ipa) => {
    expect(lexicalIpaExceedsHeadword(en, ipa)).toBe(true);
  });

  it.each([
    // Variant, stress-shift and labelled notations transcribe the same headword.
    ["data", "/ˈdeɪtə/ or /ˈdɑːtə/"],
    ["data", "/ˈdeɪtə ~ ˈdɑːtə/"],
    ["data", "ˈdeɪtə, ˈdɑːtə"],
    ["record", "/ˈrekɔːd/ (n), /rɪˈkɔːd/ (v)"],
    ["record", "ˈrekɔːd noun; rɪˈkɔːd verb"],
    ["schedule", "UK /ˈʃedjuːl/, US /ˈskedʒuːl/"],
    ["can", "strong /kæn/ weak /kən/"],
    ["under", "/ˈʌndə(r)/"],
    ["controversy", "/ˈkɒn.trə.vɜː.si/ or /kənˈtrɒv.ə.si/"],
    // Dictionary optional sounds inside a word, and a variant list of principal parts.
    ["comfortable", "/ˈkʌmf(ə)təb(ə)l/"],
    ["vegetable", "/ˈvedʒ(ə)t(ə)b(ə)l/"],
    ["different", "/ˈdɪf(ə)r(ə)nt/"],
    ["general", "/ˈdʒɛn(ə)r(ə)l/"],
    ["several", "/ˈsɛv(ə)r(ə)l/"],
    ["different from", "/ˈdɪf(ə)r(ə)nt frəm/"],
    ["go", "/ɡəʊ – went – ɡɒn/"],
    // Words spaced by syllable, and an initialism written in lower case.
    ["controversy", "/ˈkɒn trə vɜː si/"],
    ["incredible", "/ɪn ˈkred ə bəl/"],
    ["actually", "/ˈæk tʃu ə li/"],
    ["optimism", "/ˈɒp tɪ mɪ zəm/"],
    ["asap", "/ˌeɪ es eɪ ˈpiː/"],
    ["bbc", "/ˌbiː biː ˈsiː/"],
    // Slots and complements may be spoken; hyphen parts, initialisms and numbers count apart.
    ["put sth off", "/pʊt ˈsʌmθɪŋ ɒf/"],
    ["kit sth out", "/kɪt ði ˈɒfɪs aʊt/"],
    ["borrow sth from sb", "/ˈbɒrəʊ ˈsʌmθɪŋ frəm ˈsʌmbədi/"],
    ["be used to + -ing", "/bɪ juːst tə ˈwɜːkɪŋ/"],
    ["in case + noun / verb", "/ɪn ˈkeɪs ɪt ˈreɪnz/"],
    ["double-edged sword", "/ˌdʌbl ˈedʒd ˈsɔːd/"],
    ["trade-off", "/ˈtreɪd ɒf/"],
    ["Why don't you", "/waɪ ˈdəʊnt juː/"],
    ["elephant in the room", "/ði ˈelɪfənt ɪn ðə ˈruːm/"],
    ["DIY", "/ˌdiː aɪ ˈwaɪ/"],
    ["2021", "/ˈtwenti ˈtwenti ˈwʌn/"],
  ])("AC-D46-04 accepts lexical IPA for %s: %s", (en, ipa) => {
    expect(lexicalIpaExceedsHeadword(en, ipa)).toBe(false);
  });

  it("AC-D46-04 rejects generated lexical IPA beyond its headword and steers the regeneration", () => {
    expect(
      prepare().assemble(wire({ ...output(), learningItems: [lexical()] })).learningItems,
    ).toHaveLength(1);
    expect(() =>
      prepare().assemble(
        wire({
          ...output(),
          learningItems: [{ ...lexical(), ipa: "/aɪ lʊk ˈfɔːwəd tə ˈmiːtɪŋ maɪ njuː ˈneɪbəz/" }],
        }),
      ),
    ).toThrow(failure("study_ipa_headword_invalid"));
    expect(
      buildKnowledgeGenerationInput(input(), 120000, {
        repairReason: "provider_schema_invalid",
        repairDetail: "assembly:study_ipa_headword_invalid",
      }).system,
    ).toContain("never transcribe the example sentence or other added words");
  });

  const quotes = (texts: string[][]) =>
    classQuotationSources(texts.map((blocks) => ({ blocks: blocks.map((text) => ({ text })) })));
  const surgery = "I'm sick and tired of going back and forth to the surgery every week.";

  it.each([
    ["I've been work ing   here since May.", "I've been working here since May."],
    ["Can I   open t he wi ndow?", "Can I open the window?"],
    ["She is a well-\nknown writer in our town.", "She is a well-known writer in our town."],
    ["He has worked here for twenty-\nfive years.", "He has worked here for twenty-five years."],
    [
      "My neigh­bours have lived here for twenty years.",
      "My neighbours have lived here for twenty years.",
    ],
    ["The cafe where we met has closed.", "The café where we met has closed."],
    ["The café where we met has closed.", "The cafe where we met has closed."],
    ["I'd like a ˈcoffee, please.", "I'd like a coffee, please."],
    ["I’m sick and tired of it.", "I'm sick and tired of it."],
    ["I have lived here for ۲ years.", "I have lived here for 2 years."],
    [surgery, "…going back and forth to the surgery…"],
    [surgery, "I'm sick and tired of ⋯ the surgery every week."],
    [surgery, "I'm sick and tired of . . . the surgery every week."],
    [surgery, "I'm sick and tired of ‥ the surgery every week."],
  ])("keeps a faithful class quotation of %s", (text, classSentence) => {
    expect(quotesClassSources(classSentence, quotes([[text]]))).toBe(true);
  });

  const reported = "He asked where I lived. She asked if I was hungry.";
  const places = "This is the town where I grew up. The café where we met has closed.";
  it.each([
    // A speaker swap, blend, transformation, alteration or reordering is not a quotation.
    [reported, "She asked where I lived."],
    [reported, "He asked if I was hungry."],
    [places, "This is the café where we met."],
    ["It is believed that the painting is a copy.", "The painting is believed to be a copy."],
    ["This bag is mine. Those shoes are new.", "This bag is mine. That shoe is new."],
    ["He asked where I lived.", "He asked where I live."],
    ["Somebody called you.", "Some body called you."],
    // An interior ellipsis may only omit words in order inside one source sentence.
    [reported, "He asked … if I was hungry."],
    [reported, "She asked … where I lived."],
    [places, "This is the … café where we met."],
    ["This bag is mine. Those shoes are new.", "That … shoes are new."],
    ["It is believed that the painting is a copy.", "The painting is … believed … to be … a copy."],
    ["He asked where I lived.", "…"],
  ])("omits a class sentence that does not quote %s", (text, classSentence) => {
    expect(quotesClassSources(classSentence, quotes([[text]]))).toBe(false);
  });

  it("matches a sentence split across one source's blocks, and one class sentence per chunk", () => {
    const split = quotes([
      ["Class example: By the time we arrived, the film", "had already started."],
    ]);
    expect(quotesClassSources("By the time we arrived, the film had already started.", split)).toBe(
      true,
    );
    // Combining sentences from separate rows is not one class sentence.
    const dialogue = quotes([["A: How long have you lived here?", "B: For two years."]]);
    expect(quotesClassSources("How long have you lived here? For two years.", dialogue)).toBe(
      false,
    );
    expect(quotesClassSources("How long have you lived here?", dialogue)).toBe(true);
  });

  it("omits a misquoted Class Notes chunk without rejecting the lesson, from every source role", () => {
    const material = source();
    first(material.blocks).text = reported;
    const notes = source();
    notes.role = "user_notes";
    first(notes.blocks).text = "This is the restaurant where we met.";
    const data = input([material, notes]);
    const prepared = prepare(data);
    const chunk = (classSentence: string) => ({
      pattern: "reported question",
      classSentence,
      noteFa: "ترتیب کلمات خبری است.",
    });
    const raw = wire({
      ...output(),
      classNotes: {
        ...output().classNotes,
        chunks: [
          chunk("She asked where I lived."),
          chunk("He asked where I lived."),
          chunk("“She asked if I was hungry.”"),
          chunk("This is the restaurant where we met."),
          chunk("This is the café where we met."),
        ],
      },
    });
    // The wire keeps every chunk; the generation projection omits and counts the misquoted ones.
    expect(prepared.assemble(raw).classNotes?.chunks).toHaveLength(5);
    const { sourceClassifications: _sourceClassifications, ...knowledge } = prepared.decode(raw);
    const kept = [
      "He asked where I lived.",
      "“She asked if I was hungry.”",
      "This is the restaurant where we met.",
    ];
    const final = finalizeGeneratedStudyPractice(knowledge, data.sources, data.learnerContext);
    expect(final.model.classNotes?.chunks.map((entry) => entry.classSentence)).toEqual(kept);
    expect(final.audit.omittedCandidates.class_sentence_not_in_sources).toBe(2);
    expect(JSON.stringify(final.audit)).not.toContain("café");
    // Old queued settings without the D46 snapshot omit the same chunks.
    const legacy = finalizeGeneratedStudyPractice(knowledge, data.sources);
    expect(legacy.audit.applied).toBe(false);
    expect(legacy.model.classNotes?.chunks.map((entry) => entry.classSentence)).toEqual(kept);
    expect(knowledge.classNotes?.chunks).toHaveLength(5);
    const jsonSchema = JSON.stringify(createJsonFallbackTransport(prepared.schema).schema);
    expect(jsonSchema).toContain("One English class sentence copied exactly from the sources");
    expect(jsonSchema).toContain("omit the chunk if no class sentence shows the pattern");
    expect(prepared.system).toContain("never correct, combine or invent it");
  });

  it("keeps homework to work a class source sets for after class", () => {
    const prepared = prepare();
    const jsonSchema = JSON.stringify(createJsonFallbackTransport(prepared.schema).schema);
    for (const text of [prepared.system, jsonSchema]) {
      expect(text).not.toContain("source assignment");
      expect(text).not.toContain("sourced assignments");
    }
    expect(prepared.system).toContain(
      "Homework holds only work that a class source explicitly sets for after class",
    );
    expect(prepared.system).toContain(
      "A printed or in-class task belongs in classNotes.activities.tasks",
    );
    expect(prepared.system).toContain("another person's homework sheet is not an assignment");
    expect(prepared.system).toContain(
      "Retain each such assignment and relevant conflicts concisely",
    );
    expect(jsonSchema).toContain("homework that a class source explicitly sets for after class");
  });

  it("names the explanation language in words and shows the Persian order example only to Persian", () => {
    const arabic = buildKnowledgeGenerationInput(input([source()], "ar"), 120000);
    const arabicSchema = JSON.stringify(createJsonFallbackTransport(arabic.schema).schema);
    expect(arabic.system).toContain(
      'Explain in exactly "ar" (Arabic) using its normal writing system',
    );
    expect(arabic.system).toContain("another language that shares its script is not Arabic");
    expect(arabicSchema).toContain('Explanation prose in \\"ar\\" (Arabic)');
    expect(arabic.system).not.toContain("پس از");
    expect(arabic.system).not.toContain("For Persian explanations");
    expect(arabic.system).toContain("quote that exact English left-to-right pattern");
    const persian = prepare();
    expect(persian.system).toContain('Explain in exactly "fa" (Persian)');
    expect(persian.system).toContain('For Persian explanations, use "پس از X، Y می‌آید"');
    // A tag without a known English name falls back to the code.
    expect(buildKnowledgeGenerationInput(input([source()], "qaa"), 120000).system).toContain(
      'Explain in exactly "qaa" using its normal writing system',
    );
    const repair = buildKnowledgeGenerationInput(input([source()], "ar"), 120000, {
      repairReason: "language_script_mismatch",
    });
    expect(repair.system).toContain(
      'The requested explanation language is "ar" (Arabic). Another language written in the same script is not Arabic',
    );
    expect(repair.system).not.toContain("پس از");
    expect(
      buildKnowledgeGenerationInput(input([source()], "ar"), 120000, {
        repairReason: "study_gap_partial",
      }).system,
    ).not.toContain("The requested explanation language is");
  });
});
