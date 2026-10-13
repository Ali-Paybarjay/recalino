import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "../../packages/core/node_modules/zod";

/**
 * D56 conservative merge of the D62 blind side-by-side reviews: critical issues are the union,
 * a required concept is taught only if every reviewer says so, scores are those of the reviewer
 * with the lowest five-score mean, and a lesson is acceptable when it is technically valid, has
 * no critical issue, teaches every required concept and has a mean of at least 3 of 4. Labels
 * are mapped to arms with key.json only after all reviews are written.
 *
 *   pnpm exec tsx tools/eval/lesson-quality-review-merge.ts <reviews-dir> <key.json> <out.json>
 */
const score = z.number().min(0).max(4);
const label = z.object({
  technicallyValid: z.boolean(),
  scores: z.object({
    correctness: score,
    grounding: score,
    coverage: score,
    learnerFit: score,
    clarityCardUsability: score,
    explanationLanguageQuality: score.optional(),
  }),
  criticalIssues: z.array(z.object({ category: z.string(), detail: z.string() })),
  requiredConcepts: z.array(
    z.object({ id: z.string(), adequatelyTaught: z.boolean(), evidence: z.string() }),
  ),
});
const review = z.object({
  reviewer: z.string(),
  cases: z.array(
    z.object({
      caseId: z.string(),
      labels: z.object({ A: label, B: label }),
      preference: z.enum(["A", "B", "tie"]),
      preferenceReason: z.string(),
    }),
  ),
});
const dimensions = [
  "correctness",
  "grounding",
  "coverage",
  "learnerFit",
  "clarityCardUsability",
] as const;
type Label = z.infer<typeof label>;
const mean = (entry: Label) =>
  dimensions.reduce((sum, dimension) => sum + entry.scores[dimension], 0) / dimensions.length;

const [reviewsDir, keyPath, outPath] = process.argv.slice(2);
if (!reviewsDir || !keyPath || !outPath) throw new Error("usage: <reviews-dir> <key.json> <out>");
const reviews = await Promise.all(
  (await readdir(reviewsDir))
    .filter((file) => file.endsWith(".json"))
    .map(async (file) =>
      review.parse(JSON.parse(await readFile(resolve(reviewsDir, file), "utf8"))),
    ),
);
const key = z
  .record(z.string(), z.object({ A: z.string(), B: z.string() }))
  .parse(JSON.parse(await readFile(keyPath, "utf8")));
const caseIds = [...new Set(reviews.flatMap((entry) => entry.cases.map((item) => item.caseId)))];
const rows = caseIds.map((caseId) => {
  const graded = reviews.flatMap((entry) =>
    entry.cases
      .filter((item) => item.caseId === caseId)
      .map((item) => ({ reviewer: entry.reviewer, item })),
  );
  const arms = Object.fromEntries(
    (["A", "B"] as const).map((letter) => {
      const labels = graded.map(({ item }) => item.labels[letter]);
      const lowest = [...labels].sort((left, right) => mean(left) - mean(right))[0] as Label;
      const critical = labels.flatMap((entry) => entry.criticalIssues);
      const conceptIds = [
        ...new Set(labels.flatMap((entry) => entry.requiredConcepts.map((c) => c.id))),
      ];
      const taught = conceptIds.filter((id) =>
        labels.every((entry) => entry.requiredConcepts.find((c) => c.id === id)?.adequatelyTaught),
      );
      const valid = labels.every((entry) => entry.technicallyValid);
      const merged = {
        valid,
        mean: Math.round(mean(lowest) * 100) / 100,
        explanationLanguageQuality: Math.min(
          ...labels.map((entry) => entry.scores.explanationLanguageQuality ?? 4),
        ),
        criticalIssues: critical,
        conceptsTaught: `${taught.length}/${conceptIds.length}`,
        acceptable:
          valid &&
          critical.length === 0 &&
          taught.length === conceptIds.length &&
          mean(lowest) >= 3,
      };
      const arm = key[caseId]?.[letter];
      if (!arm) throw new Error(`key_missing:${caseId}`);
      return [arm, merged];
    }),
  );
  const preferences = graded.map(({ reviewer, item }) => ({
    reviewer,
    prefers: item.preference === "tie" ? "tie" : (key[caseId]?.[item.preference] ?? "unknown"),
    reason: item.preferenceReason,
  }));
  return { caseId, reviewers: graded.length, ...arms, preferences };
});
const holdout = rows.filter((row) => !row.caseId.startsWith("LQ-"));
const summary = (arm: "production" | "candidate") => {
  const entries = holdout.map(
    (row) =>
      (
        row as unknown as Record<
          string,
          { acceptable: boolean; mean: number; criticalIssues: unknown[] }
        >
      )[arm],
  );
  return {
    acceptable: entries.filter((entry) => entry?.acceptable).length,
    of: entries.length,
    meanScore:
      Math.round(
        (entries.reduce((sum, entry) => sum + (entry?.mean ?? 0), 0) / entries.length) * 100,
      ) / 100,
    withCriticalIssues: entries.filter((entry) => entry?.criticalIssues.length).length,
  };
};
const votes = holdout.flatMap((row) => row.preferences.map((entry) => entry.prefers));
const result = {
  method:
    "D56 conservative merge: union of critical issues, concept taught only if every reviewer agrees, scores of the lowest-mean reviewer, acceptable = valid + no critical issue + all concepts + mean >= 3",
  holdout: {
    production: summary("production"),
    candidate: summary("candidate"),
    preferenceVotes: {
      candidate: votes.filter((vote) => vote === "candidate").length,
      production: votes.filter((vote) => vote === "production").length,
      tie: votes.filter((vote) => vote === "tie").length,
    },
  },
  rows,
};
await writeFile(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.holdout, null, 2));
