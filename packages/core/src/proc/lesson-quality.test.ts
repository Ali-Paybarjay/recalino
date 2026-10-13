import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RunSource } from "./contracts";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
} from "./knowledge-generation";
import { lessonBudget } from "./lesson-budget";

function source(kind: RunSource["kind"], text: string, patch: Partial<RunSource> = {}): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: randomUUID(),
    sha256: "a".repeat(64),
    kind,
    mimeType: kind === "image" ? "image/jpeg" : "text/plain",
    role: kind === "image" ? "board_photo" : "class_material",
    durationMs: null,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: [{ id: "unit", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "block", unitId: "unit", kind: "paragraph", text }],
    ...patch,
  };
}
const handout = () =>
  source(
    "text",
    "I look forward to meeting my new neighbours. Look forward to means anticipate with pleasure.",
  );
const board = () => source("image", "look forward to + -ing");
function input(sources: RunSource[]): KnowledgeGenerationInput {
  return {
    sources,
    explanationLanguage: "fa",
    missingSourceIds: [],
    teachingPreferences: { shorterExamples: false },
    lessonContext: { date: "2026-10-12" },
  };
}
const item = {
  type: "lexical",
  kind: "expression",
  claim: { text: "این عبارت یعنی با اشتیاق منتظر بودن.", evidenceKeys: ["r0"], uncertain: false },
  meaning: {
    en: "look forward to + -ing / noun",
    faMeaning: "با اشتیاق منتظر اتفاقی بودن",
    topic: "anticipation",
  },
  pronunciation: { ipa: "/lʊk ˈfɔːwəd tə/", faApprox: "لوک فُروِد تَ" },
  practice: {
    fullSentence: "I look forward to meeting my new neighbours.",
    gapSentence: "I ______ meeting my new neighbours.",
  },
  teaching: {
    collocations: ["look forward to the weekend"],
    noteFa: "پس از to، اسم یا فعل با ing می‌آید.",
    imageFa: "کسی که مشتاق دیدن همسایه‌های تازه است.",
  },
};
function response(extra: Record<string, unknown> = {}) {
  return {
    lessonPlan: [{ concept: "look forward to", evidenceKeys: ["r0"], teachAs: "card" }],
    ...extra,
    title: "Look forward to",
    learningItems: [item],
    classNotes: { coverage: "درس دربارهٔ منتظر بودن با اشتیاق است." },
  };
}
const empty = { speechMinutes: 0, pages: 0, photos: 0, textPages: 0 };

describe("lesson-quality-1 source coverage (diagnosis 2026-10-12 §5.3)", () => {
  it("rejects a first response that silently drops a photo", () => {
    const sources = [handout(), board()];
    const prepared = buildKnowledgeGenerationInput(input(sources), 120000, {
      sourceCoverage: true,
    });
    expect(
      JSON.parse(prepared.input).sources.map((entry: { sourceKey: string }) => entry.sourceKey),
    ).toEqual(["s1", "s2"]);
    expect(prepared.system).toContain("Account for EVERY source");
    expect(() => prepared.assemble(response())).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ fields: { output: ["source_coverage_missing"] } }),
      }),
    );
  });

  it("persists cited and set-aside sources with the model's reason code", () => {
    const sources = [handout(), board(), source("text", "Unrelated synthetic notice.")];
    const prepared = buildKnowledgeGenerationInput(input(sources), 120000, {
      sourceCoverage: true,
    });
    const model = prepared.decode(
      response({
        lessonPlan: [
          { concept: "look forward to", evidenceKeys: ["r0"], teachAs: "card" },
          { concept: "board pattern", evidenceKeys: ["r1"], teachAs: "notes" },
        ],
        unusedSources: [{ source: "s3", reason: "off_topic" }],
      }),
    );
    expect(model.coverage.sources).toEqual([
      { sourceId: sources[0]?.sourceId, status: "used" },
      { sourceId: sources[1]?.sourceId, status: "used" },
      { sourceId: sources[2]?.sourceId, status: "not_used", reason: "off_topic" },
    ]);
    // A reason outside the code list is a schema failure, never free text.
    expect(() =>
      prepared.assemble(response({ unusedSources: [{ source: "s2", reason: "boring" }] })),
    ).toThrow();
  });

  it("records an unreported source only in the single bounded regeneration", () => {
    const sources = [handout(), board()];
    const prepared = buildKnowledgeGenerationInput(input(sources), 120000, {
      sourceCoverage: true,
      repairReason: "provider_schema_invalid",
      repairDetail: "assembly:source_coverage_missing",
    });
    expect(prepared.system).toContain("neither cited by a lessonPlan entry");
    expect(prepared.decode(response()).coverage.sources?.[1]).toEqual({
      sourceId: sources[1]?.sourceId,
      status: "not_used",
      reason: "not_reported",
    });
  });

  it("keeps the legacy wire, input and coverage unchanged without the setting", () => {
    const sources = [handout(), board()];
    const prepared = buildKnowledgeGenerationInput(input(sources), 120000);
    expect(Object.keys(prepared.schema.shape)).not.toContain("unusedSources");
    expect(prepared.input).not.toContain("sourceKey");
    expect(prepared.system).not.toContain("Account for EVERY source");
    expect(prepared.decode(response()).coverage).toEqual({ complete: true, missingSourceIds: [] });
  });
});

describe("lesson-quality-1 budget in the lesson prompt (diagnosis 2026-10-12 §5.2)", () => {
  it("keeps the legacy 6144 planning limits for older snapshots", () => {
    const prepared = buildKnowledgeGenerationInput(input([handout()]), 120000, {
      maxOutputTokens: 6144,
    });
    expect(prepared.system).toContain("Select at most 4 complete production items and 2 optional");
  });

  it("scales a long class to the model's own output limit without compact teaching", () => {
    const budget = lessonBudget(32000, { ...empty, speechMinutes: 128, photos: 6 });
    const prepared = buildKnowledgeGenerationInput(input([handout()]), 120000, {
      maxOutputTokens: 32000,
      budget,
    });
    expect(prepared.system).toContain("The hard response budget is 32000 output tokens");
    expect(prepared.system).toContain(
      "Select at most 18 complete production items and 6 optional recognition items",
    );
    expect(prepared.system).toContain("justifies up to 18 production items");
    expect(prepared.system).toContain("Mark at most 24 concepts as card");
  });

  it("sizes a one-photo lesson by its material", () => {
    const budget = lessonBudget(32000, { ...empty, photos: 1 });
    const prepared = buildKnowledgeGenerationInput(input([board()]), 120000, { budget });
    expect(prepared.system).toContain("The hard response budget is 32000 output tokens");
    expect(prepared.system).toContain("Select at most 6 complete production items and 2 optional");
  });
});

describe("lesson-quality-1 structured board rows", () => {
  it("passes typed blocks, reading order and uncertainty to the lesson as row metadata", () => {
    const photo = source("image", "", {
      blocks: [
        {
          id: "b1",
          unitId: "unit",
          kind: "heading",
          text: "Present perfect",
          layout: { type: "heading", order: 1 },
        },
        {
          id: "b2",
          unitId: "unit",
          kind: "paragraph",
          text: "have + past participle → result now",
          layout: { type: "relation", order: 2, uncertain: true },
        },
      ],
    });
    const prepared = buildKnowledgeGenerationInput(input([photo]), 120000);
    const rows = JSON.parse(prepared.input).sources[0].evidence;
    expect(rows[1].at(-1)).toMatchObject({
      layout: { type: "relation", order: 2, uncertain: true },
    });
    expect(prepared.system).toContain("layout metadata {type, order, uncertain}");
    const plain = buildKnowledgeGenerationInput(input([board()]), 120000);
    expect(plain.system).not.toContain("layout metadata");
  });
});

describe("D63 diagnostic 2026-10-13: a blank that also hides the object of a separable target", () => {
  // The exact card that rejected the second part of the synthetic 128-minute class.
  function separable(en: string, ipa: string, fullSentence: string, gapSentence: string) {
    const prepared = buildKnowledgeGenerationInput(input([handout()]), 120000);
    return () =>
      prepared.assemble({
        ...response(),
        learningItems: [
          {
            ...item,
            meaning: { ...item.meaning, en, faMeaning: "لطفی به کسی کردن" },
            pronunciation: { ipa, faApprox: "دو اِ فِیوِر" },
            practice: { fullSentence, gapSentence },
          },
        ],
      });
  }
  const gap = (assembled: () => { learningItems: { study?: unknown }[] }) =>
    (assembled().learningItems[0]?.study as { gapSentence?: string } | undefined)?.gapSentence;

  it("keeps the object visible between the blanks instead of rejecting the whole lesson", () => {
    expect(
      gap(
        separable(
          "do sb a favour",
          "/duː ə ˈfeɪvə/",
          "Could you please do me a favour and hold this door?",
          "Could you please ______ and hold this door?",
        ),
      ),
    ).toBe("Could you please ______ me ______ and hold this door?");
    expect(
      gap(separable("kit sth out", "/kɪt aʊt/", "We need to kit it out.", "We need to ______.")),
    ).toBe("We need to ______ it ______.");
  });

  it("still rejects a blank that hides a complement, an inflected form or a long object", () => {
    const failure = expect.objectContaining({
      details: expect.objectContaining({ fields: { output: ["study_gap_overhidden"] } }),
    });
    // A single-part target never had an object between its parts: nothing to keep visible.
    expect(
      separable(
        "look forward to + -ing / noun",
        "/lʊk ˈfɔːwəd tə/",
        "I look forward to meeting my new neighbours.",
        "I ______ my new neighbours.",
      ),
    ).toThrow(failure);
    // Only the parts as written are recognised; an inflected realisation stays rejected.
    expect(
      separable(
        "do sb a favour",
        "/duː ə ˈfeɪvə/",
        "She did me a favour and held the door.",
        "She ______ and held the door.",
      ),
    ).toThrow(failure);
    // More than three words between the parts is not an object slot.
    expect(
      separable(
        "do sb a favour",
        "/duː ə ˈfeɪvə/",
        "Please do my very kind old neighbour a favour today.",
        "Please ______ today.",
      ),
    ).toThrow(failure);
  });
});
