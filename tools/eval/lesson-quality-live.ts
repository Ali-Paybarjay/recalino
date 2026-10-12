import { randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenRouterProvider } from "../../packages/core/src/aip";
import type { KnowledgeModel } from "../../packages/core/src/lkm";
import { migrationInputData } from "./haiku55-migration-fixtures";
import { migrationAutomaticGoldChecks } from "./haiku55-migration-gold";
import {
  type ArmResult,
  BudgetGuard,
  BudgetStop,
  generateArmLesson,
  type LessonData,
  lessonMetrics,
  lessonQualityArms,
} from "./lesson-quality-eval";
import { lessonQualityCases } from "./lesson-quality-fixtures";
import { holdout5MigrationFixtures, holdout5RepeatIds } from "./multilingual-holdout5-fixtures";

/**
 * D62 paid live evaluation (owner decision 2026-10-12, cap 1.50 USD in total). Runs the 14-lesson
 * synthetic holdout-5 schedule (12 lessons, S03 and S10 twice) on the D56 production settings and
 * the lesson-quality candidate, then the synthetic D63 long class and board-photo lessons while
 * the cap allows. Writes blinded A/B packets for the D56 side-by-side review; the arm key is in
 * key.json, which reviewers never read.
 *
 *   node tools/eval/lesson-quality-live.ts --run-live [--out DIR] [--cap-usd 1.5]
 *
 * OPENROUTER_API_KEY comes from the environment and is never printed or written.
 */
const HARD_CAP_USD = 1.5;
const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
if (!process.argv.includes("--run-live")) {
  console.log("Dry run only. Add --run-live to dispatch paid requests (cap 1.50 USD).");
  process.exit(0);
}
const capUsd = Math.min(HARD_CAP_USD, Number(option("--cap-usd", String(HARD_CAP_USD))));
if (!(capUsd > 0)) throw new Error("invalid_cap");
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("openrouter_key_missing");
const out = resolve(option("--out", "artifacts/verification/feat-lesson-quality/d62-eval") ?? "");
const config = JSON.parse(await readFile("config/openrouter-defaults.json", "utf8"));
const arms = lessonQualityArms(config);
const candidateParts = {
  ...arms.candidate,
  lessonQuality: { ...(arms.candidate.lessonQuality ?? ({} as never)), classPartMinutes: 90 },
};
const guard = new BudgetGuard(Math.floor(capUsd * 1_000_000));

const holdout = holdout5MigrationFixtures();
const schedule: { caseId: string; data: LessonData; fixture?: (typeof holdout)[number] }[] = [
  ...holdout,
  ...holdout.filter((fixture) => (holdout5RepeatIds as readonly string[]).includes(fixture.id)),
].map((fixture, index) => ({
  caseId: index < holdout.length ? fixture.id : `${fixture.id}-repeat`,
  data: migrationInputData(fixture) as LessonData,
  fixture,
}));
for (const extra of lessonQualityCases()) schedule.push({ caseId: extra.id, data: extra.data });

type Row = {
  caseId: string;
  arm: "production" | "candidate";
  result: Omit<ArmResult, "model">;
  metrics?: ReturnType<typeof lessonMetrics>;
  goldPassed?: number;
  goldTotal?: number;
};
const rows: Row[] = [];
const keyFile: Record<string, { A: string; B: string }> = {};
await mkdir(resolve(out, "blind"), { recursive: true });
await mkdir(resolve(out, "lessons"), { recursive: true });
let stopped: string | null = null;

const reviewable = (model: KnowledgeModel) => ({
  title: model.title,
  learningItems: model.learningItems.map((item) => ({
    kind: item.kind,
    front: item.front,
    back: item.back,
    claim: item.claim.text,
    origin: item.claim.origin,
    study: item.study,
  })),
  summary: model.summary.map((claim) => claim.text),
  topics: model.topics.map((topic) => ({
    title: topic.title,
    claims: topic.claims.map((c) => c.text),
  })),
  homework: model.homework.map((claim) => claim.text),
  uncertainties: model.uncertainties.map((claim) => claim.text),
  classNotes: model.classNotes,
});

for (const entry of schedule) {
  const results: Partial<Record<"production" | "candidate", ArmResult>> = {};
  const long = entry.caseId === "LQ-LONG-128";
  try {
    for (const arm of ["production", "candidate"] as const) {
      const settings =
        arm === "candidate" ? (long ? candidateParts : arms.candidate) : arms.production;
      const provider = new OpenRouterProvider(key, settings);
      const result = await generateArmLesson(
        provider,
        entry.data,
        guard,
        `lq-eval:${entry.caseId}:${arm}`,
      );
      results[arm] = result;
      const { model, ...rest } = result;
      const gold = model && entry.fixture ? migrationAutomaticGoldChecks(entry.fixture, model) : [];
      rows.push({
        caseId: entry.caseId,
        arm,
        result: rest,
        ...(model ? { metrics: lessonMetrics(model, entry.data.sources) } : {}),
        ...(entry.fixture
          ? { goldPassed: gold.filter((check) => check.passed).length, goldTotal: gold.length }
          : {}),
      });
      if (model)
        await writeFile(
          resolve(out, "lessons", `${entry.caseId}-${arm}.json`),
          JSON.stringify(model, null, 2),
        );
      console.log(
        `${entry.caseId} ${arm}: ${result.valid ? "valid" : `invalid (${result.error})`}, spent ${(guard.spentMicros / 1e6).toFixed(4)} USD`,
      );
    }
  } catch (error) {
    if (!(error instanceof BudgetStop)) throw error;
    stopped = entry.caseId;
    console.log(`Stopped before ${entry.caseId}: the next call could pass the ${capUsd} USD cap.`);
    break;
  }
  const production = results.production?.model;
  const candidate = results.candidate?.model;
  // Blind packet: the arm order is random and recorded only in key.json.
  const candidateFirst = randomInt(2) === 1;
  keyFile[entry.caseId] = candidateFirst
    ? { A: "candidate", B: "production" }
    : { A: "production", B: "candidate" };
  await writeFile(
    resolve(out, "blind", `${entry.caseId}.json`),
    JSON.stringify(
      {
        caseId: entry.caseId,
        explanationLanguage: entry.data.explanationLanguage,
        learner: entry.data.learnerContext,
        sources: entry.data.sources.map((source) => ({
          kind: source.kind,
          role: source.role,
          blocks: source.blocks.map((block) => ({
            text: block.text,
            ...(block.layout ? { layout: block.layout } : {}),
          })),
        })),
        A: (candidateFirst ? candidate : production)
          ? reviewable((candidateFirst ? candidate : production) as KnowledgeModel)
          : "NO VALID LESSON",
        B: (candidateFirst ? production : candidate)
          ? reviewable((candidateFirst ? production : candidate) as KnowledgeModel)
          : "NO VALID LESSON",
      },
      null,
      2,
    ),
  );
}
await writeFile(resolve(out, "key.json"), JSON.stringify(keyFile, null, 2));
await writeFile(
  resolve(out, "results.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      capUsd,
      spentUsd: guard.spentMicros / 1e6,
      calls: guard.calls,
      stoppedBefore: stopped,
      production: arms.production.version,
      candidate: `${arms.candidate.version} (${arms.candidate.promptVersion})`,
      rows,
    },
    null,
    2,
  ),
);
console.log(`Done: ${(guard.spentMicros / 1e6).toFixed(4)} USD in ${guard.calls} calls.`);
