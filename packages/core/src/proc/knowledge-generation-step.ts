import { z } from "zod";
import { type AiProvider, ProviderError, type ProviderResult } from "../aip";
import { AppError } from "../plt";
import { generatedKnowledgeSchema } from "./generated-knowledge";
import {
  type buildKnowledgeGenerationInput,
  knowledgeRepairDetailSchema,
} from "./knowledge-generation";

/** Audit marker only: a known paid invalid response is never published as knowledge. */
export const knowledgeSchemaFailureSchema = z.strictObject({
  reason: z.literal("provider_schema_invalid"),
  attemptId: z.uuid(),
  /** Code-owned rejection detail used to steer the single regeneration. */
  detail: knowledgeRepairDetailSchema.optional(),
});

/** Only a code-owned validation code names an assembly failure; anything else is generic. */
function assemblyDiagnostic(error: unknown): string {
  const output =
    error instanceof AppError && error.code === "validation_failed"
      ? (error.details?.fields as { output?: unknown } | undefined)?.output
      : undefined;
  const code = Array.isArray(output) && output.length === 1 ? output[0] : undefined;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(code)
    ? `assembly:${code}`
    : "assembly:study_content_invalid";
}

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
  } catch (error) {
    // The HTTP result is known. Never turn an assembly failure into an unknown hold.
    throw new ProviderError(
      "provider_schema_invalid",
      false,
      false,
      accounting,
      assemblyDiagnostic(error),
    );
  }
}
