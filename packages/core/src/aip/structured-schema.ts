import { z } from "zod";

/** Transport compatibility only. The original Zod schema always validates the returned result. */
export function structuredTransportSchema(schema: z.ZodType, model: string) {
  if (!model.startsWith("anthropic/")) return z.toJSONSchema(schema);
  const converted = z.toJSONSchema(schema, { reused: "ref" });
  const unsupported = new Set([
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
    "pattern",
  ]);
  const mappings = new Set(["properties", "$defs", "definitions", "patternProperties"]);
  function transform(value: unknown, schemaNode = true): unknown {
    if (Array.isArray(value)) return value.map((item) => transform(item));
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // UUID grammars multiply nested SourceRef states; full local Zod validates UUIDs and
      // LKM verifies exact owned source/version identities after the provider response.
      if (schemaNode && key === "format" && item === "uuid") continue;
      if (
        schemaNode &&
        (unsupported.has(key) || (key === "minItems" && typeof item === "number" && item > 1))
      )
        continue;
      const target = schemaNode && key === "oneOf" ? "anyOf" : key;
      result[target] =
        mappings.has(key) && schemaNode ? transform(item, false) : transform(item, true);
    }
    return result;
  }
  return transform(converted);
}
