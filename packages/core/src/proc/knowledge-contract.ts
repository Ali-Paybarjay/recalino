import type { ProviderSettings } from "../aip";

/** Snapshots created before knowledgeContract existed: this exact id always used the content contract. */
const legacyContentContractModels: ReadonlySet<string> = new Set(["anthropic/claude-haiku-5.5"]);

/**
 * The content-only knowledge contract and its two-generation cap are selected by the settings
 * snapshot. Without the override field every other model keeps the legacy wire contract.
 */
export function usesContentKnowledgeContract(
  settings: ProviderSettings,
  model: string = settings.llmModel,
): boolean {
  return (
    settings.structuredModelOverrides?.[model]?.knowledgeContract === "content" ||
    legacyContentContractModels.has(model)
  );
}
