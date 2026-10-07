import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { createStructuredTransport, OpenRouterProvider, structuredSchemaComplexity } from "../aip";
import { buildKnowledgeRepairInput } from "./knowledge-repair";
import { generatedKnowledgeSchema } from "./worker";

const sourceId = "11111111-1111-4111-8111-111111111111";
const repair = buildKnowledgeRepairInput(
  {
    sources: [
      {
        sourceId,
        contentVersionId: sourceId,
        objectId: sourceId,
        sha256: "a".repeat(64),
        kind: "text",
        mimeType: "text/plain",
        role: "class_material",
        durationMs: null,
        pageCount: null,
        ranges: [],
        captureAnchor: null,
        units: [{ id: "unit", kind: "document", start: 1, status: "extracted" }],
        blocks: [
          { id: "block", unitId: "unit", kind: "paragraph", text: "Synthetic class material." },
        ],
      },
    ],
    missingSourceIds: [],
    explanationLanguage: "fa",
    teachingPreferences: { shorterExamples: true },
  },
  120000,
);

describe("production knowledge structured-output contracts", () => {
  it("round-trips complete study cards and class notes through the HTTP provider boundary", async () => {
    const expected = generatedKnowledgeSchema.parse(referenceStudyModel());
    let wire: unknown;
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const schema = body.response_format.json_schema.schema;
      expect(structuredSchemaComplexity(schema).optionalParameters).toBeLessThanOrEqual(12);
      wire = providerFixture(expected, schema, schema);
      // The response really contains transport sentinels; original validation alone rejects them.
      expect(generatedKnowledgeSchema.safeParse(wire).success).toBe(false);
      return new Response(
        JSON.stringify({
          model: "anthropic/claude-haiku-4.5",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(wire) } }],
          usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.000001 },
        }),
      );
    });
    const provider = new OpenRouterProvider(
      "synthetic-key",
      {
        version: "synthetic",
        llmModel: "anthropic/claude-haiku-4.5",
        visionModel: "synthetic/vision",
        sttModel: "synthetic/stt",
        ttsModel: "synthetic/tts",
        voice: "synthetic",
        promptVersion: "1",
        maxInputCharacters: 120000,
        maxOutputTokens: 6144,
        timeoutMs: 90000,
        maximumMicros: 300000,
        currency: "USD",
        priceVersion: "fixture",
        charactersPerPage: 3000,
        audioUrlSupported: false,
        sttProviderOptions: {},
        dataContractApproved: true,
      },
      request,
    );
    const result = await provider.structured({
      operationKey: "fixture",
      model: provider.settings.llmModel,
      schema: generatedKnowledgeSchema,
      schemaName: "class_knowledge",
      system: "Synthetic fixture",
      input: "Synthetic material",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(result.output).toEqual(expected);
    expect(result.output.classNotes?.tasks.length).toBeGreaterThan(0);
    expect(new Set(result.output.learningItems.map((item) => item.study?.set))).toEqual(
      new Set(["production", "recognition"]),
    );
  });
  it.each([
    { name: "generation", schema: generatedKnowledgeSchema },
    { name: "evidence repair", schema: repair.schema },
  ])("keeps the actual $name schema within Anthropic grammar budgets", ({ schema }) => {
    const original = z.toJSONSchema(schema, { reused: "ref" });
    // Regression: the domain contract contains more optional fields than Anthropic permits.
    expect(structuredSchemaComplexity(original).optionalParameters).toBeGreaterThan(24);
    const transport = createStructuredTransport(schema, "anthropic/claude-haiku-4.5");
    const metrics = structuredSchemaComplexity(transport.schema);
    expect(metrics.optionalParameters).toBeLessThanOrEqual(12);
    expect(metrics.unionParameters).toBeLessThanOrEqual(16);
    expect(metrics.unionParameters).toBe(structuredSchemaComplexity(original).unionParameters);
    expect(z.toJSONSchema(schema, { reused: "ref" })).toEqual(original);
  });
});

/** Simulate a provider obeying the sent wire schema, using only synthetic fixture text. */
interface WireSchema {
  $ref?: string;
  anyOf?: WireSchema[];
  properties?: Record<string, WireSchema>;
  items?: WireSchema;
  const?: unknown;
  description?: string;
}
function providerFixture(value: unknown, schema: WireSchema, root: WireSchema): unknown {
  if (schema.$ref) {
    let target: unknown = root;
    for (const key of schema.$ref.slice(2).split("/"))
      target = (target as Record<string, unknown>)[key];
    return providerFixture(value, target as WireSchema, root);
  }
  if (Array.isArray(schema.anyOf) && value && typeof value === "object") {
    const branch = schema.anyOf.find((candidate) =>
      Object.entries(candidate.properties ?? {}).some(
        ([key, property]) =>
          property.const !== undefined &&
          property.const === (value as Record<string, unknown>)[key],
      ),
    );
    if (branch) return providerFixture(value, branch, root);
  }
  const items = schema.items;
  if (Array.isArray(value) && items) return value.map((item) => providerFixture(item, items, root));
  if (!value || typeof value !== "object" || !schema.properties) return value;
  const result: Record<string, unknown> = { ...value };
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in result) && property.description?.includes('Use "" if inapplicable.'))
      result[key] = "";
    else if (key in result) result[key] = providerFixture(result[key], property, root);
  }
  return result;
}
