// PRD-01 (audit 2026-10-18): the first step of the web build. A production build
// (VERCEL_ENV=production) stops while a legal text is a draft (Draft label, version 0.x or the
// "Draft for development only" notice), has an unfinished ⟨…⟩ part, an unknown {{placeholder}},
// or a placeholder whose operator value is not configured. RECALINO_ALLOW_DRAFT_LEGAL=1 lets the
// owner publish them knowingly until G11 is closed (docs/legal/README.md). Messages name problem
// codes and text ids only, never the text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type LegalText, ROOT, readLegalTexts } from "./build.ts";

type Env = Record<string, string | undefined>;

/** Filled at display time from server configuration (apps/web/src/server/legal.ts). */
const OPERATOR_VALUES: Record<string, string> = {
  operator_name: "PILOT_OPERATOR_NAME",
  operator_email: "PILOT_OPERATOR_EMAIL",
};

export function legalPublicationProblems(texts: readonly LegalText[], env: Env): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    const found = new Set<string>();
    if (text.draft) found.add("draft");
    if (text.version.startsWith("0.")) found.add("pre_release_version");
    if (/Draft for development only/i.test(text.markdown)) found.add("draft_notice");
    if (/⟨[^⟩]*⟩/.test(text.markdown)) found.add("unfinished_marker");
    for (const match of text.markdown.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      const variable = OPERATOR_VALUES[match[1] ?? ""];
      if (variable === undefined) found.add("unknown_placeholder");
      else if (!env[variable]?.trim()) found.add("operator_value_missing");
    }
    for (const problem of found) problems.push(`${text.id}: ${problem}`);
  }
  return problems;
}

export function checkLegalPublication(
  texts: readonly LegalText[],
  env: Env,
): { ok: boolean; message: string | null } {
  if (env.VERCEL_ENV !== "production") return { ok: true, message: null };
  const problems = legalPublicationProblems(texts, env);
  if (problems.length === 0) return { ok: true, message: null };
  if (env.RECALINO_ALLOW_DRAFT_LEGAL === "1")
    return {
      ok: true,
      message: `PRD-01: draft legal texts published knowingly (RECALINO_ALLOW_DRAFT_LEGAL=1): ${problems.join("; ")}`,
    };
  return {
    ok: false,
    message: [
      `PRD-01: the legal texts are not ready for production: ${problems.join("; ")}.`,
      "Close G11 (docs/legal/G11_REVIEW.md), or set RECALINO_ALLOW_DRAFT_LEGAL=1 in the",
      "Vercel production environment to publish the draft texts knowingly.",
    ].join(" "),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const texts = readLegalTexts((path) => readFileSync(join(ROOT, path), "utf8"));
  const result = checkLegalPublication(texts, process.env);
  if (result.message) console[result.ok ? "warn" : "error"](result.message);
  if (!result.ok) process.exit(1);
}
