import { z } from "../../packages/core/node_modules/zod";
import {
  type AiProvider,
  ProviderError,
  type ProviderSettings,
  providerSettingsSchema,
  type StructuredInput,
} from "../../packages/core/src/aip";
import { type KnowledgeModel, normalizeGeneratedStudyModel } from "../../packages/core/src/lkm";
import type { RunSource } from "../../packages/core/src/proc/contracts";
import { finalizeGeneratedStudyPractice } from "../../packages/core/src/proc/generated-study-practice";
import { compactKnowledgeBudget } from "../../packages/core/src/proc/knowledge-compact";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
  type KnowledgeGenerationOptions,
  knowledgeRepairDetailSchema,
} from "../../packages/core/src/proc/knowledge-generation";
import { generateCanonicalKnowledge } from "../../packages/core/src/proc/knowledge-generation-step";
import { mergeLessonParts, planLessonParts } from "../../packages/core/src/proc/knowledge-parts";
import {
  type LearnerTeachingContext,
  modelTeachingContext,
} from "../../packages/core/src/proc/learner-context";
import { lessonBudget, measureLessonContent } from "../../packages/core/src/proc/lesson-budget";
import { validateGeneratedKnowledge } from "../../packages/core/src/proc/worker";

/**
 * D62/D63 lesson-quality evaluation (docs/plans/LESSON_QUALITY_2026-10-12.md). The same harness
 * runs offline with a synthetic provider (unit tests) and live only through lesson-quality-live.ts
 * under its hard cost cap. Synthetic lessons only.
 */
type Generated = Parameters<typeof validateGeneratedKnowledge>[0];
/** A run's frozen snapshot context; the model sees modelTeachingContext of it, as in the worker. */
export type LessonData = Omit<KnowledgeGenerationInput, "learnerContext"> & {
  learnerContext?: LearnerTeachingContext;
};

/** The production settings of D56 (`openrouter-2026-10-10-1`) rebuilt from the candidate config. */
export function lessonQualityArms(config: unknown): {
  production: ProviderSettings;
  candidate: ProviderSettings;
} {
  const candidate = providerSettingsSchema.parse(config);
  if (!candidate.lessonQuality) throw new Error("candidate_without_lesson_quality");
  const { lessonQuality: _quality, ...rest } = candidate;
  const production = providerSettingsSchema.parse({
    ...rest,
    version: "openrouter-2026-10-10-1",
    promptVersion: "recalino-knowledge-10",
  });
  return { production, candidate };
}

/** Thrown before a call that could pass the cap; nothing is dispatched. */
export class BudgetStop extends Error {
  constructor(readonly spentMicros: number) {
    super("evaluation_budget_reached");
  }
}

/** Hard total cap in microdollars: actual costs are recorded before the next call is allowed. */
export class BudgetGuard {
  spentMicros: number;
  calls = 0;
  /** Code-owned outcome of every call (error code and validation diagnostic), never text. */
  readonly outcomes: string[] = [];
  /** Synthetic evaluation only: the raw JSON of each rejected response, for offline diagnosis. */
  readonly rejectedResponses: { operation: string; outcome: string; raw: unknown }[] = [];
  /**
   * `alreadySpentMicros` carries an earlier run's actual spend into the same total cap;
   * `maxCalls` stops a diagnostic run after that many dispatches.
   */
  constructor(
    readonly capMicros: number,
    alreadySpentMicros = 0,
    readonly maxCalls = Number.POSITIVE_INFINITY,
  ) {
    this.spentMicros = alreadySpentMicros;
  }
  reserve(worstCaseMicros: number) {
    if (this.calls >= this.maxCalls || this.spentMicros + worstCaseMicros > this.capMicros)
      throw new BudgetStop(this.spentMicros);
  }
  /** An unknown cost counts as the worst case, never as free. */
  record(actualMicros: number | null | undefined, worstCaseMicros: number) {
    this.calls += 1;
    this.spentMicros += actualMicros ?? worstCaseMicros;
  }
}

/**
 * Worst case of one request, in microdollars, at the highest captured ZDR price (D56): prompt
 * tokens bounded by its characters (a token is at least one character) and the full output cap.
 */
export function worstCaseMicros(
  settings: ProviderSettings,
  requestCharacters: number,
  prices = { promptPerMillion: 1.35, completionPerMillion: 6.75 },
): number {
  const output =
    settings.structuredModelOverrides?.[settings.llmModel]?.maxOutputTokens ??
    settings.maxOutputTokens;
  return Math.ceil(
    requestCharacters * prices.promptPerMillion + output * prices.completionPerMillion,
  );
}

export interface ArmResult {
  valid: boolean;
  firstTry: boolean;
  attempts: number;
  costMicros: number;
  latencyMs: number;
  outputTokens: number;
  parts: number;
  error?: string;
  model?: KnowledgeModel;
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  const fields = (error as { details?: { fields?: { output?: unknown } } })?.details?.fields;
  const output = fields?.output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return error instanceof Error ? error.message : "unknown";
}

/** Mirrors the worker's content path: one generation and at most one bounded regeneration. */
export async function generateArmLesson(
  provider: AiProvider,
  data: LessonData,
  guard: BudgetGuard,
  operation: string,
): Promise<ArmResult> {
  const settings = provider.settings;
  const quality = settings.lessonQuality;
  const model = settings.llmModel;
  const outputLimit =
    settings.structuredModelOverrides?.[model]?.maxOutputTokens ?? settings.maxOutputTokens;
  const qualityOptions = (sources: readonly RunSource[]): KnowledgeGenerationOptions =>
    quality
      ? {
          maxOutputTokens: outputLimit,
          budget: lessonBudget(
            outputLimit,
            measureLessonContent(sources, settings.charactersPerPage),
          ),
          sourceCoverage: quality.sourceCoverage,
        }
      : { maxOutputTokens: settings.maxOutputTokens };
  const teaching = modelTeachingContext(data.learnerContext, []);
  const generationInput = (sources: RunSource[], missingSourceIds: readonly string[]) => {
    const { learnerContext: _snapshot, ...rest } = data;
    return {
      ...rest,
      sources,
      missingSourceIds,
      ...(teaching ? { learnerContext: teaching } : {}),
    };
  };
  const totals = { costMicros: 0, latencyMs: 0, outputTokens: 0, attempts: 0 };
  async function call(
    input: KnowledgeGenerationInput,
    options: KnowledgeGenerationOptions,
  ): Promise<{ output: Generated } | { error: unknown }> {
    const prepared = buildKnowledgeGenerationInput(input, settings.maxInputCharacters, options);
    let schemaText: string;
    try {
      schemaText = JSON.stringify(z.toJSONSchema(prepared.schema));
    } catch {
      schemaText = "x".repeat(40000);
    }
    const worst = worstCaseMicros(
      settings,
      Array.from(prepared.system + prepared.input + schemaText).length,
    );
    guard.reserve(worst);
    totals.attempts += 1;
    const started = Date.now();
    let raw: unknown;
    // Keeps the provider's raw output of this call; nothing else about the call changes.
    const capturing: AiProvider = {
      name: provider.name,
      mode: provider.mode,
      settings: provider.settings,
      async structured<T>(request: StructuredInput<T>) {
        const response = await provider.structured(request);
        raw = response.output;
        return response;
      },
      transcribe: (request) => provider.transcribe(request),
      speech: (request) => provider.speech(request),
    };
    try {
      const result = await generateCanonicalKnowledge(
        capturing,
        model,
        `${operation}:${totals.attempts}`,
        prepared,
      );
      guard.record(result.actualMicros, worst);
      guard.outcomes.push(`${operation}:${totals.attempts}:response`);
      totals.costMicros += result.actualMicros ?? worst;
      totals.outputTokens += result.usage.outputTokens ?? 0;
      return { output: result.output as Generated };
    } catch (error) {
      const accounting = error instanceof ProviderError ? error.accounting : undefined;
      guard.record(accounting ? accounting.actualMicros : null, worst);
      const outcome = `${operation}:${totals.attempts}:${errorCode(error)}${error instanceof ProviderError && error.diagnostic ? `:${error.diagnostic}` : ""}`;
      guard.outcomes.push(outcome);
      if (raw !== undefined) guard.rejectedResponses.push({ operation, outcome, raw });
      totals.costMicros += accounting?.actualMicros ?? worst;
      totals.outputTokens += accounting?.usage.outputTokens ?? 0;
      if (error instanceof ProviderError && error.uncertain) throw error;
      return { error };
    } finally {
      totals.latencyMs += Date.now() - started;
    }
  }
  /** One part (or the whole lesson): first response, then at most one regeneration. */
  async function lesson(
    input: KnowledgeGenerationInput,
  ): Promise<{ output: Generated; first: boolean }> {
    const options = qualityOptions(input.sources);
    const first = await call(input, options);
    let retry: KnowledgeGenerationOptions;
    if ("output" in first) {
      try {
        validateGeneratedKnowledge(
          first.output,
          input.sources,
          [...input.missingSourceIds],
          input.explanationLanguage,
        );
        return { output: first.output, first: true };
      } catch (error) {
        guard.outcomes.push(`${operation}:${totals.attempts}:semantic:${errorCode(error)}`);
        retry = { ...options, repairReason: errorCode(error) };
      }
    } else if (
      first.error instanceof ProviderError &&
      first.error.code === "provider_output_truncated"
    )
      retry = { maxOutputTokens: compactKnowledgeBudget(settings.maxOutputTokens), compact: true };
    else if (
      first.error instanceof ProviderError &&
      first.error.code === "provider_schema_invalid"
    ) {
      const detail = knowledgeRepairDetailSchema.safeParse(first.error.diagnostic);
      retry = {
        ...options,
        repairReason: "provider_schema_invalid",
        ...(detail.success ? { repairDetail: detail.data } : {}),
      };
    } else throw first.error;
    const second = await call(input, retry);
    if (!("output" in second)) throw second.error;
    validateGeneratedKnowledge(
      second.output,
      input.sources,
      [...input.missingSourceIds],
      input.explanationLanguage,
    );
    return { output: second.output, first: false };
  }
  const plan = quality?.classPartMinutes
    ? planLessonParts(data.sources, quality.classPartMinutes, data.missingSourceIds)
    : null;
  try {
    let generated: Generated;
    let firstTry = true;
    if (plan) {
      const outputs: Generated[] = [];
      for (const part of plan) {
        const result = await lesson(generationInput(part.sources, part.missingSourceIds));
        outputs.push(result.output);
        firstTry &&= result.first;
      }
      generated = mergeLessonParts(outputs);
    } else {
      const result = await lesson(generationInput([...data.sources], data.missingSourceIds));
      generated = result.output;
      firstTry = result.first;
    }
    const validated = validateGeneratedKnowledge(
      generated,
      data.sources,
      [...data.missingSourceIds],
      data.explanationLanguage,
    );
    const { model: lessonModel } = finalizeGeneratedStudyPractice(
      normalizeGeneratedStudyModel(
        validated.model,
        data.sources.some((source) => source.kind === "audio"),
        data.lessonContext,
      ),
      validated.classified,
      data.learnerContext,
    );
    return { valid: true, firstTry, parts: plan?.length ?? 1, ...totals, model: lessonModel };
  } catch (error) {
    if (error instanceof BudgetStop) throw error;
    return {
      valid: false,
      firstTry: false,
      parts: plan?.length ?? 1,
      ...totals,
      error: errorCode(error),
    };
  }
}

export interface LessonMetrics {
  production: number;
  recognition: number;
  /** Share of sources with extracted text that the lesson cites, 0–100. */
  sourceCoveragePercent: number;
  /** Learning items per hour of transcribed speech; null without speech. */
  itemsPerSpeechHour: number | null;
}

export function lessonMetrics(model: KnowledgeModel, sources: readonly RunSource[]): LessonMetrics {
  const production = model.learningItems.filter((item) => item.study?.set === "production").length;
  const recognition = model.learningItems.filter(
    (item) => item.study?.set === "recognition",
  ).length;
  const withText = sources.filter((source) => source.blocks.some((block) => block.text.trim()));
  const cited = new Set(
    [
      ...model.summary,
      ...model.topics.flatMap((topic) => topic.claims),
      ...model.learningItems.map((item) => item.claim),
      ...model.homework,
      ...model.uncertainties,
    ].flatMap((claim) => claim.sourceRefs.map((ref) => ref.sourceId)),
  );
  for (const entry of model.coverage.sources ?? [])
    if (entry.status === "used") cited.add(entry.sourceId);
  const speechMinutes = measureLessonContent(sources, 3000).speechMinutes;
  return {
    production,
    recognition,
    sourceCoveragePercent: withText.length
      ? Math.round(
          (withText.filter((source) => cited.has(source.sourceId)).length / withText.length) * 100,
        )
      : 100,
    itemsPerSpeechHour: speechMinutes
      ? Math.round(((production + recognition) / (speechMinutes / 60)) * 10) / 10
      : null,
  };
}
