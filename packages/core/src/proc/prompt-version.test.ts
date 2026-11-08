import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunSource } from "./contracts";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
  type KnowledgeGenerationOptions,
} from "./knowledge-generation";
import type { ModelTeachingContext } from "./learner-context";
import { LESSON_BUDGET_VERSION, type LessonBudget } from "./lesson-budget";
import { studyPrompt } from "./study-prompt";

/**
 * AUD-2 F-7: the lesson prompt templates are pinned to promptVersion. Generation metadata only
 * records promptVersion, so a template change without a version bump hides which prompt produced
 * a lesson. When a template changes on purpose, bump promptVersion in
 * config/openrouter-defaults.json and update PINNED below in the same commit.
 *
 * P7-01: content and legacy pin the fixed base request; branches pin, per stack, one fixed
 * request for each conditional branch of the system prompt template, so a change to the text of
 * any branch (repair, compact, budget, handwriting, layout, marks, learner context, evidence
 * keys) also needs a promptVersion bump.
 */
const PINNED = {
  promptVersion: "recalino-knowledge-11",
  content: "ad133f436c32bf06027f30531564aeeef584a18a61091bce20791710c741d6b8",
  legacy: "6c349867a3f643a4ae2659270ba8cb27cc07b11eeabcb1d6ac1a12a63586ffd4",
  branches: {
    content: {
      "learner-beginner-compact":
        "d6e2bbce810122798ac64152aa7241a58aefcc0eaa5f2bba0be31c2c260e7e56",
      "learner-intermediate-full":
        "3b05cfdd6b6624dd173dd1e392dcd9737cf7ac383079e49a0c1356b451b9ad8c",
      "learner-advanced": "ce9d1eab25c6c63cb4bee3900314a6b2c27bd924a0b6b083a5d4ea2af90d6190",
      "full-teaching": "63ffc5500e6db1e5214d3244d23dbd2ef98e6cf27d32b6b414f890935d4e184d",
      "shorter-examples": "b2cc3dcb5d87795cb0153b45e8e6999e071c9ebc07775729e74dc273420fc216",
      handwriting: "4c41e033a3edc7e39f33150163bf86a7cae45b907a8725bc0cb1430d4e744528",
      "budget-full": "5052a429974ae6a15df3242f96fe249f4281c7981c25833efd3ef3e4dbaf7383",
      "budget-full-marked": "929ea8e6e8cd70d0c64dee979b076f2696bfac5f53d3bf9564e7925b6b4147be",
      "budget-compact": "ee8b7d5a88b0254dfde61075caee6bad7b6d4b372a728716b3804eb120efdc3c",
      "budget-full-compact-lesson":
        "46a93f8639c2f42baec9797b43acff5b1c3ee85469c87eb2899c9a548b86c6a7",
      "compact-lesson": "8d38c58de65edeac664414962ba769ca9e17ea68237a3a57c969fa93a60d1c22",
      "source-coverage": "48d31722d108e8dd202e0ebd3926eecd7e68c97fb60e9d7d8d0f5af35f6f0b7e",
      layout: "f14431c7d1b311d1e50bc4595603626d1c961c9d01cef617e36121c24f04ef2e",
      "layout-marks": "4cc3b5037efd536af39c8a59fc884edf66ad4b7825c5ece182697fed8b8e0fcf",
      "repair-reasons": "5ed61a6b3072ce65c94cd411868248d0574c81a11a9e18072bba9f9baf220d9b",
      "repair-language": "e095de412092460c8d79313a45478ec2bef694dc563b20c39b549d3aa2f927da",
      "repair-detail-json-parse":
        "2a2263eb9c44e03160a4be689a1248aa8f0a3b2beb14e485812621e5f4184bba",
      "repair-detail-assembly": "5c43a1e527293953d4b4141bd47b796268d9eed0a40629937b99cf5f52157594",
      "repair-detail-zod": "ae483443e54eb32b243d9ca1dc8b7487db4b48c511aa81bc099ec407a356b721",
    },
    legacy: {
      "evidence-keys-off": "85fa742f0dc46838b31820cfeee31b31591e5e390f9e0322227e3c73c886ac8b",
      "full-budget": "1808cdf167c16872841f7f558b734171146be2c25e85be762151f6a65110f7ad",
      "maximum-budget": "eb6111a74af46a2a7412bb71ba470baf35bb5f72cb6219b8153c6f2b2c858d89",
      "other-language-compact": "4b8a3a83dcc5b79159d9c060e5bd1314a79b3fb3e1416eaa7b5cd2f5e0e6522c",
      "learner-beginner-compact":
        "818c2e3c18c3854d18f791e282667f9002066ff3ef55495bdefc33ef3feb5366",
      "learner-intermediate-full":
        "b238621d7757e0b183cf8474502dcc9e45d8b5ef059b22c3819b082084aa07b0",
      "learner-advanced": "bd981ce7cda03e02fdb7c8ff553a55c3eab9e01c566e6ac48060add64a4d7b35",
    },
  },
} as const;

const BUMP =
  "the lesson prompt template changed: bump promptVersion in config/openrouter-defaults.json and update PINNED in packages/core/src/proc/prompt-version.test.ts";

/** Fixed request shape: no learner context, no preferences, no repair, no layout, no handwriting. */
const OUTPUT_TOKENS = 6144;
const LANGUAGES = ["fa", "en"] as const;

function configuredPromptVersion(): string {
  const path = fileURLToPath(
    new URL("../../../../config/openrouter-defaults.json", import.meta.url),
  );
  const defaults: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof defaults !== "object" || defaults === null || !("promptVersion" in defaults)) {
    throw new Error("config/openrouter-defaults.json has no promptVersion");
  }
  const { promptVersion } = defaults;
  if (typeof promptVersion !== "string") throw new Error("promptVersion is not a string");
  return promptVersion;
}

/** A constant placeholder source: the content system prompt must not depend on its text or ids. */
function placeholderSource(seed: string, text: string): RunSource {
  return {
    sourceId: `00000000-0000-4000-8000-00000000000${seed}`,
    contentVersionId: `00000000-0000-4000-8000-00000000001${seed}`,
    objectId: `00000000-0000-4000-8000-00000000002${seed}`,
    sha256: seed.repeat(64),
    kind: "text",
    mimeType: "text/plain",
    role: "class_material",
    durationMs: null,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: [{ id: "unit", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "block", unitId: "unit", kind: "paragraph", text }],
  };
}

function placeholderInput(
  explanationLanguage: string,
  source: RunSource = placeholderSource("a", "Qzxv fixture sentence."),
): KnowledgeGenerationInput {
  return {
    sources: [source],
    explanationLanguage,
    missingSourceIds: [],
    teachingPreferences: { shorterExamples: false },
    lessonContext: { date: "2000-01-01" },
  };
}

function contentSystem(explanationLanguage: string, source?: RunSource): string {
  return buildKnowledgeGenerationInput(placeholderInput(explanationLanguage, source), 120000, {
    maxOutputTokens: OUTPUT_TOKENS,
  }).system;
}

function legacySystem(explanationLanguage: string): string {
  return studyPrompt(explanationLanguage, OUTPUT_TOKENS, true, undefined);
}

function templateHash(
  render: (language: string) => string,
  languages: readonly string[] = LANGUAGES,
): string {
  const templates = languages.map((language) => [language, render(language)]);
  return createHash("sha256").update(JSON.stringify(templates), "utf8").digest("hex");
}

/** A fixed text never allowed into a system prompt: source text and learner practice targets. */
const LEAK = "Qzxv";

/** Constant learner fixtures; together they reach every level, goal and adaptation branch. */
const LEARNERS = {
  beginner: {
    version: 2,
    declaredLevel: "A1",
    goal: "esol",
    simplerExplanations: true,
    practiceFocus: [{ target: `${LEAK} focus target`, reason: "recall_difficulty" }],
  },
  intermediate: {
    version: 2,
    declaredLevel: "B2",
    goal: "ielts",
    simplerExplanations: true,
    practiceFocus: [{ target: `${LEAK} focus target`, reason: "asked_simpler" }],
  },
  advanced: { version: 1, declaredLevel: "C1", goal: "general" },
} as const satisfies Record<string, ModelTeachingContext>;

/** Output tokens with ten production items: the non-compact teaching branch. */
const FULL_OUTPUT_TOKENS = 12800;
/** Output tokens with eighteen production items: the legacy normal-selection branch. */
const MAXIMUM_OUTPUT_TOKENS = 23040;

/** A constant content-scaled budget; only compact and markedSpans vary between branches. */
function fixedBudget(compact: boolean, markedSpans?: number): LessonBudget {
  return {
    version: LESSON_BUDGET_VERSION,
    outputTokens: 32000,
    aimTokens: 24000,
    production: 12,
    recognition: 4,
    supplementaryClaims: 4,
    compact,
    contentProduction: 12,
    content: {
      speechMinutes: 0,
      pages: 0,
      photos: 1,
      textPages: 1,
      ...(markedSpans === undefined ? {} : { markedSpans }),
    },
  };
}

type BlockLayout = NonNullable<RunSource["blocks"][number]["layout"]>;

/** A constant photo source; layout and role reach the layout, marks and handwriting branches. */
function photoSource(role: "class_material" | "user_notes", layout?: BlockLayout): RunSource {
  const source = placeholderSource("c", `${LEAK} marked fixture sentence.`);
  return {
    ...source,
    kind: "image",
    mimeType: "image/jpeg",
    role,
    blocks: source.blocks.map((block) => ({ ...block, ...(layout ? { layout } : {}) })),
  };
}

interface ContentBranch {
  options?: KnowledgeGenerationOptions;
  learnerContext?: ModelTeachingContext;
  shorterExamples?: boolean;
  source?: RunSource;
  confirmedHandwritingKeys?: readonly string[];
}

function contentBranch(explanationLanguage: string, branch: ContentBranch): string {
  const input: KnowledgeGenerationInput = {
    ...placeholderInput(explanationLanguage, branch.source),
    teachingPreferences: { shorterExamples: branch.shorterExamples === true },
    ...(branch.learnerContext ? { learnerContext: branch.learnerContext } : {}),
    ...(branch.confirmedHandwritingKeys
      ? { confirmedHandwritingKeys: branch.confirmedHandwritingKeys }
      : {}),
  };
  return buildKnowledgeGenerationInput(
    input,
    120000,
    branch.options ?? { maxOutputTokens: OUTPUT_TOKENS },
  ).system;
}

/** Every code-owned repair reason with fixed guidance, plus one without guidance. */
const REPAIR_REASONS = [
  "provider_schema_invalid",
  "json_parse",
  "study_target_unsupported",
  "study_answer_label",
  "study_ipa_headword_invalid",
  "study_prompt_reveals_answer",
  "study_gap_missing",
  "study_gap_hint",
  "study_gap_invalid",
  "study_gap_partial",
  "study_gap_overhidden",
  "study_ipa_chunk_invalid",
  "source_coverage_missing",
  "study_plan_uncovered",
  "study_sentence_mismatch",
  "study_answer_exposed",
  "study_approximation_missing",
  "study_approximation_unsupported",
  "study_grammar_prompt_missing",
  "language_script_mismatch",
  "source_reference_invalid",
  "class_evidence_missing",
  "evidence_kind_mismatch",
  "generation_section_missing",
  "generation_section_mismatch",
  "generation_item_kind_invalid",
  "board_evidence_invalid",
  "learner_authorship_unconfirmed",
  "study_mistake_item_missing",
  "unlisted_reason",
] as const;

/** One schema issue detail as `zod:<code>@<path>`, joined with `;`. */
function zodDetail(issues: readonly (readonly [code: string, path: string])[]): string {
  return issues.map(([code, path]) => `zod:${code}@${path}`).join(";");
}

/** Every schema issue meaning, plus an unknown code and a root path, at most three per detail. */
const ZOD_DETAILS = [
  zodDetail([
    ["too_small", "learningItems.0"],
    ["too_big", "summary"],
    ["invalid_type", ""],
  ]),
  zodDetail([
    ["unrecognized_keys", "classNotes"],
    ["invalid_value", "learningItems.0.type"],
    ["invalid_format", "learningItems.0.pronunciation.faApprox"],
  ]),
  zodDetail([
    ["invalid_union", "learningItems.1"],
    ["custom", "topics"],
  ]),
] as const;

function repair(repairReason: string, repairDetail?: string): KnowledgeGenerationOptions {
  return {
    maxOutputTokens: OUTPUT_TOKENS,
    repairReason,
    ...(repairDetail === undefined ? {} : { repairDetail }),
  };
}

/** Several requests of one branch family, hashed together as one rendered template. */
function family(explanationLanguage: string, branches: readonly ContentBranch[]): string {
  return JSON.stringify(branches.map((branch) => contentBranch(explanationLanguage, branch)));
}

const CONTENT_BRANCHES: Record<keyof typeof PINNED.branches.content, ContentBranch | Render> = {
  "learner-beginner-compact": { learnerContext: LEARNERS.beginner },
  "learner-intermediate-full": {
    learnerContext: LEARNERS.intermediate,
    options: { maxOutputTokens: FULL_OUTPUT_TOKENS },
  },
  "learner-advanced": { learnerContext: LEARNERS.advanced },
  "full-teaching": { options: { maxOutputTokens: FULL_OUTPUT_TOKENS } },
  "shorter-examples": { shorterExamples: true },
  handwriting: { source: photoSource("user_notes"), confirmedHandwritingKeys: ["r0"] },
  "budget-full": { options: { budget: fixedBudget(false) } },
  "budget-full-marked": { options: { budget: fixedBudget(false, 2) } },
  "budget-compact": { options: { budget: fixedBudget(true) } },
  "budget-full-compact-lesson": { options: { budget: fixedBudget(false), compact: true } },
  "compact-lesson": { options: { maxOutputTokens: OUTPUT_TOKENS, compact: true } },
  "source-coverage": { options: { maxOutputTokens: OUTPUT_TOKENS, sourceCoverage: true } },
  layout: { source: photoSource("class_material", { type: "heading", order: 1 }) },
  "layout-marks": {
    source: photoSource("class_material", {
      type: "example",
      order: 1,
      uncertain: true,
      marks: [{ style: "highlight", text: `${LEAK} marked` }],
    }),
  },
  "repair-reasons": (language) =>
    family(
      language,
      REPAIR_REASONS.map((reason) => ({ options: repair(reason) })),
    ),
  "repair-language": { options: repair("language_script_mismatch") },
  "repair-detail-json-parse": { options: repair("provider_schema_invalid", "json_parse") },
  "repair-detail-assembly": (language) =>
    family(language, [
      { options: repair("provider_schema_invalid", "assembly:study_gap_missing") },
      { options: repair("provider_schema_invalid", "assembly:language_script_mismatch") },
    ]),
  "repair-detail-zod": (language) =>
    family(
      language,
      ZOD_DETAILS.map((detail) => ({ options: repair("provider_schema_invalid", detail) })),
    ),
};

type Render = (language: string) => string;

function contentRender(branch: ContentBranch | Render): Render {
  return typeof branch === "function" ? branch : (language) => contentBranch(language, branch);
}

interface LegacyBranch {
  languages?: readonly string[];
  maxOutputTokens?: number;
  usesEvidenceKeys?: boolean;
  learnerContext?: ModelTeachingContext;
}

const LEGACY_BRANCHES: Record<keyof typeof PINNED.branches.legacy, LegacyBranch> = {
  "evidence-keys-off": { usesEvidenceKeys: false },
  "full-budget": { maxOutputTokens: FULL_OUTPUT_TOKENS },
  "maximum-budget": { maxOutputTokens: MAXIMUM_OUTPUT_TOKENS },
  // Neither Persian nor English: the translated compact caveat.
  "other-language-compact": { languages: ["ar", "en-GB"] },
  "learner-beginner-compact": { learnerContext: LEARNERS.beginner },
  "learner-intermediate-full": {
    learnerContext: LEARNERS.intermediate,
    maxOutputTokens: FULL_OUTPUT_TOKENS,
  },
  "learner-advanced": { learnerContext: LEARNERS.advanced },
};

function legacyRender(branch: LegacyBranch): Render {
  return (language) =>
    studyPrompt(
      language,
      branch.maxOutputTokens ?? OUTPUT_TOKENS,
      branch.usesEvidenceKeys ?? true,
      branch.learnerContext,
    );
}

/** Every pinned branch of both stacks with its rendered languages. */
const BRANCHES = [
  ...Object.entries(CONTENT_BRANCHES).map(([name, branch]) => ({
    stack: "content" as const,
    file: "knowledge-generation.ts",
    name: name as keyof typeof PINNED.branches.content,
    render: contentRender(branch),
    languages: LANGUAGES as readonly string[],
  })),
  ...Object.entries(LEGACY_BRANCHES).map(([name, branch]) => ({
    stack: "legacy" as const,
    file: "study-prompt.ts",
    name: name as keyof typeof PINNED.branches.legacy,
    render: legacyRender(branch),
    languages: branch.languages ?? (LANGUAGES as readonly string[]),
  })),
];

function pinnedBranch(branch: (typeof BRANCHES)[number]): string {
  return branch.stack === "content"
    ? PINNED.branches.content[branch.name as keyof typeof PINNED.branches.content]
    : PINNED.branches.legacy[branch.name as keyof typeof PINNED.branches.legacy];
}

describe("AUD-2 F-7 lesson prompt templates are pinned to promptVersion", () => {
  it("builds each template without learner input, source data or time", () => {
    const other = placeholderSource(
      "b",
      "A different class sentence that must never reach the system prompt.",
    );
    for (const language of LANGUAGES) {
      const system = contentSystem(language);
      expect(contentSystem(language, other)).toBe(system);
      expect(system).not.toContain("Qzxv");
      expect(system).not.toContain("never reach the system prompt");
      expect(system).not.toContain("2000-01-01");
      expect(legacySystem(language)).toBe(legacySystem(language));
    }
    expect(templateHash(contentSystem)).toBe(templateHash(contentSystem));
    expect(templateHash(legacySystem)).toBe(templateHash(legacySystem));
  });

  it("changes a template only together with promptVersion", () => {
    expect(
      configuredPromptVersion(),
      "promptVersion changed: recompute the template hashes and update PINNED in packages/core/src/proc/prompt-version.test.ts",
    ).toBe(PINNED.promptVersion);
    expect(templateHash(contentSystem), `content stack (knowledge-generation.ts): ${BUMP}`).toBe(
      PINNED.content,
    );
    expect(templateHash(legacySystem), `legacy stack (study-prompt.ts): ${BUMP}`).toBe(
      PINNED.legacy,
    );
  });
});

describe("P7-01 each conditional branch of the lesson prompt templates is pinned to promptVersion", () => {
  it("builds each branch without learner input, source data or time, and reaches the branch", () => {
    const base = new Set<string>([PINNED.content, PINNED.legacy]);
    const seen = new Set<string>();
    for (const branch of BRANCHES) {
      const hash = templateHash(branch.render, branch.languages);
      expect(templateHash(branch.render, branch.languages), `${branch.name}: deterministic`).toBe(
        hash,
      );
      // A branch request that renders the base template (or another branch) pins nothing new.
      expect(base.has(hash), `${branch.stack} ${branch.name}: renders the base template`).toBe(
        false,
      );
      expect(seen.has(hash), `${branch.stack} ${branch.name}: duplicates another branch`).toBe(
        false,
      );
      seen.add(hash);
      for (const language of branch.languages) {
        const system = branch.render(language);
        expect(system).not.toContain(LEAK);
        expect(system).not.toContain("2000-01-01");
      }
    }
  });

  it.each(BRANCHES.map((branch) => [`${branch.stack} ${branch.name}`, branch] as const))(
    "changes the %s branch only together with promptVersion",
    (_label, branch) => {
      expect(
        configuredPromptVersion(),
        "promptVersion changed: recompute the template hashes and update PINNED in packages/core/src/proc/prompt-version.test.ts",
      ).toBe(PINNED.promptVersion);
      expect(
        templateHash(branch.render, branch.languages),
        `${branch.stack} stack (${branch.file}), branch ${branch.name}: ${BUMP}`,
      ).toBe(pinnedBranch(branch));
    },
  );
});
