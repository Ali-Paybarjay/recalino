import { z } from "zod";
import { type AiProvider, ProviderError, type ProviderResult } from "../aip";
import { generatedKnowledgeSchema } from "./generated-knowledge";
import type { buildKnowledgeGenerationInput } from "./knowledge-generation";

/** Audit marker only: a known paid invalid response is never published as knowledge. */
export const knowledgeSchemaFailureSchema = z.strictObject({
  reason: z.literal("provider_schema_invalid"),
  attemptId: z.uuid(),
});

/** A paid content response becomes a canonical checkpoint, with its receipt intact. */
export async function generateCanonicalKnowledge(
  provider: AiProvider,
  model: string,
  operationKey: string,
  generation: ReturnType<typeof buildKnowledgeGenerationInput>,
  schemaName = "class_knowledge_content",
): Promise<ProviderResult<ReturnType<typeof generatedKnowledgeSchema.parse>>> {
  const result = await provider.structured({
    operationKey,
    model,
    schema: generation.schema,
    schemaName,
    system: generation.system,
    input: generation.input,
  });
  const { output: _output, ...accounting } = result;
  try {
    // Semantic validation follows the saved checkpoint, allowing one bounded repair.
    const output = generatedKnowledgeSchema.parse(generation.assemble(result.output));
    return { ...accounting, output };
  } catch {
    // The HTTP result is known. Never turn an assembly failure into an unknown hold.
    throw new ProviderError("provider_schema_invalid", false, false, accounting);
  }
}
