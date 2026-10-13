import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenRouterProvider } from "../../packages/core/src/aip";
import { planLessonParts } from "../../packages/core/src/proc/knowledge-parts";
import {
  BudgetGuard,
  BudgetStop,
  generateArmLesson,
  lessonQualityArms,
} from "./lesson-quality-eval";
import { lessonQualityCases } from "./lesson-quality-fixtures";

/**
 * One paid diagnostic generation of a single part of the synthetic D63 long class, under the
 * same total cap as the D62 evaluation: the earlier run's actual spend is carried in, and at
 * most --max-calls requests are dispatched. Records only code-owned outcomes.
 *
 *   pnpm exec tsx tools/eval/lesson-quality-diagnose.ts --run-live --part 1 \
 *     --already-spent-usd 1.214859 [--max-calls 1]
 */
const HARD_CAP_USD = 1.5;
const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
if (!process.argv.includes("--run-live")) {
  console.log("Dry run only. Add --run-live to dispatch one paid request.");
  process.exit(0);
}
const alreadySpent = Number(option("--already-spent-usd"));
if (!(alreadySpent >= 0)) throw new Error("already_spent_required");
const partIndex = Number(option("--part", "1"));
const maxCalls = Number(option("--max-calls", "1"));
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("openrouter_key_missing");
const config = JSON.parse(await readFile("config/openrouter-defaults.json", "utf8"));
const { candidate } = lessonQualityArms(config);
const long = lessonQualityCases().find((entry) => entry.id === "LQ-LONG-128");
if (!long) throw new Error("fixture_missing");
const part = planLessonParts(long.data.sources, 90, long.data.missingSourceIds)?.[partIndex];
if (!part) throw new Error("part_missing");
const guard = new BudgetGuard(
  Math.floor(HARD_CAP_USD * 1_000_000),
  Math.round(alreadySpent * 1_000_000),
  maxCalls,
);
let stopped = false;
let result: Awaited<ReturnType<typeof generateArmLesson>> | undefined;
try {
  result = await generateArmLesson(
    new OpenRouterProvider(key, candidate),
    { ...long.data, sources: part.sources, missingSourceIds: part.missingSourceIds },
    guard,
    `lq-diagnose:part-${partIndex}`,
  );
} catch (error) {
  if (!(error instanceof BudgetStop)) throw error;
  stopped = true;
}
const { model: _model, ...summary } = result ?? {};
const out = resolve("artifacts/verification/feat-lesson-quality/d62-eval");
await mkdir(out, { recursive: true });
const report = {
  date: new Date().toISOString(),
  part: partIndex,
  sources: part.sources.map((source) => ({ kind: source.kind, blocks: source.blocks.length })),
  totalSpentUsd: guard.spentMicros / 1e6,
  callsThisRun: guard.calls,
  stoppedByCapOrCallLimit: stopped,
  outcomes: guard.outcomes,
  result: summary,
};
await writeFile(resolve(out, `diagnose-part-${partIndex}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
