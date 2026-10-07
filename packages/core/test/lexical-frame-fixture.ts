import type { KnowledgeModel } from "../src/lkm";

/** Synthetic dictionary-frame regression; never submitted to a live provider. */
export function lexicalFrameModel({
  en = "look forward to + -ing / noun",
  gapSentence = "I ______ meeting my new neighbours.",
  fullSentence = "I look forward to meeting my new neighbours.",
}: {
  en?: string;
  gapSentence?: string;
  fullSentence?: string;
} = {}): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Synthetic future plans",
    language: { learning: "en", explanation: "en" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      {
        id: "future-plans",
        kind: "expression",
        front: "Feel happy about a future plan.",
        back: en,
        claim: {
          id: "future-plans-claim",
          text: "A future plan.",
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
          topic: "future-plans",
          ipa: "/lʊk ˈfɔːwəd tə/",
          faMeaning: "Feel happy about a future plan.",
          gapSentence,
          fullSentence,
          collocations: [],
          noteFa: "The preposition to is followed by a noun or an -ing form.",
          imageFa: "Imagine an upcoming visit.",
          sourceFa: "Synthetic example.",
        },
      },
    ],
  };
}
