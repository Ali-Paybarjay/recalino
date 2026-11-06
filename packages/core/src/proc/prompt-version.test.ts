import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunSource } from "./contracts";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
} from "./knowledge-generation";
import { studyPrompt } from "./study-prompt";

/**
 * AUD-2 F-7: the lesson prompt templates are pinned to promptVersion. Generation metadata only
 * records promptVersion, so a template change without a version bump hides which prompt produced
 * a lesson. When a template changes on purpose, bump promptVersion in
 * config/openrouter-defaults.json and update PINNED below in the same commit.
 */
const PINNED = {
  promptVersion: "recalino-knowledge-11",
  content: "ad133f436c32bf06027f30531564aeeef584a18a61091bce20791710c741d6b8",
  legacy: "6c349867a3f643a4ae2659270ba8cb27cc07b11eeabcb1d6ac1a12a63586ffd4",
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

function templateHash(render: (language: string) => string): string {
  const templates = LANGUAGES.map((language) => [language, render(language)]);
  return createHash("sha256").update(JSON.stringify(templates), "utf8").digest("hex");
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
