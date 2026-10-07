import { describe, expect, it } from "vitest";
import { assignGeneratedKnowledgeIds } from "../packages/core/src/lkm/generated-identities";
import {
  type KnowledgeModel,
  knowledgeModelSchema,
  validateKnowledgeModel,
} from "../packages/core/src/lkm/schema";
import { normalizeGeneratedStudyModel } from "../packages/core/src/lkm/study-policy";
import type { ProductionStudyContent } from "../packages/core/src/lkm/study-schema";
import { applyNotebookEdits, notebookEditsSchema } from "../packages/core/src/note/schema";
import { buildKnowledgeTranslationInput } from "../packages/core/src/proc/knowledge-translation";
import { studyPrompt } from "../packages/core/src/proc/study-prompt";
import { referenceStudyModel } from "../packages/core/test/reference-study-fixture";

const study: ProductionStudyContent = {
  set: "production",
  en: "wear and tear",
  ipa: "/ˌweər ən ˈteə/",
  faApprox: "وِئِر اِن تِئِ",
  faMeaning: "ساییدگی و فرسودگی ناشی از استفاده",
  topic: "binomials",
  gapSentence: "My old bike is showing signs of ______ after years of use.",
  fullSentence: "My old bike is showing signs of wear and tear after years of use.",
  collocations: ["normal wear and tear", "show signs of wear and tear"],
  noteFa: "این عبارت غیرقابل‌شمارش است.",
  imageFa: "دوچرخه‌ای با لاستیک‌های ساییده.",
  sourceFa: "نمونه‌ی آموزشی",
};
function fixture(): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Binomials",
    language: { learning: "en", explanation: "fa" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      {
        id: "wear-tear",
        kind: "expression",
        front: study.en,
        back: study.faMeaning,
        study: { ...study },
        claim: {
          id: "claim-one",
          text: "این عبارت درباره‌ی فرسودگی است.",
          origin: "ai_expansion",
          creation: "ai_generation",
          evidence: "ai",
          sourceRefs: [],
          speakerRole: "unknown",
          uncertain: false,
        },
      },
    ],
    classNotes: {
      date: "2026-10-05",
      coverage: "Binomials",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
      mistakes: {
        speechStatus: "verified",
        patterns: [
          {
            labelFa: "حرف اضافه",
            count: 2,
            examples: ["private spoken words"],
            ruleFa: "از حرف اضافه‌ی درست استفاده کن.",
          },
        ],
        items: [
          {
            source: "speech",
            said: "private spoken words",
            correct: "correct words",
            whyFa: "دلیل اصلاح",
            kind: "grammar",
            teacherCorrected: true,
            itemId: "wear-tear",
          },
          {
            source: "handwriting",
            said: "a wear and tear",
            correct: "wear and tear",
            whyFa: "غیرقابل‌شمارش است.",
            kind: "grammar",
            teacherCorrected: true,
            itemId: "wear-tear",
          },
        ],
      },
    },
  };
}

describe("shared structured lesson model", () => {
  it("accepts the supplied reference's grammar formula without translating its notation", () => {
    const reference = referenceStudyModel();
    expect(() => validateKnowledgeModel(reference, [], "fa")).not.toThrow();
    const translation = buildKnowledgeTranslationInput(
      validateKnowledgeModel(reference, [], "fa"),
      "fa",
      100000,
    );
    expect(JSON.parse(translation.input).targets).toEqual([]);
  });
  it("keeps old schemaVersion 1 lessons readable without manufacturing rich fields", () => {
    const model = fixture();
    delete model.classNotes;
    delete model.learningItems[0]?.study;
    expect(knowledgeModelSchema.parse(model)).toEqual(model);
    expect(validateKnowledgeModel(model, [], "fa")).toEqual(model);
  });

  it("never trusts generated voice verification or speech-derived aggregates", () => {
    const output = validateKnowledgeModel(fixture(), [], "fa");
    expect(output.classNotes?.mistakes?.speechStatus).toBe("no_audio");
    expect(output.classNotes?.mistakes?.patterns).toEqual([]);
    expect(output.classNotes?.mistakes?.items.map((item) => item.source)).toEqual(["handwriting"]);
    expect(JSON.stringify(output)).not.toContain("private spoken words");
    expect(fixture().classNotes?.mistakes?.speechStatus).toBe("verified");
  });

  it("uses server metadata and maintains plain projections from the shared study item", () => {
    const input = fixture();
    if (input.classNotes) input.classNotes.institution = "Provider guess";
    const first = input.learningItems[0];
    if (first) first.front = "Different provider copy";
    const output = normalizeGeneratedStudyModel(input, true, {
      date: "2026-10-06",
      course: "ESOL",
    });
    expect(output.classNotes).toMatchObject({ date: "2026-10-06", course: "ESOL" });
    expect(output.classNotes?.institution).toBeUndefined();
    expect(output.classNotes?.mistakes?.speechStatus).toBe("unverified");
    expect(output.learningItems[0]?.front).toBe(study.en);
    expect(output.learningItems[0]?.back).toBe(study.faMeaning);
  });

  it("derives repeated written patterns without carrying hidden spoken examples into them", () => {
    const input = fixture();
    input.classNotes?.mistakes?.items.push({
      source: "handwriting",
      said: "many wear and tears",
      correct: "much wear and tear",
      whyFa: "غیرقابل‌شمارش است.",
      kind: "grammar",
      teacherCorrected: false,
    });
    const output = normalizeGeneratedStudyModel(input, true);
    expect(output.classNotes?.mistakes?.patterns).toEqual([
      {
        labelFa: "گرامر",
        count: 2,
        examples: ["a wear and tear → wear and tear", "many wear and tears → much wear and tear"],
        ruleFa: "غیرقابل‌شمارش است.",
      },
    ]);
    expect(JSON.stringify(output)).not.toContain("private spoken words");
  });

  it("remaps mistake links to the canonical item identity without changing shared fields", () => {
    const output = assignGeneratedKnowledgeIds(fixture());
    expect(output.learningItems[0]?.id).not.toBe("wear-tear");
    expect(
      output.classNotes?.mistakes?.items.every(
        (mistake) => mistake.itemId === output.learningItems[0]?.id,
      ),
    ).toBe(true);
    expect(output.learningItems[0]?.study).toEqual(study);
    expect(assignGeneratedKnowledgeIds(output).learningItems[0]?.id).toBe(
      output.learningItems[0]?.id,
    );
  });

  it("rejects incomplete production tasks and more than eighteen core items", () => {
    const missingGap = fixture();
    const first = missingGap.learningItems[0];
    if (first?.study?.set === "production") first.study.gapSentence = "No blank here";
    expect(() => validateKnowledgeModel(missingGap, [], "fa")).toThrow();
    const grammar = fixture();
    const grammarStudy = grammar.learningItems[0]?.study;
    if (grammarStudy) grammarStudy.kind = "grammar";
    expect(() => validateKnowledgeModel(grammar, [], "fa")).toThrow();
    const excessive = fixture();
    const template = excessive.learningItems[0];
    if (!template) throw new Error("Missing fixture");
    excessive.learningItems = Array.from({ length: 19 }, (_, index) => ({
      ...template,
      id: `i${index}`,
      claim: { ...template.claim, id: `c${index}` },
    }));
    delete excessive.classNotes?.mistakes;
    expect(() => validateKnowledgeModel(excessive, [], "fa")).toThrow();
  });

  it.each([
    { gapSentence: "I use wear and tear ______.", fullSentence: "I use wear and tear every day." },
    { gapSentence: "My old bike is showing signs of w______ after years of use." },
    { gapSentence: "An unrelated sentence with ______." },
    { faMeaning: "فرسودگی یعنی wear and tear" },
    { kind: "grammar" as const, taskFa: "جمله را بازنویسی کن.", prompt: study.fullSentence },
  ])("rejects malformed or answer-revealing production fronts %#", (changes) => {
    const model = fixture();
    const item = model.learningItems[0];
    if (item?.study?.set !== "production") throw new Error("Missing fixture");
    item.study = { ...item.study, ...changes };
    expect(() => validateKnowledgeModel(model, [], "fa")).toThrow();
  });

  it("keeps a learner's plain edit visible by discarding stale structured sentences", () => {
    const original = fixture();
    const edited = applyNotebookEdits(
      original,
      notebookEditsSchema.parse({
        items: { "wear-tear": { front: "Changed target", back: "معنی ویرایش‌شده" } },
      }),
    );
    expect(edited.learningItems[0]?.front).toBe("Changed target");
    expect(edited.learningItems[0]?.study).toBeUndefined();
    expect(original.learningItems[0]?.study).toEqual(study);
    expect(edited.learningItems[0]?.claim.creation).toBe("user_edit");
  });

  it("repairs only rich Persian prose while preserving examples, IPA, identity and metadata", () => {
    const input = fixture();
    const first = input.learningItems[0];
    if (!first?.study) throw new Error("Missing fixture");
    first.study.noteFa = "Use this uncountable expression.";
    if (input.classNotes) input.classNotes.coreIntro = "A paired expression.";
    const translation = buildKnowledgeTranslationInput(input, "fa", 100000);
    const targets = JSON.parse(translation.input).targets as { key: string; section: string }[];
    expect(targets).toHaveLength(2);
    expect(targets.every((target) => target.section === "study")).toBe(true);
    const output = translation.apply({
      language: "fa",
      translations: targets.map((target) => ({ key: target.key, text: "توضیح فارسی درست." })),
    });
    expect(output.learningItems[0]?.study).toMatchObject({
      en: study.en,
      ipa: study.ipa,
      fullSentence: study.fullSentence,
      noteFa: "توضیح فارسی درست.",
    });
    expect(output.classNotes?.coreIntro).toBe("توضیح فارسی درست.");
    expect(output.learningItems[0]?.claim).toEqual(first.claim);
    expect(first.study.noteFa).toBe("Use this uncountable expression.");
  });

  it("instructs generation to share items, suppress unverified speech and disclose budget limits", () => {
    const prompt = studyPrompt("fa", 6144);
    expect(prompt).toContain("Persian (Farsi)");
    expect(prompt).toContain("each claim.text explains in the resolved explanation language");
    expect(prompt).toContain("one shared source");
    expect(prompt).toContain("10–18 production items");
    expect(prompt).toContain("NO verified learner voice");
    expect(prompt).toContain("hard limit of 6144 output tokens");
    expect(prompt).toContain("classNotes.sourceNote");
    expect(prompt).toContain("never separate copies");
  });
});
