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

  it("never applies Anthropic sentinels or schema changes to another provider", () => {
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
