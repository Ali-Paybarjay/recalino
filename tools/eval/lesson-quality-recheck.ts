import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { effectiveStructuredMaxOutputTokens } from "../../packages/core/src/aip";
import { normalizeGeneratedStudyModel } from "../../packages/core/src/lkm";
import { generatedKnowledgeSchema } from "../../packages/core/src/proc/generated-knowledge";
import { finalizeGeneratedStudyPractice } from "../../packages/core/src/proc/generated-study-practice";
import { buildKnowledgeGenerationInput } from "../../packages/core/src/proc/knowledge-generation";
import { mergeLessonParts, planLessonParts } from "../../packages/core/src/proc/knowledge-parts";
import { modelTeachingContext } from "../../packages/core/src/proc/learner-context";
import {
  LESSON_PRODUCTION_MAXIMUM,
  lessonBudget,
  lessonProductionLimit,
  measureLessonContent,
} from "../../packages/core/src/proc/lesson-budget";
import { sanitizeGeneratedStudyGaps } from "../../packages/core/src/proc/study-output-guard";
import { validateGeneratedKnowledge } from "../../packages/core/src/proc/worker";
import { lessonMetrics, lessonQualityArms } from "./lesson-quality-eval";
import { lessonQualityCases } from "./lesson-quality-fixtures";

/**
 * Offline, no provider call: re-assembles the saved D63 diagnostic responses with the current
 * code exactly as the worker would (same input, budget and coverage options), then merges the
 * parts and validates the whole lesson. Synthetic lesson only.
 *
 *   pnpm exec tsx tools/eval/lesson-quality-recheck.ts [dir]
 */
const dir = resolve(process.argv[2] ?? "artifacts/verification/feat-lesson-quality/d63-diagnostic");
const config = JSON.parse(await readFile("config/openrouter-defaults.json", "utf8"));
const { candidate } = lessonQualityArms(config);
const long = lessonQualityCases().find((entry) => entry.id === "LQ-LONG-128");
if (!long) throw new Error("fixture_missing");
const parts = planLessonParts(long.data.sources, 90, long.data.missingSourceIds);
if (!parts) throw new Error("parts_missing");
const outputTokens = effectiveStructuredMaxOutputTokens(candidate, candidate.llmModel);
const { learnerContext: snapshot, ...rest } = long.data;
const teaching = modelTeachingContext(snapshot, []);
type Generated = Parameters<typeof validateGeneratedKnowledge>[0];
const outcomes: Record<string, unknown>[] = [];
const accepted: Generated[] = [];
const fieldOf = (error: unknown) =>
  JSON.stringify(
    (error as { details?: { fields?: { output?: unknown } } }).details?.fields?.output ??
      (error as Error).message,
  );
for (const part of parts) {
  const raw = JSON.parse(await readFile(resolve(dir, `part-${part.index}-response.json`), "utf8"));
  const budget = lessonBudget(
    outputTokens,
    measureLessonContent(part.sources, candidate.charactersPerPage),
  );
  const prepared = buildKnowledgeGenerationInput(
    {
      ...rest,
      sources: part.sources,
      missingSourceIds: part.missingSourceIds,
      ...(teaching ? { learnerContext: teaching } : {}),
    },
    candidate.maxInputCharacters,
    {
      maxOutputTokens: outputTokens,
      budget,
      sourceCoverage: candidate.lessonQuality?.sourceCoverage ?? false,
    },
  );
  let guardGapsRebuilt: { spacing: number; derivedBlank: number } | undefined;
  try {
    // As generateCanonicalKnowledge: assembly first, then the worker's semantic validation.
    const output = generatedKnowledgeSchema.parse(prepared.assemble(raw));
    // D110: the gaps the guard would rebuild, counted apart from the strict result below.
    const would = sanitizeGeneratedStudyGaps(output);
    guardGapsRebuilt = { spacing: would.spacing, derivedBlank: would.derivedBlank };
    // D110: strict, as the model wrote it: no gap is rebuilt and no card is dropped.
    validateGeneratedKnowledge(
      output,
      part.sources,
      [...part.missingSourceIds],
      long.data.explanationLanguage,
      { productionLimit: lessonProductionLimit(budget.content.markedSpans) },
    );
    accepted.push(output);
    outcomes.push({
      part: part.index,
      outcome: "valid",
      items: output.learningItems.length,
      guardGapsRebuilt,
    });
  } catch (error) {
    outcomes.push({
      part: part.index,
      outcome: `rejected:${fieldOf(error)}`,
      ...(guardGapsRebuilt ? { guardGapsRebuilt } : {}),
    });
  }
}
let merged: Record<string, unknown> | null = null;
if (accepted.length === parts.length) {
  try {
    const validated = validateGeneratedKnowledge(
      mergeLessonParts(accepted),
      long.data.sources,
      [...long.data.missingSourceIds],
      long.data.explanationLanguage,
      { productionLimit: LESSON_PRODUCTION_MAXIMUM },
    );
    const { model } = finalizeGeneratedStudyPractice(
      normalizeGeneratedStudyModel(validated.model, true, long.data.lessonContext),
      validated.classified,
      snapshot,
    );
    await writeFile(resolve(dir, "merged-lesson.json"), JSON.stringify(model, null, 2));
    merged = {
      outcome: "valid",
      items: model.learningItems.map((item) => `${item.study?.set ?? item.kind}: ${item.front}`),
      metrics: lessonMetrics(model, long.data.sources),
    };
  } catch (error) {
    merged = { outcome: `rejected:${fieldOf(error)}` };
  }
}
const result = { date: new Date().toISOString(), parts: outcomes, merged };
await writeFile(resolve(dir, "recheck.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
