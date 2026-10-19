import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LegalText, ROOT, readLegalTexts } from "./build.ts";
import { checkLegalPublication, legalPublicationProblems } from "./guard.ts";

// PRD-01 (audit 2026-10-18): a production build never publishes draft legal texts by accident.
// docs/legal/README.md, "قاعده پیشنهادی": draft (0.x), unfilled placeholders or ⟨…⟩ fail it.

const final: LegalText = {
  id: "terms",
  path: "docs/legal/terms-of-use.md",
  version: "1.0",
  draft: false,
  published: "2027-03-12",
  markdown:
    "# Terms\n\nVersion 1.0 · 12 March 2027\n\nRun by {{operator_name}}: {{operator_email}}.\n",
};
const draft: LegalText = {
  ...final,
  version: "0.1",
  draft: true,
  markdown:
    "# Terms\n\nVersion 0.1 · Draft · 1 October 2026\n\n> **Draft for development only.** ⟨Before the pilot: review.⟩ {{operator_name}} {{operator_phone}}\n",
};
const operator = {
  PILOT_OPERATOR_NAME: "Synthetic Operator",
  PILOT_OPERATOR_EMAIL: "op@example.invalid",
};
const production = { VERCEL_ENV: "production", ...operator };

describe("PRD-01 legal publication guard", () => {
  it("fails a production build with a draft text and names every problem, never the text", () => {
    const result = checkLegalPublication([draft], production);
    expect(result.ok).toBe(false);
    expect(legalPublicationProblems([draft], production)).toEqual([
      "terms: draft",
      "terms: pre_release_version",
      "terms: draft_notice",
      "terms: unfinished_marker",
      "terms: unknown_placeholder",
    ]);
    expect(result.message).toContain("RECALINO_ALLOW_DRAFT_LEGAL=1");
    expect(result.message).not.toContain("Before the pilot");
  });

  it("passes a draft in production only with the explicit switch, and says so", () => {
    const result = checkLegalPublication([draft], {
      ...production,
      RECALINO_ALLOW_DRAFT_LEGAL: "1",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/draft legal texts published knowingly/);
    for (const value of ["true", "yes", "0", ""])
      expect(
        checkLegalPublication([draft], { ...production, RECALINO_ALLOW_DRAFT_LEGAL: value }).ok,
      ).toBe(false);
  });

  it("passes final texts in production when the operator is configured", () => {
    expect(checkLegalPublication([final], production)).toEqual({ ok: true, message: null });
  });

  it("fails final texts in production while the operator's name or address is missing", () => {
    expect(legalPublicationProblems([final], { VERCEL_ENV: "production" })).toEqual([
      "terms: operator_value_missing",
    ]);
  });

  it.each([{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }])(
    "does not block a build outside production (%o)",
    (env) => {
      expect(checkLegalPublication([draft], env)).toEqual({ ok: true, message: null });
    },
  );

  it("blocks today's repository texts in production (G11 is still open)", () => {
    const texts = readLegalTexts((path) => readFileSync(join(ROOT, path), "utf8"));
    expect(checkLegalPublication(texts, production).ok).toBe(false);
  });
});
