import {
  effectiveStructuredMaxOutputTokens,
  maximumProviderCost,
  providerSettingsSchema,
} from "@recalino/core/aip";
import { z } from "zod";

export const evaluationConfigSchema = z
  .strictObject({
    version: z.string().min(1).max(100),
    actorId: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    maximumTotalMicros: z.number().int().positive().max(100000),
    provider: providerSettingsSchema,
  })
  .superRefine((config, ctx) => {
    const models = [
      config.provider.llmModel,
      config.provider.visionModel,
      config.provider.sttModel,
      config.provider.ttsModel,
    ];
    let bounds = 0;
    for (const model of models) {
      try {
        bounds += maximumProviderCost(config.provider, model);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["provider", "modelMaximumMicros"],
          message: "invalid_cost_bound",
        });
      }
    }
    if (bounds > config.maximumTotalMicros)
      ctx.addIssue({
        code: "custom",
        path: ["maximumTotalMicros"],
        message: "four_call_bounds_exceed_total",
      });
    if (
      config.provider.maxInputCharacters > 10000 ||
      config.provider.maxOutputTokens > 4000 ||
      [config.provider.llmModel, config.provider.visionModel].some(
        (model) => effectiveStructuredMaxOutputTokens(config.provider, model) > 4000,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message: "synthetic_input_bounds_required",
      });
  });
export type EvaluationConfig = z.infer<typeof evaluationConfigSchema>;

/** This command cannot read cloud learner records or change a cloud budget. */
export function assertLocalEvaluationDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "54322" ||
    url.pathname !== "/postgres"
  )
    throw new Error("local_supabase_database_required");
}
