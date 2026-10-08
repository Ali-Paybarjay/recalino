import {
  type EvidenceSource,
  type KnowledgeModel,
  modelClaims,
  validateKnowledgeModel,
} from "../lkm";

export interface StructuralQualityReport {
  schemaVersion: string;
  structuralValid: true;
  referencesValidated: true;
  explanationLanguage: string;
  claims: number;
  classClaims: number;
  aiExpansions: number;
  uncertainClaims: number;
  learningItems: number;
  completeCoverage: boolean;
  humanReview: "required";
  educationalAccuracy: null;
}
/** Deterministic checks cannot certify educational truth, speaker accuracy or meaning in context. */
export function structuralQualityReport(
  raw: KnowledgeModel,
  sources: readonly EvidenceSource[],
  explanationLanguage: string,
): StructuralQualityReport {
  const model = validateKnowledgeModel(raw, sources, explanationLanguage);
  const claims = modelClaims(model);
  return {
    schemaVersion: model.schemaVersion,
    structuralValid: true,
    referencesValidated: true,
    explanationLanguage,
    claims: claims.length,
    classClaims: claims.filter((claim) => claim.origin === "from_class").length,
    aiExpansions: claims.filter((claim) => claim.origin === "ai_expansion").length,
    uncertainClaims: claims.filter((claim) => claim.uncertain).length,
    learningItems: model.learningItems.length,
    completeCoverage: model.coverage.complete,
    humanReview: "required",
    educationalAccuracy: null,
  };
}
/** Versioned representative scenarios from PRD24.1. Descriptions are a corpus plan, not passing scores. */
export const evaluationCorpus = [
  ["text-grammar-01", "en", "text", "present-perfect"],
  ["text-vocabulary-02", "en", "text", "contextual-meaning"],
  ["text-contradiction-03", "en", "text", "contradictions"],
  ["text-injection-04", "en", "text", "untrusted-instructions"],
  ["text-long-05", "en", "text", "selected-content-bound"],
  ["html-passive-06", "en", "html", "scripts-and-network"],
  ["pdf-digital-07", "en", "pdf", "typed-source-references"],
  ["pdf-scan-08", "en", "pdf", "selected-page-ocr"],
  ["pdf-password-09", "en", "pdf", "request-local-secret"],
  ["pdf-blank-10", "en", "pdf", "honest-missing-coverage"],
  ["photo-board-11", "en", "image", "board-evidence"],
  ["photo-blur-12", "en", "image", "unreadable-regions"],
  ["photo-paused-13", "en", "image", "capture-without-audio-span"],
  ["photo-offset-14", "en", "image", "estimated-time"],
  ["audio-clean-15", "en", "audio", "native-timing"],
  ["audio-noise-16", "en", "audio", "uncertainty"],
  ["audio-speakers-17", "en", "audio", "unknown-speaker-role"],
  ["audio-long-18", "en", "audio", "durable-selected-chunks"],
  ["bilingual-persian-19", "fa", "audio", "persian-english"],
  ["explanation-persian-20", "fa", "text", "rtl-explanation"],
].map(([id, language, inputKind, tag]) => ({
  id,
  corpusVersion: "synthetic-plan-1",
  language,
  inputKind,
  tag,
  humanReview: "required" as const,
  result: null,
}));
