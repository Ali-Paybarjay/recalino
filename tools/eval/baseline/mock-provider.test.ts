import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OpenRouterProvider,
  ProviderError,
  providerSettingsSchema,
} from "../../../packages/core/src/aip";
import { providerHttpErrorCode } from "../../../packages/core/src/aip/provider-http-error";
import { generatedKnowledgeSchema } from "../../../packages/core/src/proc/generated-knowledge";
import { buildKnowledgeGenerationInput } from "../../../packages/core/src/proc/knowledge-generation";
import { generateCanonicalKnowledge } from "../../../packages/core/src/proc/knowledge-generation-step";
import { validateGeneratedKnowledge } from "../../../packages/core/src/proc/worker";
import { expectedGenerationData } from "./baseline-fixtures";
import {
  grammarRejectionResponse,
  providerDeadline,
  syntheticContentLesson,
  syntheticLessonResponse,
} from "./mock-provider";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";

const fixtures = holdout5MigrationFixtures();
const settings = providerSettingsSchema.parse(
  JSON.parse(
    readFileSync(new URL("../../../config/openrouter-defaults.json", import.meta.url), "utf8"),
  ),
);
const operationKey = "11111111-1111-4111-8111-111111111111:knowledge:1";

describe("code-written content-contract lesson", () => {
  it("passes the release's own schema, assembly and lesson validation for every lesson", () => {
    for (const fixture of fixtures) {
      const data = expectedGenerationData(fixture);
      const generation = buildKnowledgeGenerationInput(data, settings.maxInputCharacters, {
        maxOutputTokens: settings.maxOutputTokens,
      });
      const lesson = syntheticContentLesson(generation.input);
      const generated = generatedKnowledgeSchema.parse(
        generation.assemble(generation.schema.parse(lesson)),
      );
      const { model } = validateGeneratedKnowledge(
        generated,
        data.sources,
        [...data.missingSourceIds],
        data.explanationLanguage,
      );
      expect(model.language.explanation).toBe(fixture.explanationLanguage);
      expect(model.learningItems).toHaveLength(1);
      // The example is a sentence copied from a class row, cited by that row's key.
      const example = lesson.learningItems[0]?.practice.example ?? "";
      expect(
        fixture.sources.some((source) =>
          source.blocks.some((block) => block.text.includes(example)),
        ),
      ).toBe(true);
      expect(model.learningItems[0]?.claim.origin).toBe("from_class");
    }
  });

  it("refuses a language it has no explanation for, and any other input", () => {
    const fixture = fixtures[0];
    if (!fixture) throw new Error("missing fixture");
    const input = JSON.parse(
      buildKnowledgeGenerationInput(expectedGenerationData(fixture), 120000).input,
    );
    expect(() =>
      syntheticContentLesson(JSON.stringify({ ...input, explanationLanguage: "de" })),
    ).toThrow("synthetic_language_unsupported");
    expect(() => syntheticContentLesson(JSON.stringify({ ...input, format: "other" }))).toThrow();
  });
});

describe("through the release provider", () => {
  const generationFor = (id: string) => {
    const fixture = fixtures.find((entry) => entry.id === id);
    if (!fixture) throw new Error(`missing ${id}`);
    return buildKnowledgeGenerationInput(
      expectedGenerationData(fixture),
      settings.maxInputCharacters,
      { maxOutputTokens: settings.maxOutputTokens },
    );
  };

  it("turns the synthetic Gemini json_schema response into canonical knowledge at zero cost", async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = new OpenRouterProvider("synthetic-key", settings, async (_url, init) => {
      const serialized = String(init?.body);
      bodies.push(JSON.parse(serialized));
      return syntheticLessonResponse(serialized, bodies.length);
    });
    const result = await generateCanonicalKnowledge(
      provider,
      settings.llmModel,
      operationKey,
      generationFor("S12"),
    );
    expect(result).toMatchObject({ model: settings.llmModel, actualMicros: 0 });
    expect(result.output.learningItems).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "google/gemini-3.8-flash",
      max_tokens: 32000,
      reasoning: { effort: "medium" },
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(bodies[0]).not.toHaveProperty("temperature");
  });

  it("falls back once after the grammar refusal, and the deadline leaves an unknown outcome", async () => {
    const keys: (string | null)[] = [];
    const formats: string[] = [];
    const provider = new OpenRouterProvider("synthetic-key", settings, async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      const format = JSON.parse(String(init?.body)).response_format.type;
      formats.push(format);
      return format === "json_schema" ? grammarRejectionResponse() : providerDeadline();
    });
    const failure = await generateCanonicalKnowledge(
      provider,
      settings.llmModel,
      operationKey,
      generationFor("S06"),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ code: "provider_outcome_unknown", uncertain: true });
    expect(keys).toEqual([operationKey, `${operationKey}:json`]);
    expect(formats).toEqual(["json_schema", "json_object"]);
  });

  it("answers with the refusal production classifies and the deadline fetch rejects with", async () => {
    expect(await providerHttpErrorCode(grammarRejectionResponse())).toBe(
      "provider_request_schema_too_complex",
    );
    expect(() => providerDeadline()).toThrow(
      expect.objectContaining({ name: "TimeoutError" }) as unknown as Error,
    );
  });
});
