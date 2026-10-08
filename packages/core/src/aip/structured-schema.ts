import { z } from "zod";
import { ProviderError } from "./contracts";

type Schema = Record<string, unknown>;
const mappings = new Set(["properties", "$defs", "definitions", "patternProperties"]);
const children = new Set(["items", "additionalProperties", "not", "if", "then", "else"]);
const alternatives = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const OPTIONAL_PARAMETER_TARGET = 12;
const OPTIONAL_PARAMETER_LIMIT = 24;
const UNION_PARAMETER_LIMIT = 16;

function object(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function visit(schema: unknown, visitor: (node: Schema) => void): void {
  if (!object(schema)) return;
  visitor(schema);
  for (const [key, value] of Object.entries(schema)) {
    if (mappings.has(key) && object(value)) {
      for (const child of Object.values(value)) visit(child, visitor);
    } else if (alternatives.has(key) && Array.isArray(value)) {
      for (const child of value) visit(child, visitor);
    } else if (children.has(key)) visit(value, visitor);
  }
}

/** Anthropic's documented per-request limits; count definitions once, not every reference. */
export function structuredSchemaComplexity(schema: unknown) {
  let optionalParameters = 0;
  let unionParameters = 0;
  visit(schema, (node) => {
    if (object(node.properties)) {
      const required = Array.isArray(node.required) ? node.required : [];
      optionalParameters += Object.keys(node.properties).filter(
        (key) => !required.includes(key),
      ).length;
    }
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.type))
      unionParameters += 1;
  });
  return { optionalParameters, unionParameters };
}

function resolve(schema: Schema, root: Schema): Schema {
  const seen = new Set<Schema>();
  let current = schema;
  while (typeof current.$ref === "string" && current.$ref.startsWith("#/") && !seen.has(current)) {
    seen.add(current);
    let target: unknown = root;
    for (const key of current.$ref.slice(2).split("/")) {
      target = object(target) ? target[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
    }
    if (!object(target)) break;
    current = target;
  }
  return current;
}

/** Match a discriminated/nullable branch, without weakening final validation in the original Zod schema. */
function matchesBranch(value: unknown, schema: Schema, root: Schema): boolean {
  const node = resolve(schema, root);
  if ("const" in node && node.const !== value) return false;
  if (Array.isArray(node.enum) && !node.enum.includes(value)) return false;
  const branches = node.anyOf ?? node.oneOf;
  if (Array.isArray(branches))
    return branches.some((branch) => object(branch) && matchesBranch(value, branch, root));
  if (node.type === "null") return value === null;
  if (node.type === "string") return typeof value === "string";
  if (node.type === "boolean") return typeof value === "boolean";
  if (node.type === "number" || node.type === "integer") return typeof value === "number";
  if (node.type === "array") return Array.isArray(value);
  if (node.type === "object") {
    if (!object(value)) return false;
    if (Array.isArray(node.required) && node.required.some((key) => !(String(key) in value)))
      return false;
    return (
      !object(node.properties) ||
      Object.entries(node.properties).every(
        ([key, child]) =>
          !(key in value) || !object(child) || matchesBranch(value[key], child, root),
      )
    );
  }
  return true;
}

/** Transport compatibility only. The original Zod schema always validates the returned result. */
export function structuredTransportSchema(schema: z.ZodType, model: string) {
  return createStructuredTransport(schema, model).schema;
}

/** JSON mode has no compiled grammar; preserve all original constraints and declare absence explicitly. */
export function createJsonFallbackTransport(schema: z.ZodType) {
  const wire = z.toJSONSchema(schema, { reused: "ref" }) as Schema;
  const absentNull = new WeakSet<Schema>();
  const absentText = new WeakSet<Schema>();
  visit(wire, (node) => {
    if (!object(node.properties)) return;
    const required = Array.isArray(node.required) ? node.required : [];
    for (const [key, child] of Object.entries(node.properties)) {
      if (required.includes(key) || !object(child) || matchesBranch(null, child, wire)) continue;
      const resolved = resolve(child, wire);
      const emptyText =
        resolved.type === "string" &&
        typeof resolved.minLength === "number" &&
        resolved.minLength >= 1 &&
        !("enum" in resolved) &&
        !("const" in resolved);
      const nullable: Schema = {
        anyOf: [child, { type: "null" }, ...(emptyText ? [{ type: "string", const: "" }] : [])],
        description: emptyText
          ? 'Optional: omit or use null or "" when inapplicable. Other values must satisfy the original constraints.'
          : "Optional: omit or use null when inapplicable. Other values must satisfy the original constraints.",
      };
      node.properties[key] = nullable;
      absentNull.add(nullable);
      if (emptyText) absentText.add(nullable);
    }
  });
  function decode(value: unknown, schemaNode: Schema = wire): unknown {
    const node = resolve(schemaNode, wire);
    const alternatives = node.anyOf ?? node.oneOf;
    if (Array.isArray(alternatives)) {
      const branches = alternatives.filter(
        (candidate) => object(candidate) && matchesBranch(value, candidate, wire),
      );
      return branches.length === 1 && object(branches[0]) ? decode(value, branches[0]) : value;
    }
    if (Array.isArray(value) && object(node.items))
      return value.map((item) => decode(item, node.items as Schema));
    if (!object(value) || !object(node.properties)) return value;
    const result = { ...value };
    for (const [key, child] of Object.entries(node.properties)) {
      if (!(key in result) || !object(child)) continue;
      if (
        (absentNull.has(child) && result[key] === null) ||
        (absentText.has(child) && result[key] === "")
      )
        delete result[key];
      else result[key] = decode(result[key], child);
    }
    return result;
  }
  return { schema: wire, decode: (value: unknown) => decode(value) };
}

export function createStructuredTransport(schema: z.ZodType, model: string) {
  if (!model.startsWith("anthropic/"))
    return { schema: z.toJSONSchema(schema), decode: (value: unknown) => value };
  const converted = z.toJSONSchema(schema, { reused: "ref" });
  const absentText = new WeakSet<Schema>();
  let optional = structuredSchemaComplexity(converted).optionalParameters;
  // Required strings compile without the optional/nullable combinatorial cost. Only
  // locally nonempty optional text can use "" as an unambiguous absence sentinel.
  // The domain schema, required text, enums, evidence and nullable fields stay intact.
  visit(converted, (node) => {
    if (!object(node.properties) || optional <= OPTIONAL_PARAMETER_TARGET) return;
    const required = Array.isArray(node.required) ? [...node.required] : [];
    for (const [key, child] of Object.entries(node.properties)) {
      if (optional <= OPTIONAL_PARAMETER_TARGET) break;
      if (required.includes(key) || !object(child)) continue;
      const resolved = resolve(child, converted);
      if (
        resolved.type !== "string" ||
        !(typeof resolved.minLength === "number" && resolved.minLength >= 1) ||
        "enum" in resolved ||
        "const" in resolved ||
        "anyOf" in resolved ||
        "oneOf" in resolved
      )
        continue;
      child.description = [child.description ?? resolved.description, 'Use "" if inapplicable.']
        .filter(Boolean)
        .join(" ");
      absentText.add(child);
      required.push(key);
      optional -= 1;
    }
    node.required = required;
  });
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
  const transportAbsentText = new WeakSet<Schema>();
  function transform(value: unknown): unknown {
    if (!object(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // UUID grammars multiply nested SourceRef states; full local Zod validates UUIDs and
      // LKM verifies exact owned source/version identities after the provider response.
      if (key === "format" && item === "uuid") continue;
      if (unsupported.has(key) || (key === "minItems" && typeof item === "number" && item > 1))
        continue;
      const target = key === "oneOf" ? "anyOf" : key;
      result[target] =
        mappings.has(key) && object(item)
          ? Object.fromEntries(
              Object.entries(item).map(([name, child]) => [name, transform(child)]),
            )
          : alternatives.has(key) && Array.isArray(item)
            ? item.map(transform)
            : children.has(key)
              ? transform(item)
              : item;
    }
    if (absentText.has(value)) transportAbsentText.add(result);
    return result;
  }
  const transport = transform(converted) as Schema;
  const complexity = structuredSchemaComplexity(transport);
  if (
    complexity.optionalParameters > OPTIONAL_PARAMETER_LIMIT ||
    complexity.unionParameters > UNION_PARAMETER_LIMIT
  )
    throw new ProviderError("provider_schema_unsupported", false, false);
  function decode(value: unknown, schemaNode: Schema = transport): unknown {
    const node = resolve(schemaNode, transport);
    if (Array.isArray(node.anyOf)) {
      const branches = node.anyOf.filter(
        (candidate) => object(candidate) && matchesBranch(value, candidate, transport),
      );
      // An overlapping union may give an empty string two meanings. Preserve it
      // rather than choosing an interpretation by branch order.
      const branch = branches.length === 1 ? branches[0] : undefined;
      return object(branch) ? decode(value, branch) : value;
    }
    if (Array.isArray(value) && object(node.items))
      return value.map((item) => decode(item, node.items as Schema));
    if (!object(value) || !object(node.properties)) return value;
    const result = { ...value };
    for (const [key, child] of Object.entries(node.properties)) {
      if (!(key in result) || !object(child)) continue;
      if (transportAbsentText.has(child) && result[key] === "") delete result[key];
      else result[key] = decode(result[key], child);
    }
    return result;
  }
  return { schema: transport, decode: (value: unknown) => decode(value) };
}
