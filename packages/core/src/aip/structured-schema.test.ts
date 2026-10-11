import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createJsonFallbackTransport,
  createStructuredTransport,
  structuredSchemaComplexity,
} from "./structured-schema";

const model = "anthropic/claude-haiku-4.5";

describe("JSON fallback transport", () => {
  it("declares optional absence while preserving required values, native nulls and original constraints", () => {
    const schema = z.strictObject({
      required: z.string().min(3),
      optional: z.string().min(1).max(10).optional(),
      nativeNullable: z.string().nullable().optional(),
      nativeEmpty: z.string().optional(),
      optionalEnum: z.enum(["yes", "no"]).optional(),
      optionalBoolean: z.boolean().optional(),
      optionalArray: z.array(z.string().min(1)).optional(),
    });
    const original = z.toJSONSchema(schema, { reused: "ref" });
    const transport = createJsonFallbackTransport(schema);
    const raw = {
      required: "valid",
      optional: null,
      nativeNullable: null,
      nativeEmpty: "",
      optionalEnum: null,
      optionalBoolean: false,
      optionalArray: [],
    };
    expect(transport.decode(raw)).toEqual({
      required: "valid",
      nativeNullable: null,
      nativeEmpty: "",
      optionalBoolean: false,
      optionalArray: [],
    });
    expect(schema.safeParse(transport.decode(raw)).success).toBe(true);
    expect(transport.decode({ required: "valid", optional: "" })).toEqual({ required: "valid" });
    expect(transport.decode({ required: "valid" })).toEqual({ required: "valid" });
    for (const invalid of [
      { required: null },
      { required: "" },
      {},
      { required: "valid", optional: "x".repeat(11) },
      { required: "valid", optionalEnum: "" },
      { required: "valid", extra: true },
      { required: "valid", optionalArray: [""] },
    ])
      expect(schema.safeParse(transport.decode(invalid)).success).toBe(false);
    expect(raw.optional).toBeNull();
    expect(z.toJSONSchema(schema, { reused: "ref" })).toEqual(original);
    expect(JSON.stringify(transport.schema)).toContain('"maxLength":10');
  });

  it("decodes optional nested fields in reused arrays and only the matching discriminated branch", () => {
    const item = z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("one"), optional: z.string().min(1).optional() }),
      z.strictObject({ kind: z.literal("two"), optional: z.string().nullable() }),
    ]);
    const row = z.strictObject({
      item,
      extra: z.strictObject({ note: z.string().min(1).optional() }).optional(),
    });
    const schema = z.strictObject({ first: z.array(row), second: z.array(row) });
    const transport = createJsonFallbackTransport(schema);
    const raw = {
      first: [{ item: { kind: "one", optional: null }, extra: { note: null } }],
      second: [{ item: { kind: "two", optional: null }, extra: null }],
    };
    const decoded = transport.decode(raw);
    expect(decoded).toEqual({
      first: [{ item: { kind: "one" }, extra: {} }],
      second: [{ item: { kind: "two", optional: null } }],
    });
    expect(schema.safeParse(decoded).success).toBe(true);
  });
});

describe("Anthropic structured transport", () => {
  it("preserves ambiguous union values instead of choosing absence by branch order", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 27 }, (_, index) => [`field${index}`, z.string().min(1).optional()]),
    );
    const schema = z.union([
      z.strictObject(fields),
      z.strictObject({ ...fields, field0: z.string() }),
    ]);
    const raw = Object.fromEntries(
      Array.from({ length: 27 }, (_, index) => [`field${index}`, index === 0 ? "" : "present"]),
    );
    const transport = createStructuredTransport(schema, model);
    expect(transport.decode(raw)).toEqual(raw);
    expect(schema.safeParse(transport.decode(raw)).success).toBe(true);
  });
  it("reduces optional text without adding unions and decodes reused nested schemas losslessly", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 27 }, (_, index) => [
        `field${index}`,
        z.string().min(1).max(30).optional(),
      ]),
    );
    const row = z.strictObject({
      ...fields,
      required: z.string().min(1),
      nullable: z.string().nullable(),
    });
    const schema = z.strictObject({ first: z.array(row), second: z.array(row) });
    const transport = createStructuredTransport(schema, model);
    expect(structuredSchemaComplexity(transport.schema)).toEqual({
      optionalParameters: 12,
      unionParameters: 1,
    });
    const sentinels = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`field${index}`, ""]),
    );
    const raw = {
      first: [{ ...sentinels, required: "valid", nullable: null, field15: "kept" }],
      second: [{ ...sentinels, required: "valid", nullable: "" }],
    };
    const before = structuredClone(raw);
    const output = transport.decode(raw);
    expect(output).toEqual({
      first: [{ required: "valid", nullable: null, field15: "kept" }],
      second: [{ required: "valid", nullable: "" }],
    });
    expect(schema.safeParse(output).success).toBe(true);
    expect(raw).toEqual(before);
    expect(
      schema.safeParse(
        transport.decode({ ...raw, first: [{ ...sentinels, required: "", nullable: null }] }),
      ).success,
    ).toBe(false);
    expect(
      schema.safeParse(
        transport.decode({
          ...raw,
          first: [{ ...sentinels, required: "valid", nullable: null, field15: "" }],
        }),
      ).success,
    ).toBe(false);
    expect(
      schema.safeParse(
        transport.decode({
          ...raw,
          first: [{ ...sentinels, required: "valid", nullable: null, field0: "x".repeat(31) }],
        }),
      ).success,
    ).toBe(false);
  });

  it("decodes only the matching discriminated branch and keeps native empty strings", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`extra${index}`, z.string().min(1).optional()]),
    );
    const schema = z.strictObject({
      item: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("one"), ...fields, value: z.string().min(1).optional() }),
        z.strictObject({ kind: z.literal("two"), ...fields, value: z.string() }),
      ]),
    });
    const transport = createStructuredTransport(schema, model);
    const raw = {
      item: {
        kind: "two",
        ...Object.fromEntries(
          Array.from({ length: 15 }, (_, index) => [`extra${index}`, `value${index}`]),
        ),
        value: "",
      },
    };
    expect(transport.decode(raw)).toEqual(raw);
    expect(schema.safeParse(transport.decode(raw)).success).toBe(true);
  });

  it("never applies Anthropic sentinels or the Gemini translation to another provider", () => {
    const schema = z.strictObject(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`field${index}`, z.string().min(1).optional()]),
      ),
    );
    const transport = createStructuredTransport(schema, "other/model");
    const raw = { field0: "" };
    expect(transport.schema).toEqual(z.toJSONSchema(schema));
    expect(transport.decode(raw)).toBe(raw);
    expect(schema.safeParse(transport.decode(raw)).success).toBe(false);
  });

  it("fails locally when a schema still exceeds the documented limits", () => {
    const schema = z.strictObject(
      Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`field${index}`, z.boolean().optional()]),
      ),
    );
    expect(() => createStructuredTransport(schema, model)).toThrowError(
      expect.objectContaining({
        code: "provider_schema_unsupported",
        retryable: false,
        uncertain: false,
      }),
    );
  });

  it("preserves literal data in defaults instead of interpreting data keys as schema keywords", () => {
    const schema = z.strictObject({
      value: z
        .strictObject({ maximum: z.string(), oneOf: z.string() })
        .default({ maximum: "value", oneOf: "literal" }),
    });
    const transport = createStructuredTransport(schema, model);
    expect(JSON.stringify(transport.schema)).toContain(
      '"default":{"maximum":"value","oneOf":"literal"}',
    );
  });
});

describe("FR-PROC-003 Gemini structured transport", () => {
  const gemini = "google/gemini-3.8-flash";
  // A JSON Schema validator stands in for the remote grammar: it must accept every valid value.
  const grammar = (schema: Record<string, unknown>) =>
    z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema);

  it("sends only Gemini's documented subset while local Zod keeps every constraint", () => {
    const schema = z.strictObject({
      item: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("one"),
          text: z
            .string()
            .min(1)
            .max(30)
            .regex(/^[a-z]+$/),
        }),
        z.strictObject({ kind: z.literal("two"), rows: z.array(z.string()).min(2).max(5) }),
      ]),
      list: z.array(z.string().min(1)).min(1).max(3),
      sourceId: z.uuid(),
      date: z.iso.date(),
      index: z.int().min(0).max(23),
      optional: z.string().min(1).optional(),
      nullable: z.string().nullable(),
      nullableText: z.string().min(1).describe("Nullable text").nullable(),
      nullableEnum: z.enum(["x", "y"]).nullable(),
      nullableObject: z.strictObject({ value: z.string() }).nullable(),
      flag: z.literal(true),
      none: z.literal(null),
      count: z.literal(5),
      fallback: z.string().default("x"),
    });
    const transport = createStructuredTransport(schema, gemini);
    const branch = (kind: string, name: string, value: Record<string, unknown>) => ({
      type: "object",
      properties: { kind: { type: "string", enum: [kind] }, [name]: value },
      required: ["kind", name],
      additionalProperties: false,
    });
    expect(transport.schema).toEqual({
      type: "object",
      properties: {
        item: {
          anyOf: [
            branch("one", "text", { type: "string" }),
            branch("two", "rows", { type: "array", items: { type: "string" } }),
          ],
        },
        list: { minItems: 1, type: "array", items: { type: "string" } },
        sourceId: { type: "string" },
        date: { type: "string", format: "date" },
        index: { type: "integer" },
        optional: { type: "string" },
        nullable: { type: ["string", "null"] },
        nullableText: { type: ["string", "null"], description: "Nullable text" },
        nullableEnum: { anyOf: [{ type: "string", enum: ["x", "y"] }, { type: "null" }] },
        nullableObject: {
          type: ["object", "null"],
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        flag: { type: "boolean" },
        none: { type: "null" },
        count: { type: "number", enum: [5] },
        fallback: { type: "string" },
      },
      required: [
        "item",
        "list",
        "sourceId",
        "date",
        "index",
        "nullable",
        "nullableText",
        "nullableEnum",
        "nullableObject",
        "flag",
        "none",
        "count",
        "fallback",
      ],
      additionalProperties: false,
    });
    const valid = {
      item: { kind: "one", text: "abc" },
      list: ["a"],
      sourceId: "12345678-1234-4234-8234-123456789abc",
      date: "2026-10-09",
      index: 3,
      nullable: null,
      nullableText: null,
      nullableEnum: null,
      nullableObject: { value: "v" },
      flag: true,
      none: null,
      count: 5,
      fallback: "x",
    };
    expect(transport.decode(valid)).toBe(valid);
    expect(schema.safeParse(valid).success).toBe(true);
    expect(grammar(transport.schema).safeParse(valid).success).toBe(true);
    // Constraints outside the grammar stay local rejections; no server check is weakened.
    for (const loosened of [
      { ...valid, item: { kind: "one", text: "ABC" } },
      { ...valid, item: { kind: "two", rows: ["a"] } },
      { ...valid, list: ["a", "b", "c", "d"] },
      { ...valid, sourceId: "not-a-uuid" },
      { ...valid, index: 24 },
      { ...valid, nullableText: "" },
      { ...valid, flag: false },
    ]) {
      expect(grammar(transport.schema).safeParse(loosened).success).toBe(true);
      expect(transport.decode(loosened)).toBe(loosened);
      expect(schema.safeParse(transport.decode(loosened)).success).toBe(false);
    }
    for (const invalid of [
      { ...valid, item: { kind: "three", text: "abc" } },
      { ...valid, nullableEnum: "z" },
      { ...valid, extra: true },
      { ...valid, list: [] },
      { ...valid, count: 6 },
    ]) {
      expect(grammar(transport.schema).safeParse(invalid).success).toBe(false);
      expect(schema.safeParse(transport.decode(invalid)).success).toBe(false);
    }
  });

  it("sends an enum longer than 64 values as its typed description, never a shorter one", () => {
    const values = (count: number) =>
      Array.from({ length: count }, (_, index) => `r${index.toString(36)}`) as [
        string,
        ...string[],
      ];
    const schema = z.strictObject({
      bounded: z.enum(values(64)),
      keys: z.array(z.enum(values(65)).describe("Evidence key")).min(1),
    });
    const transport = createStructuredTransport(schema, gemini);
    expect(transport.schema.properties).toEqual({
      bounded: { type: "string", enum: values(64) },
      keys: { type: "array", minItems: 1, items: { type: "string", description: "Evidence key" } },
    });
    const invented = { bounded: "r0", keys: ["invented"] };
    expect(grammar(transport.schema).safeParse(invented).success).toBe(true);
    expect(schema.safeParse(transport.decode(invented)).success).toBe(false);
    expect(schema.safeParse({ bounded: "r0", keys: ["r1s"] }).success).toBe(true);
  });

  it("inlines reused definitions and fails locally for structure it cannot express", () => {
    const shared = z.string().min(1).meta({ id: "gemini_transport_shared_text" });
    const transport = createStructuredTransport(z.strictObject({ a: shared, b: shared }), gemini);
    expect(JSON.stringify(transport.schema)).not.toMatch(/"\$(ref|defs|schema)"/);
    expect(transport.schema.properties).toEqual({ a: { type: "string" }, b: { type: "string" } });
    const node: z.ZodType = z.strictObject({
      name: z.string(),
      get children() {
        return z.array(node);
      },
    });
    for (const unsupported of [node, z.strictObject({ pair: z.tuple([z.string(), z.number()]) })])
      expect(() => createStructuredTransport(unsupported, gemini)).toThrowError(
        expect.objectContaining({
          code: "provider_schema_unsupported",
          retryable: false,
          uncertain: false,
        }),
      );
  });

  it("keeps property names and default data that look like keywords as data", () => {
    const schema = z.strictObject({
      pattern: z.string().min(1),
      title: z.strictObject({ const: z.string(), maxItems: z.string() }).default({
        const: "value",
        maxItems: "literal",
      }),
    });
    const transport = createStructuredTransport(schema, gemini);
    expect(transport.schema.properties).toEqual({
      pattern: { type: "string" },
      title: {
        type: "object",
        properties: { const: { type: "string" }, maxItems: { type: "string" } },
        required: ["const", "maxItems"],
        additionalProperties: false,
      },
    });
  });
});
