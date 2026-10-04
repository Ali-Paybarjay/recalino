import "server-only";
import { type AiProvider, OpenRouterProvider, providerSettingsSchema } from "@recalino/core/aip";

/** All model/voice/price/cap settings are operator configuration; no credential enters a view. */
export function getAiProvider(
  env: Record<string, string | undefined> = process.env,
): AiProvider | undefined {
  if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_SETTINGS_JSON) return undefined;
  try {
    return new OpenRouterProvider(
      env.OPENROUTER_API_KEY,
      providerSettingsSchema.parse(JSON.parse(env.OPENROUTER_SETTINGS_JSON)),
    );
  } catch {
    return undefined;
  }
}
