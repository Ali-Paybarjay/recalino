import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "../../packages/core/node_modules/zod";
import {
  type AiProvider,
  effectiveStructuredMaxOutputTokens,
  OpenRouterProvider,
  ProviderError,
  type StructuredInput,
} from "../../packages/core/src/aip";
import { normalizeGeneratedStudyModel } from "../../packages/core/src/lkm";
import { finalizeGeneratedStudyPractice } from "../../packages/core/src/proc/generated-study-practice";
import { buildKnowledgeGenerationInput } from "../../packages/core/src/proc/knowledge-generation";
import { generateCanonicalKnowledge } from "../../packages/core/src/proc/knowledge-generation-step";
import { mergeLessonParts, planLessonParts } from "../../packages/core/src/proc/knowledge-parts";
import { modelTeachingContext } from "../../packages/core/src/proc/learner-context";
import { lessonBudget, measureLessonContent } from "../../packages/core/src/proc/lesson-budget";
import { validateGeneratedKnowledge } from "../../packages/core/src/proc/worker";
import {
  BudgetGuard,
  BudgetStop,
  lessonMetrics,
  lessonQualityArms,
  worstCaseMicros,
} from "./lesson-quality-eval";
import { lessonQualityCases } from "./lesson-quality-fixtures";

/**
 * D63 diagnostic (owner decision 2026-10-13, D71; cap 0.50 USD): generates each part of the
 * synthetic 128-minute class exactly once with the candidate settings, as the worker would,
 * records the code-owned outcome and keeps every response (synthetic content only) so a fix can
 * be checked offline against the same response. When every part is valid, the parts are merged
 * and the whole lesson is validated, without another call.
 *
 *   pnpm exec tsx tools/eval/lesson-quality-diagnose.ts --run-live [--parts 0,1]
 *     [--already-spent-usd 0] [--out DIR]
 */
const HARD_CAP_USD = 0.5;
const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
if (!process.argv.includes("--run-live")) {
  console.log("Dry run only. Add --run-live to dispatch paid requests (cap 0.50 USD).");
  process.exit(0);
}
const alreadySpent = Number(option("--already-spent-usd", "0"));
if (!(alreadySpent >= 0)) throw new Error("already_spent_invalid");
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("openrouter_key_missing");
const out = resolve(
  option("--out", "artifacts/verification/feat-lesson-quality/d63-diagnostic") ?? "",
);
await mkdir(out, { recursive: true });
const config = JSON.parse(await readFile("config/openrouter-defaults.json", "utf8"));
const { candidate } = lessonQualityArms(config);
const long = lessonQualityCases().find((entry) => entry.id === "LQ-LONG-128");
if (!long) throw new Error("fixture_missing");
const parts = planLessonParts(long.data.sources, 90, long.data.missingSourceIds);
if (!parts) throw new Error("parts_missing");
const selected = (option("--parts") ?? parts.map((part) => part.index).join(","))
  .split(",")
  .map(Number);
const guard = new BudgetGuard(
  Math.floor(HARD_CAP_USD * 1_000_000),
  Math.round(alreadySpent * 1_000_000),
);
const model = candidate.llmModel;
const outputTokens = effectiveStructuredMaxOutputTokens(candidate, model);
const { learnerContext: snapshot, ...rest } = long.data;
const teaching = modelTeachingContext(snapshot, []);

type Generated = Parameters<typeof validateGeneratedKnowledge>[0];
const report: Record<string, unknown>[] = [];
const accepted = new Map<number, Generated>();
let stopped: string | null = null;
for (const index of selected) {
  const part = parts[index];
  if (!part) throw new Error(`part_missing:${index}`);
  const input = {
    ...rest,
    sources: part.sources,
    missingSourceIds: part.missingSourceIds,
    ...(teaching ? { learnerContext: teaching } : {}),
  };
  const budget = lessonBudget(
    outputTokens,
    measureLessonContent(part.sources, candidate.charactersPerPage),
  );
  const prepared = buildKnowledgeGenerationInput(input, candidate.maxInputCharacters, {
    maxOutputTokens: outputTokens,
    budget,
    sourceCoverage: candidate.lessonQuality?.sourceCoverage ?? false,
  });
  const worst = worstCaseMicros(
    candidate,
    Array.from(prepared.system + prepared.input + JSON.stringify(z.toJSONSchema(prepared.schema)))
      .length,
  );
  try {
    guard.reserve(worst);
  } catch (error) {
    if (!(error instanceof BudgetStop)) throw error;
    stopped = `before part ${index}: spent ${guard.spentMicros / 1e6} + worst ${worst / 1e6} > ${HARD_CAP_USD}`;
    break;
  }
  let raw: unknown;
  const real = new OpenRouterProvider(key, candidate);
  // Keeps the provider's parsed response of this call; nothing else about the call changes.
  const capturing: AiProvider = {
    name: real.name,
    mode: real.mode,
    settings: real.settings,
    async structured<T>(request: StructuredInput<T>) {
      const response = await real.structured(request);
      raw = response.output;
      return response;
    },
    transcribe: (request) => real.transcribe(request),
    speech: (request) => real.speech(request),
  };
  const started = Date.now();
  const entry: Record<string, unknown> = {
    part: index,
    sources: part.sources.map((source) => ({ kind: source.kind, blocks: source.blocks.length })),
    budget: {
      production: budget.production,
      recognition: budget.recognition,
      compact: budget.compact,
      content: budget.content,
    },
    worstCaseUsd: worst / 1e6,
  };
  try {
    const result = await generateCanonicalKnowledge(
      capturing,
      model,
      `lq-d63-diagnose:part-${index}`,
      prepared,
    );
    guard.record(result.actualMicros, worst);
    Object.assign(entry, {
      costUsd: (result.actualMicros ?? worst) / 1e6,
      outputTokens: result.usage.outputTokens ?? null,
      latencyMs: Date.now() - started,
    });
    try {
      validateGeneratedKnowledge(
        result.output,
        part.sources,
        [...part.missingSourceIds],
        long.data.explanationLanguage,
      );
      entry.outcome = "valid";
      accepted.set(index, result.output);
      await writeFile(
        resolve(out, `part-${index}-accepted.json`),
        JSON.stringify(result.output, null, 2),
      );
    } catch (error) {
      const fields = (error as { details?: { fields?: { output?: unknown } } }).details?.fields;
      entry.outcome = `semantic:${JSON.stringify(fields?.output ?? (error as Error).message)}`;
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    guard.record(error.accounting ? error.accounting.actualMicros : null, worst);
    Object.assign(entry, {
      costUsd: (error.accounting?.actualMicros ?? worst) / 1e6,
      outputTokens: error.accounting?.usage.outputTokens ?? null,
      latencyMs: Date.now() - started,
      outcome: `${error.code}${error.diagnostic ? `:${error.diagnostic}` : ""}`,
    });
  }
  // Synthetic lesson only: the exact response, kept for offline diagnosis of the outcome.
  if (raw !== undefined)
    await writeFile(resolve(out, `part-${index}-response.json`), JSON.stringify(raw, null, 2));
  report.push(entry);
  console.log(`part ${index}: ${entry.outcome}, total ${guard.spentMicros / 1e6} USD`);
}

let merged: Record<string, unknown> | null = null;
if (parts.every((part) => accepted.has(part.index))) {
  try {
    const whole = mergeLessonParts(parts.map((part) => accepted.get(part.index) as Generated));
    const validated = validateGeneratedKnowledge(
      whole,
      long.data.sources,
      [...long.data.missingSourceIds],
      long.data.explanationLanguage,
    );
    const { model: lesson } = finalizeGeneratedStudyPractice(
      normalizeGeneratedStudyModel(validated.model, true, long.data.lessonContext),
      validated.classified,
      snapshot,
    );
    await writeFile(resolve(out, "merged-lesson.json"), JSON.stringify(lesson, null, 2));
    merged = { outcome: "valid", metrics: lessonMetrics(lesson, long.data.sources) };
  } catch (error) {
    const fields = (error as { details?: { fields?: { output?: unknown } } }).details?.fields;
    merged = { outcome: `invalid:${JSON.stringify(fields?.output ?? (error as Error).message)}` };
  }
}
const summary = {
  date: new Date().toISOString(),
  capUsd: HARD_CAP_USD,
  totalSpentUsd: guard.spentMicros / 1e6,
  calls: guard.calls,
  stopped,
  parts: report,
  merged,
};
await writeFile(resolve(out, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
