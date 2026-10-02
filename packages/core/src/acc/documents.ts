/** Texts a learner accepts, each with a version (docs/legal/consents.md). */
export const DOCUMENTS = ["terms", "privacy", "recording-consent"] as const;

export type DocumentId = (typeof DOCUMENTS)[number];

export type DocumentVersions = Readonly<Record<DocumentId, string>>;

/**
 * Current versions. A new version of a text is a code change here together with the text;
 * learners then accept it once (FR-ACC-007, D33 rule 3). documents.test.ts keeps this in step
 * with docs/legal/consents.md.
 */
export const CURRENT_VERSIONS: DocumentVersions = {
  terms: "0.1",
  privacy: "0.1",
  "recording-consent": "0.1",
};
