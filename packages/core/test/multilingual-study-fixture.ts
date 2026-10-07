import type { KnowledgeModel } from "../src/lkm/schema";

export const MULTILINGUAL_STUDY_CASES = [
  {
    language: "es",
    firstLanguage: "es",
    dir: "ltr",
    meaning: "Deterioro por el uso habitual",
    note: "Describe el deterioro normal de un objeto con el uso.",
    approximation: "uer an ter",
  },
  {
    language: "ar",
    firstLanguage: "ar",
    dir: "rtl",
    meaning: "التآكل نتيجة الاستعمال المتكرر",
    note: "تصف العبارة الضرر الطبيعي الذي يحدث مع الاستخدام.",
    approximation: "وير أند تير",
  },
  {
    language: "he",
    firstLanguage: "he",
    dir: "rtl",
    meaning: "בלאי הנגרם משימוש רגיל",
    note: "הביטוי מתאר שחיקה טבעית של חפץ בעקבות שימוש.",
    approximation: "וור אנד טאר",
  },
  {
    language: "en",
    firstLanguage: "es",
    dir: "ltr",
    meaning: "Damage caused by normal use",
    note: "Use this uncountable expression for deterioration through everyday use.",
    approximation: "wear an tear",
  },
  {
    language: "zh-Hans",
    firstLanguage: "zh-Hans",
    dir: "ltr",
    meaning: "正常使用造成的损耗",
    note: "这个表达指物品在日常使用过程中产生的自然损耗。",
    approximation: "韦尔安特尔",
  },
] as const;

/** Synthetic translations for consumer tests, never generated with a paid provider. */
export function multilingualStudyModel(
  value: (typeof MULTILINGUAL_STUDY_CASES)[number],
): KnowledgeModel {
  const claim = (id: string) => ({
    id,
    text: value.note,
    origin: "ai_expansion" as const,
    creation: "ai_generation" as const,
    evidence: "ai" as const,
    sourceRefs: [],
    speakerRole: "unknown" as const,
    uncertain: false,
  });
  return {
    schemaVersion: "1",
    title: "Everyday use and damage",
    language: { learning: "en", explanation: value.language },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    classNotes: {
      date: "2026-10-07",
      coverage: value.meaning,
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
    },
    learningItems: [
      {
        id: "wear-tear",
        kind: "expression",
        front: "wear and tear",
        back: value.meaning,
        claim: claim("wear-tear-claim"),
        study: {
          set: "production",
          en: "wear and tear",
          ipa: "/ˌweər ən ˈteə/",
          faMeaning: value.meaning,
          topic: "everyday-use",
          gapSentence: "My old shoes show considerable ______ after years of use.",
          fullSentence: "My old shoes show considerable wear and tear after years of use.",
          collocations: ["normal wear and tear"],
          noteFa: value.note,
          imageFa: value.meaning,
          sourceFa: value.note,
        },
      },
      {
        id: "normal-use",
        kind: "expression",
        front: "normal use",
        back: value.meaning,
        claim: claim("normal-use-claim"),
        study: {
          set: "recognition",
          en: "normal use",
          faMeaning: value.meaning,
          topic: "everyday-use",
          example: "The warranty covers problems that arise during normal use.",
          noteFa: value.note,
          spoken: false,
        },
      },
    ],
  };
}
