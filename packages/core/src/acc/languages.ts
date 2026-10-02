import data from "./languages.json" with { type: "json" };

/** Codes a learner can choose as first language (D31, rule 2). */
export const FIRST_LANGUAGES: readonly string[] = data.codes;

const known = new Set(FIRST_LANGUAGES);

export function isFirstLanguage(code: string): boolean {
  return known.has(code);
}

/** D31, rule 3: "verified" after the language quality check (G05), otherwise "experimental". */
export type LanguageTier = "verified" | "experimental";

export function languageTier(code: string, verified: readonly string[]): LanguageTier {
  return verified.includes(code) ? "verified" : "experimental";
}
