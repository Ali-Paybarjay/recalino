import { structuredTransportSchema } from "../../packages/core/src/aip";
import { knowledgeModelSchema } from "../../packages/core/src/lkm";

const schema = structuredTransportSchema(knowledgeModelSchema, "anthropic/claude-haiku-4.5");
const counts: Record<string, number> = {};
function inspect(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(inspect);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    counts[key] = (counts[key] ?? 0) + 1;
    inspect(child);
  }
}
inspect(schema);
process.stdout.write(
  `${JSON.stringify({ characters: JSON.stringify(schema).length, keywords: Object.fromEntries(["$ref", "$defs", "anyOf", "oneOf", "pattern", "format", "enum", "properties", "required", "type", "minimum", "maximum", "maxLength"].map((key) => [key, counts[key] ?? 0])) }, null, 2)}\n`,
);
