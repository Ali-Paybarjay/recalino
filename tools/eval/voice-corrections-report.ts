import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  blindOrder,
  classifySuggestion,
  type MergedSuggestionVerdict,
  type ModelSuggestion,
  mergeSuggestionVerdicts,
  percentile,
  reviewSchema,
  type SuggestionClass,
  utteranceLabel,
  type VoiceReview,
  voiceEvalCandidates,
} from "./voice-corrections-eval";
import {
  type BuiltVoiceCase,
  buildVoiceCase,
  type SpeakerKey,
  voiceCorrectionFixtures,
} from "./voice-corrections-fixtures";

/**
 * Usage:
 *   pnpm exec tsx tools/eval/voice-corrections-report.ts export --run <run dir> --blind <dir>
 *   pnpm exec tsx tools/eval/voice-corrections-report.ts merge --run <run dir> --reviews <dir>
 * The blind packets carry no model, provider, cost or latency; the key stays in the run dir.
 */
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const runDirectory = option("--run");
assert.ok(runDirectory, "Pass --run <artifacts/verification/voice-corrections-eval/<freeze>>");
const run = resolve(runDirectory);

type Http = {
  state: string;
  httpStatus?: number;
  latencyMs?: number;
  costUsd?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  responseFormat: string;
  operationKey: string;
  endpointProvider?: string;
  finishReason?: string | null;
};
type Attempt = {
  attempt: number;
  outcome: string;
  uncertain: boolean;
  http: Http[];
  rawOutput?: unknown;
  rawSuggestions: ModelSuggestion[];
  shown?: Record<string, Omit<ModelSuggestion, "speakerId">[]>;
  diagnostics: string[];
};
type State = {
  freeze: string;
  hardUsd: number;
  spentUsd: number;
  uncertainUsd: number;
  stopped: boolean;
  pairs: Record<string, { status: string; attempts: Attempt[] }>;
};
const state = JSON.parse(await readFile(resolve(run, "state.json"), "utf8")) as State;
const cases = new Map(
  voiceCorrectionFixtures.map((fixture) => [fixture.id, buildVoiceCase(fixture)] as const),
);
const roles: Record<SpeakerKey, string> = {
  T: "Teacher",
  A: "Learner A",
  B: "Learner B",
  C: "Learner C",
};
const languageNames = {
  fa: "Persian",
  ar: "Arabic",
  es: "Spanish",
  ja: "Japanese",
  uk: "Ukrainian",
};

/** The output a learner would get: the first valid attempt, else the last answer received. */
function finalAttempt(attempts: Attempt[]) {
  return attempts.find((item) => item.outcome === "valid") ?? attempts.at(-1);
}
const shownKey = (item: { utteranceId: string; said: string }) =>
  `${item.utteranceId}\u0000${item.said.replaceAll("**", "").replace(/\s+/g, " ").trim()}`;
function suggestionsOf(built: BuiltVoiceCase, attempt: Attempt | undefined) {
  if (!attempt) return [];
  const shown = new Set(
    Object.values(attempt.shown ?? {})
      .flat()
      .map(shownKey),
  );
  return attempt.rawSuggestions.map((suggestion, index) => ({
    index,
    suggestion,
    shown: attempt.outcome === "valid" && shown.has(shownKey(suggestion)),
    gold: classifySuggestion(built, suggestion),
  }));
}
const speakerOf = (built: BuiltVoiceCase, speakerId: string) =>
  (Object.entries(built.speakerIds).find(([, id]) => id === speakerId)?.[0] ?? "?") as SpeakerKey;

if (command === "export") {
  const blind = option("--blind");
  assert.ok(blind, "Pass --blind <directory outside the run>");
  const seed = state.freeze;
  const key: Record<string, Record<string, string>> = {};
  for (const language of ["fa", "ar", "es", "ja", "uk"] as const) {
    const lines: string[] = [
      `# Blind review packet: spoken-mistake suggestions, explanation language ${languageNames[language]} (\`${language}\`)`,
      "",
      "Every class below is synthetic. Two anonymous systems, X and Y, read the same transcript and suggested corrections of learners' spoken English. The label order is random per class.",
      "",
    ];
    for (const built of [...cases.values()].filter((item) => item.fixture.language === language)) {
      const order = blindOrder(seed, built.fixture.id);
      key[built.fixture.id] = { X: order[0], Y: order[1] };
      const label = (utteranceId: string) => {
        const found = built.utterances.find((item) => item.id === utteranceId);
        return found ? utteranceLabel(found) : "unknown utterance";
      };
      lines.push(`## Class ${built.fixture.id} (${built.fixture.topic})`, "");
      lines.push("### Transcript (what both systems received)", "");
      for (const utterance of built.utterances)
        lines.push(
          `- ${utteranceLabel(utterance)} · ${roles[utterance.speaker]} · ${utterance.text}`,
        );
      lines.push("", "### Answer key", "");
      if (built.fixture.referenceTexts.length)
        lines.push(`Handout: ${built.fixture.referenceTexts.join(" / ")}`, "");
      for (const error of built.fixture.errors) {
        const where = built.utterances
          .filter((item) => item.mark?.e === error.id)
          .map(utteranceLabel)
          .join(", ");
        lines.push(
          `- Planted error ${error.id} (${roles[error.speaker]}, ${where}): "${error.anchor}" → "${error.correction}" (${error.kind}; ${error.note})`,
        );
      }
      for (const trap of built.fixture.traps) {
        const where = built.utterances
          .filter((item) => item.mark?.k === trap.id)
          .map(utteranceLabel)
          .join(", ");
        lines.push(`- Correct on purpose ${trap.id} (${where}): "${trap.anchor}" — ${trap.note}`);
      }
      const distractors = built.utterances.filter((item) => item.mark?.d);
      if (distractors.length)
        lines.push(
          `- Not the speaker's own error: ${distractors.map((item) => `${utteranceLabel(item)} ${item.mark?.d}`).join("; ")}`,
        );
      lines.push(
        "- Every other line is meant to be correct, natural spoken English. If you find a real error there, a suggestion about it is a genuine catch.",
        "",
      );
      for (const [blindLabel, candidateId] of [
        ["X", order[0]],
        ["Y", order[1]],
      ] as const) {
        const pair = state.pairs[`${built.fixture.id}:${candidateId}`];
        const attempt = pair ? finalAttempt(pair.attempts) : undefined;
        lines.push(`### Output ${blindLabel}`, "");
        if (!attempt || (attempt.outcome !== "valid" && !attempt.rawSuggestions.length)) {
          lines.push(
            `No usable answer (technical failure: ${attempt?.outcome ?? "not run"}). Nothing is shown to the learner. Review only output-level issues.`,
            "",
          );
          continue;
        }
        if (attempt.outcome !== "valid")
          lines.push(
            `The answer failed the product's evidence checks (${attempt.outcome}); none of these suggestions is shown to the learner. Review them anyway.`,
            "",
          );
        const items = suggestionsOf(built, attempt);
        if (!items.length) lines.push("No suggestions at all.", "");
        for (const item of items) {
          const id = `${blindLabel}${item.index + 1}`;
          lines.push(
            `- **${id}** · ${label(item.suggestion.utteranceId)} · ${roles[speakerOf(built, item.suggestion.speakerId)]} · shown to learner: ${item.shown ? "yes" : "no"}`,
            `  - said: ${JSON.stringify(item.suggestion.said)}`,
            `  - correct: ${JSON.stringify(item.suggestion.correct)}`,
            `  - kind: ${item.suggestion.kind}`,
            `  - explanation: ${item.suggestion.whyFa}`,
          );
        }
        lines.push("");
      }
    }
    await mkdir(resolve(blind), { recursive: true });
    await writeFile(resolve(blind, `voice-review-${language}.md`), `${lines.join("\n")}\n`);
  }
  await writeFile(resolve(run, "blind-key.json"), `${JSON.stringify({ seed, key }, null, 2)}\n`);
  process.stdout.write(`blind packets written to ${resolve(blind)}\n`);
  process.exit(0);
}

assert.equal(command, "merge", "Command is export or merge");
const reviewsDirectory = option("--reviews");
assert.ok(reviewsDirectory, "Pass --reviews <directory of grader JSON files>");
const { key } = JSON.parse(await readFile(resolve(run, "blind-key.json"), "utf8")) as {
  key: Record<string, Record<"X" | "Y", string>>;
};
const reviews: VoiceReview[] = [];
for (const name of (await readdir(resolve(reviewsDirectory))).filter((file) =>
  file.endsWith(".json"),
))
  reviews.push(
    reviewSchema.parse(JSON.parse(await readFile(resolve(reviewsDirectory, name), "utf8"))),
  );
const productionRevalidation = await readFile(resolve(run, "production-revalidation.json"), "utf8")
  .then(
    (text) =>
      JSON.parse(text) as Record<
        string,
        { firstAttemptValid: boolean; final: { production: string; shown?: number } | null }
      >,
  )
  .catch(() => undefined);

type PairResult = ReturnType<typeof scorePair>;
function scorePair(built: BuiltVoiceCase, candidateId: string) {
  const id = `${built.fixture.id}:${candidateId}`;
  const pair = state.pairs[id];
  assert.ok(pair && pair.status === "done", `${id} did not finish`);
  const attempts = pair.attempts;
  const attempt = finalAttempt(attempts);
  const blindLabel = (Object.entries(key[built.fixture.id] ?? {}).find(
    ([, value]) => value === candidateId,
  )?.[0] ?? "?") as "X" | "Y";
  const graderOutputs = reviews.flatMap((review) =>
    review.cases
      .filter((item) => item.caseId === built.fixture.id)
      .flatMap((item) => item.outputs.filter((output) => output.label === blindLabel)),
  );
  assert.ok(graderOutputs.length >= 2, `${id} needs two independent reviews`);
  const items = suggestionsOf(built, attempt).map((item) => {
    const suggestionId = `${blindLabel}${item.index + 1}`;
    const verdicts = graderOutputs.map((output) => {
      const found = output.suggestions.find((entry) => entry.id === suggestionId);
      assert.ok(found, `${id} ${suggestionId} was not reviewed by every grader`);
      return found;
    });
    const merged: MergedSuggestionVerdict = mergeSuggestionVerdicts(verdicts);
    // Gold decides planted errors, traps and distractors; any other flag is real only if every
    // grader says so.
    const falseCorrection =
      item.gold.type === "trap" ||
      item.gold.type === "distractor" ||
      item.gold.type === "unknown_utterance" ||
      (item.gold.type === "other" && !merged.genuineLearnerError);
    const critical = new Set(merged.critical);
    if (falseCorrection) critical.add("false_correction");
    return { ...item, suggestionId, merged, falseCorrection, critical: [...critical].sort() };
  });
  const shown = items.filter((item) => item.shown);
  const plantedIds = built.fixture.errors.map((error) => error.id);
  // The teacher names some planted errors aloud; those are easier, so recall is also split.
  const teacherNamed = new Set(
    built.fixture.errors
      .filter((error) =>
        built.utterances.some(
          (utterance) =>
            utterance.mark?.d === "teacher_meta" && utterance.text.includes(error.anchor),
        ),
      )
      .map((error) => error.id),
  );
  const plantedShown = new Set(
    shown.flatMap((item) => (item.gold.type === "planted" ? [item.gold.errorId] : [])),
  );
  const plantedRaw = new Set(
    items.flatMap((item) => (item.gold.type === "planted" ? [item.gold.errorId] : [])),
  );
  const outputCritical = [
    ...new Set(graderOutputs.flatMap((output) => output.outputCritical)),
  ].sort();
  const shownCritical = [
    ...new Set([...shown.flatMap((item) => item.critical), ...outputCritical]),
  ].sort();
  const overallScores = graderOutputs.flatMap((output) =>
    output.overall === null ? [] : [output.overall],
  );
  const http = attempts.flatMap((item) => item.http);
  const plantedShownItems = shown.filter((item) => item.gold.type === "planted");
  return {
    caseId: built.fixture.id,
    language: built.fixture.language,
    candidateId,
    attempts: attempts.map((item) => ({
      outcome: item.outcome,
      uncertain: item.uncertain,
      diagnostics: item.diagnostics,
    })),
    firstAttemptValid: attempts[0]?.outcome === "valid",
    finalValid: attempts.some((item) => item.outcome === "valid"),
    schemaValidAnswers: attempts.filter((item) =>
      ["valid", "voice_correction_evidence_invalid"].includes(item.outcome),
    ).length,
    answers: attempts.length,
    fallbacks: http.filter((item) => item.operationKey.endsWith(":json")).length,
    planted: plantedIds.length,
    plantedShown: plantedShown.size,
    plantedRaw: plantedRaw.size,
    missedShown: plantedIds.filter((errorId) => !plantedShown.has(errorId)),
    plantedUnnamed: plantedIds.filter((errorId) => !teacherNamed.has(errorId)).length,
    plantedUnnamedShown: plantedIds.filter(
      (errorId) => !teacherNamed.has(errorId) && plantedShown.has(errorId),
    ).length,
    shownSuggestions: shown.length,
    rawSuggestions: items.length,
    falseCorrectionsShown: shown.filter((item) => item.falseCorrection).length,
    falseCorrectionsShownOnLearners: shown.filter(
      (item) => item.falseCorrection && speakerOf(built, item.suggestion.speakerId) !== "T",
    ).length,
    falseFlagsRaw: items.filter((item) => item.falseCorrection).length,
    falseShownByGold: shown
      .filter((item) => item.falseCorrection)
      .map((item) =>
        item.gold.type === "distractor" ? `distractor:${item.gold.kind}` : item.gold.type,
      ),
    extraGenuineShown: shown.filter((item) => item.gold.type === "other" && !item.falseCorrection)
      .length,
    plantedShownExplained: plantedShownItems.filter(
      (item) =>
        item.merged.correctionOk &&
        item.merged.explanationCorrect &&
        item.merged.explanationInRequestedLanguage &&
        !item.critical.length,
    ).length,
    plantedShownItems: plantedShownItems.length,
    explanationLanguageFailuresShown: shown.filter(
      (item) => !item.merged.explanationInRequestedLanguage,
    ).length,
    minSuggestionScores: shown.map((item) => item.merged.score),
    overall: overallScores.length ? Math.min(...overallScores) : null,
    shownCritical,
    outputCritical,
    latencies: http.flatMap((item) =>
      item.state === "completed" && item.latencyMs !== undefined ? [item.latencyMs] : [],
    ),
    costUsd: http.reduce((total, item) => total + (item.costUsd ?? 0), 0),
    unknownCostHttp: http.filter(
      (item) =>
        item.state === "uncertain" || (item.state === "completed" && item.costUsd === undefined),
    ).length,
    promptTokens: http.reduce((total, item) => total + (item.usage?.prompt_tokens ?? 0), 0),
    completionTokens: http.reduce((total, item) => total + (item.usage?.completion_tokens ?? 0), 0),
    reasoningTokens: http.reduce(
      (total, item) => total + (item.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
      0,
    ),
    endpoints: [
      ...new Set(http.flatMap((item) => (item.endpointProvider ? [item.endpointProvider] : []))),
    ],
    productionValidator: productionRevalidation?.[id] ?? null,
    suggestions: items.map((item) => ({
      id: item.suggestionId,
      shown: item.shown,
      gold: item.gold as SuggestionClass,
      falseCorrection: item.falseCorrection,
      critical: item.critical,
      score: item.merged.score,
      said: item.suggestion.said,
      correct: item.suggestion.correct,
    })),
  };
}

const results: PairResult[] = [];
for (const built of cases.values())
  for (const candidate of voiceEvalCandidates) results.push(scorePair(built, candidate.id));

const sum = (rows: PairResult[], pick: (row: PairResult) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);
function aggregate(rows: PairResult[]) {
  const latencies = rows.flatMap((row) => row.latencies);
  const scores = rows.flatMap((row) => row.minSuggestionScores);
  const overall = rows.flatMap((row) => (row.overall === null ? [] : [row.overall]));
  return {
    cases: rows.length,
    firstAttemptValid: rows.filter((row) => row.firstAttemptValid).length,
    finalValid: rows.filter((row) => row.finalValid).length,
    schemaValidAnswers: `${sum(rows, (row) => row.schemaValidAnswers)}/${sum(rows, (row) => row.answers)}`,
    fallbacks: sum(rows, (row) => row.fallbacks),
    plantedShown: `${sum(rows, (row) => row.plantedShown)}/${sum(rows, (row) => row.planted)}`,
    plantedRaw: `${sum(rows, (row) => row.plantedRaw)}/${sum(rows, (row) => row.planted)}`,
    missedShown: sum(rows, (row) => row.missedShown.length),
    plantedShownNotNamedByTeacher: `${sum(rows, (row) => row.plantedUnnamedShown)}/${sum(rows, (row) => row.plantedUnnamed)}`,
    falseCorrectionsShown: sum(rows, (row) => row.falseCorrectionsShown),
    falseCorrectionsShownOnLearners: sum(rows, (row) => row.falseCorrectionsShownOnLearners),
    casesWithShownFalseCorrection: rows.filter((row) => row.falseCorrectionsShown > 0).length,
    falseFlagsRaw: sum(rows, (row) => row.falseFlagsRaw),
    shownSuggestions: sum(rows, (row) => row.shownSuggestions),
    extraGenuineShown: sum(rows, (row) => row.extraGenuineShown),
    plantedShownExplained: `${sum(rows, (row) => row.plantedShownExplained)}/${sum(rows, (row) => row.plantedShownItems)}`,
    explanationLanguageFailuresShown: sum(rows, (row) => row.explanationLanguageFailuresShown),
    casesWithoutShownCritical: rows.filter((row) => !row.shownCritical.length).length,
    meanShownSuggestionScore: scores.length
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
      : null,
    meanOverall: overall.length
      ? Number((overall.reduce((a, b) => a + b, 0) / overall.length).toFixed(2))
      : null,
    strictCasePasses: rows.filter(
      (row) =>
        row.firstAttemptValid &&
        !row.shownCritical.length &&
        row.missedShown.length === 0 &&
        (row.overall ?? 0) >= 3,
    ).length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      mean: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
      max: latencies.length ? Math.max(...latencies) : null,
    },
    costUsd: Number(sum(rows, (row) => row.costUsd).toFixed(6)),
    costPerCaseUsd: Number((sum(rows, (row) => row.costUsd) / rows.length).toFixed(6)),
    unknownCostHttp: sum(rows, (row) => row.unknownCostHttp),
    tokens: {
      prompt: sum(rows, (row) => row.promptTokens),
      completion: sum(rows, (row) => row.completionTokens),
      reasoning: sum(rows, (row) => row.reasoningTokens),
    },
    // The same answers under production c50c018's validator (no Persian-orthography check for ar).
    productionValidatorFirstAttemptValid: productionRevalidation
      ? rows.filter((row) => row.productionValidator?.firstAttemptValid).length
      : null,
    productionValidatorFinalValid: productionRevalidation
      ? rows.filter((row) => row.productionValidator?.final?.production === "valid").length
      : null,
  };
}
const byCandidate = Object.fromEntries(
  voiceEvalCandidates.map((candidate) => [
    candidate.id,
    {
      all: aggregate(results.filter((row) => row.candidateId === candidate.id)),
      byLanguage: Object.fromEntries(
        (["fa", "ar", "es", "ja", "uk"] as const).map((language) => [
          language,
          aggregate(
            results.filter((row) => row.candidateId === candidate.id && row.language === language),
          ),
        ]),
      ),
    },
  ]),
);
const paired = voiceCorrectionFixtures.map((fixture) => {
  const [haiku, gemini] = voiceEvalCandidates.map((candidate) =>
    results.find((row) => row.caseId === fixture.id && row.candidateId === candidate.id),
  );
  const clean = (row: PairResult | undefined) =>
    !!row && row.finalValid && !row.shownCritical.length && row.missedShown.length === 0;
  return { caseId: fixture.id, haikuClean: clean(haiku), geminiClean: clean(gemini) };
});
const out = {
  freeze: state.freeze,
  spentUsd: state.spentUsd,
  uncertainUsd: state.uncertainUsd,
  graders: reviews.map((review) => `${review.language}:${review.grader}`),
  byCandidate,
  pairedClean: {
    onlyHaiku: paired.filter((row) => row.haikuClean && !row.geminiClean).map((row) => row.caseId),
    onlyGemini: paired.filter((row) => row.geminiClean && !row.haikuClean).map((row) => row.caseId),
    both: paired.filter((row) => row.haikuClean && row.geminiClean).length,
    neither: paired.filter((row) => !row.haikuClean && !row.geminiClean).length,
  },
  results,
};
await mkdir(dirname(resolve(run, "results.json")), { recursive: true });
await writeFile(resolve(run, "results.json"), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ byCandidate: Object.fromEntries(Object.entries(byCandidate).map(([id, value]) => [id, value.all])), pairedClean: out.pairedClean }, null, 2)}\n`,
);
