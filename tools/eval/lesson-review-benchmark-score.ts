import {
  buildLessonReviewInput,
  type LessonReviewResponse,
  lessonReviewCriteria,
} from "../../packages/core/src/eval/lesson-review";
import type {
  LessonReviewBenchmarkCase,
  LessonReviewCriterion,
  LessonReviewStatus,
} from "./lesson-review-benchmark-fixtures";

type RecordIdentity = { caseId: string; repeat: number; latencyMs?: number; costMicros?: number };
export type LessonReviewBenchmarkRecord = RecordIdentity &
  (
    | { outcome: "response"; response: unknown }
    | { outcome: "failure"; failureCode: string }
    | {
        outcome: "not_run";
        reason: "budget_limit" | "previous_unknown_outcome" | "transport_guard";
      }
  );
export type BenchmarkRecord = LessonReviewBenchmarkRecord;

export type BenchmarkRate = { numerator: number; denominator: number; value: number | null };
export type BenchmarkOutcome = {
  caseId: string;
  familyId: string;
  explanationLanguage: string;
  repeat: number;
  outcome: "valid" | "invalid" | "failure" | "missing" | "not_run";
  reason: string | null;
  statuses: Partial<Record<LessonReviewCriterion, LessonReviewStatus>>;
};

type ScoredAttempt = {
  fixture: LessonReviewBenchmarkCase;
  outcome: BenchmarkOutcome;
  response: LessonReviewResponse | null;
};

export type BenchmarkCriterionMetrics = {
  labelledEvaluations: number;
  unlabelledEvaluations: number;
  validLabelledEvaluations: number;
  statusAgreement: BenchmarkRate;
  concernRecall: BenchmarkRate;
  concernPrecision: BenchmarkRate;
  falseAlarmRate: BenchmarkRate;
  correctAbstention: BenchmarkRate;
  majorCriticalConcernRecall: BenchmarkRate;
  locationDiagnostics: {
    expectedLocationsMatched: BenchmarkRate;
    returnedLocationsMatched: BenchmarkRate;
  };
};

export type BenchmarkGroup = {
  cases: number;
  uniqueFamilies: number;
  attemptedCases: number;
  attemptedFamilies: number;
  planned: number;
  attempted: number;
  evaluationAttempts: number;
  valid: number;
  invalid: number;
  failed: number;
  missing: number;
  notRun: number;
  validResponseRate: BenchmarkRate;
  metrics: BenchmarkCriterionMetrics;
  criteria: Record<LessonReviewCriterion, BenchmarkCriterionMetrics>;
};

export type LessonReviewBenchmarkSummary = {
  schemaVersion: "lesson-review-benchmark-score-1";
  expectedRepeats: number;
  assessment: "provisional_ai_reference_comparison";
  releaseDecision: "human_review_required";
  humanAssessment: {
    educationalAccuracy: null;
    semanticFindingCorrectness: null;
    suggestionQuality: null;
    explanationLanguageCompliance: null;
    status: "required";
  };
  overall: BenchmarkGroup;
  byLocale: Record<string, BenchmarkGroup>;
  bySplit: Partial<Record<"development" | "holdout", BenchmarkGroup>>;
  repeats: {
    eligibleCasePairs: number;
    validCasePairs: number;
    validPairRate: BenchmarkRate;
    statusAgreement: BenchmarkRate;
    eligibleCases: number;
    allRepeatsValidAndAgree: BenchmarkRate;
  };
  outcomes: BenchmarkOutcome[];
};

function rate(numerator: number, denominator: number): BenchmarkRate {
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}

function knownStatus(value: unknown): value is LessonReviewStatus {
  return value === "satisfactory" || value === "concern" || value === "not_assessable";
}

function assertReference(fixture: LessonReviewBenchmarkCase): void {
  for (const [criterion, expectation] of Object.entries(fixture.expected.checks)) {
    if (
      !lessonReviewCriteria.includes(criterion as LessonReviewCriterion) ||
      !expectation ||
      !knownStatus(expectation.status)
    )
      throw new Error(`Invalid reference label: ${fixture.id}/${criterion}`);
    if (expectation.status !== "concern" && expectation.issues?.length)
      throw new Error(`Reference issues require concern: ${fixture.id}/${criterion}`);
    if (
      expectation.issues?.some((issue) => !["minor", "major", "critical"].includes(issue.severity))
    )
      throw new Error(`Invalid reference severity: ${fixture.id}/${criterion}`);
  }
}

function sameLocation(
  actual: { targetId: string; quote: string; evidenceKeys: string[] },
  expected: { targetId: string; quote: string; evidenceKeys: string[] },
): boolean {
  return (
    actual.targetId === expected.targetId &&
    actual.quote === expected.quote &&
    JSON.stringify([...actual.evidenceKeys].sort()) ===
      JSON.stringify([...expected.evidenceKeys].sort())
  );
}

function metrics(
  attempts: ScoredAttempt[],
  criteria: readonly LessonReviewCriterion[],
): BenchmarkCriterionMetrics {
  let labelled = 0;
  let unlabelled = 0;
  let validLabelled = 0;
  let agreements = 0;
  let concerns = 0;
  let matchingConcerns = 0;
  let predictedConcerns = 0;
  let validSatisfactory = 0;
  let falseAlarms = 0;
  let abstentions = 0;
  let matchingAbstentions = 0;
  let majorCriticalConcerns = 0;
  let matchingMajorCritical = 0;
  let expectedLocations = 0;
  let matchedExpectedLocations = 0;
  let returnedLocations = 0;
  let matchedReturnedLocations = 0;
  for (const attempt of attempts) {
    if (attempt.outcome.outcome === "not_run") continue;
    for (const criterion of criteria) {
      const expected = attempt.fixture.expected.checks[criterion];
      if (!expected) {
        unlabelled++;
        continue;
      }
      labelled++;
      const actual = attempt.response?.checks.find((check) => check.criterion === criterion);
      if (actual) validLabelled++;
      if (actual?.status === expected.status) agreements++;
      if (actual?.status === "concern") predictedConcerns++;
      if (expected.status === "concern") {
        concerns++;
        if (actual?.status === "concern") matchingConcerns++;
        if (expected.issues?.some((issue) => issue.severity !== "minor")) {
          majorCriticalConcerns++;
          if (actual?.status === "concern") matchingMajorCritical++;
        }
      }
      if (expected.status === "satisfactory" && actual) {
        validSatisfactory++;
        if (actual.status === "concern") falseAlarms++;
      }
      if (expected.status === "not_assessable") {
        abstentions++;
        if (actual?.status === "not_assessable") matchingAbstentions++;
      }
      // Exact anchors are a debugging diagnostic, never semantic finding correctness.
      const issues = expected.issues ?? [];
      expectedLocations += issues.length;
      matchedExpectedLocations += issues.filter((issue) =>
        actual?.findings.some((finding) => sameLocation(finding, issue)),
      ).length;
      // No issue annotations means no claim that all acceptable locations were enumerated.
      if (expected.issues !== undefined) {
        returnedLocations += actual?.findings.length ?? 0;
        matchedReturnedLocations +=
          actual?.findings.filter((finding) => issues.some((issue) => sameLocation(finding, issue)))
            .length ?? 0;
      }
    }
  }
  return {
    labelledEvaluations: labelled,
    unlabelledEvaluations: unlabelled,
    validLabelledEvaluations: validLabelled,
    statusAgreement: rate(agreements, labelled),
    concernRecall: rate(matchingConcerns, concerns),
    concernPrecision: rate(matchingConcerns, predictedConcerns),
    falseAlarmRate: rate(falseAlarms, validSatisfactory),
    correctAbstention: rate(matchingAbstentions, abstentions),
    majorCriticalConcernRecall: rate(matchingMajorCritical, majorCriticalConcerns),
    locationDiagnostics: {
      expectedLocationsMatched: rate(matchedExpectedLocations, expectedLocations),
      returnedLocationsMatched: rate(matchedReturnedLocations, returnedLocations),
    },
  };
}

function group(attempts: ScoredAttempt[]): BenchmarkGroup {
  const count = (outcome: BenchmarkOutcome["outcome"]) =>
    attempts.filter((attempt) => attempt.outcome.outcome === outcome).length;
  const attempted = attempts.filter((attempt) =>
    ["valid", "invalid", "failure"].includes(attempt.outcome.outcome),
  );
  const evaluationAttempts = attempts.length - count("not_run");
  return {
    cases: new Set(attempts.map((attempt) => attempt.fixture.id)).size,
    uniqueFamilies: new Set(attempts.map((attempt) => attempt.fixture.familyId)).size,
    attemptedCases: new Set(attempted.map((attempt) => attempt.fixture.id)).size,
    attemptedFamilies: new Set(attempted.map((attempt) => attempt.fixture.familyId)).size,
    planned: attempts.length,
    attempted: attempted.length,
    evaluationAttempts,
    valid: count("valid"),
    invalid: count("invalid"),
    failed: count("failure"),
    missing: count("missing"),
    notRun: count("not_run"),
    validResponseRate: rate(count("valid"), evaluationAttempts),
    metrics: metrics(attempts, lessonReviewCriteria),
    criteria: Object.fromEntries(
      lessonReviewCriteria.map((criterion) => [criterion, metrics(attempts, [criterion])]),
    ) as Record<LessonReviewCriterion, BenchmarkCriterionMetrics>,
  };
}

function repeatMetrics(attempts: ScoredAttempt[]): LessonReviewBenchmarkSummary["repeats"] {
  let eligibleCasePairs = 0;
  let validCasePairs = 0;
  let matchingStatuses = 0;
  let statusComparisons = 0;
  let eligibleCases = 0;
  let allAgree = 0;
  for (const id of new Set(attempts.map((attempt) => attempt.fixture.id))) {
    const runs = attempts.filter(
      (attempt) => attempt.fixture.id === id && attempt.outcome.outcome !== "not_run",
    );
    if (runs.length < 2) continue;
    eligibleCases++;
    let everyPairAgrees = true;
    for (let left = 0; left < runs.length; left++) {
      for (let right = left + 1; right < runs.length; right++) {
        eligibleCasePairs++;
        const a = runs[left];
        const b = runs[right];
        if (!a?.response || !b?.response) {
          everyPairAgrees = false;
          continue;
        }
        validCasePairs++;
        for (const criterion of lessonReviewCriteria) {
          statusComparisons++;
          if (a.outcome.statuses[criterion] === b.outcome.statuses[criterion]) matchingStatuses++;
          else everyPairAgrees = false;
        }
      }
    }
    if (everyPairAgrees) allAgree++;
  }
  return {
    eligibleCasePairs,
    validCasePairs,
    validPairRate: rate(validCasePairs, eligibleCasePairs),
    statusAgreement: rate(matchingStatuses, statusComparisons),
    eligibleCases,
    allRepeatsValidAndAgree: rate(allAgree, eligibleCases),
  };
}

/** Offline only. A record repeat is zero-based; missing planned records are incomplete failures. */
export function scoreLessonReviewBenchmark(
  cases: readonly LessonReviewBenchmarkCase[],
  records: readonly LessonReviewBenchmarkRecord[],
  options: { expectedRepeats?: number } = {},
): LessonReviewBenchmarkSummary {
  const expectedRepeats = options.expectedRepeats ?? 1;
  if (!Number.isSafeInteger(expectedRepeats) || expectedRepeats < 1)
    throw new Error("expectedRepeats must be a positive safe integer");
  const casesById = new Map(cases.map((fixture) => [fixture.id, fixture]));
  if (casesById.size !== cases.length) throw new Error("Duplicate benchmark case id");
  const recordsByCase = new Map<string, Map<number, LessonReviewBenchmarkRecord>>();
  for (const record of records) {
    if (!casesById.has(record.caseId)) throw new Error(`Unknown benchmark case: ${record.caseId}`);
    if (
      !Number.isSafeInteger(record.repeat) ||
      record.repeat < 0 ||
      record.repeat >= expectedRepeats
    )
      throw new Error(`Invalid repeat: ${record.caseId}/${record.repeat}`);
    if (!["response", "failure", "not_run"].includes(record.outcome))
      throw new Error(`Unknown outcome: ${record.caseId}/${record.repeat}`);
    if (
      record.outcome === "not_run" &&
      !["budget_limit", "previous_unknown_outcome", "transport_guard"].includes(record.reason)
    )
      throw new Error(`Invalid not_run reason: ${record.caseId}/${record.repeat}`);
    const entries = recordsByCase.get(record.caseId) ?? new Map();
    if (entries.has(record.repeat))
      throw new Error(`Duplicate benchmark record: ${record.caseId}/${record.repeat}`);
    entries.set(record.repeat, record);
    recordsByCase.set(record.caseId, entries);
  }
  const attempts: ScoredAttempt[] = [];
  for (const fixture of [...cases].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    assertReference(fixture);
    const { schema } = buildLessonReviewInput(fixture.input);
    for (let repeat = 0; repeat < expectedRepeats; repeat++) {
      const record = recordsByCase.get(fixture.id)?.get(repeat);
      const parsed = record?.outcome === "response" ? schema.safeParse(record.response) : null;
      const response = parsed?.success ? parsed.data : null;
      // Provider parsing can reject a returned payload without preserving usable review data.
      const rejectedOutput =
        record?.outcome === "failure" &&
        [
          "provider_schema_invalid",
          "provider_response_invalid",
          "provider_output_truncated",
        ].includes(record.failureCode);
      const outcome: BenchmarkOutcome = {
        caseId: fixture.id,
        familyId: fixture.familyId,
        explanationLanguage: fixture.explanationLanguage,
        repeat,
        outcome: !record
          ? "missing"
          : record.outcome === "response"
            ? response
              ? "valid"
              : "invalid"
            : rejectedOutput
              ? "invalid"
              : record.outcome,
        reason: !record
          ? "missing_record"
          : record.outcome === "failure"
            ? record.failureCode
            : record.outcome === "not_run"
              ? record.reason
              : response
                ? null
                : "response_schema_invalid",
        statuses: Object.fromEntries(
          response?.checks.map((check) => [check.criterion, check.status]) ?? [],
        ),
      };
      attempts.push({ fixture, outcome, response });
    }
  }
  const locales = [...new Set(cases.map((fixture) => fixture.explanationLanguage))].sort();
  const splits = [...new Set(cases.map((fixture) => fixture.split))].sort();
  return {
    schemaVersion: "lesson-review-benchmark-score-1",
    expectedRepeats,
    assessment: "provisional_ai_reference_comparison",
    releaseDecision: "human_review_required",
    humanAssessment: {
      educationalAccuracy: null,
      semanticFindingCorrectness: null,
      suggestionQuality: null,
      explanationLanguageCompliance: null,
      status: "required",
    },
    overall: group(attempts),
    byLocale: Object.fromEntries(
      locales.map((locale) => [
        locale,
        group(attempts.filter((a) => a.fixture.explanationLanguage === locale)),
      ]),
    ),
    bySplit: Object.fromEntries(
      splits.map((split) => [split, group(attempts.filter((a) => a.fixture.split === split))]),
    ),
    repeats: repeatMetrics(attempts),
    outcomes: attempts.map((attempt) => attempt.outcome),
  };
}

function displayRate(value: BenchmarkRate): string {
  return `${value.numerator}/${value.denominator} (${value.value === null ? "not assessed" : `${(value.value * 100).toFixed(1)}%`})`;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

/** Deliberately has no automatic pass, readiness grade, or educational-accuracy estimate. */
export function renderLessonReviewBenchmarkReport(summary: LessonReviewBenchmarkSummary): string {
  const overall = summary.overall;
  const lines = [
    "# Lesson review benchmark: provisional reference comparison",
    "",
    "Human review is required. Synthetic cases and reference labels are AI-authored; matching their statuses is not evidence of educational accuracy. No release pass gate is evaluated.",
    "",
    `${overall.cases} case variants across ${overall.uniqueFamilies} unique families; ${summary.expectedRepeats} planned repeat(s) per case. Repeats and translated variants are not independent samples. ${overall.attemptedCases} cases across ${overall.attemptedFamilies} families were attempted.`,
    "",
    `Planned: ${overall.planned}; attempted: ${overall.attempted}; valid: ${overall.valid}; invalid: ${overall.invalid}; failed: ${overall.failed}; missing records: ${overall.missing}; explicitly not run: ${overall.notRun}. Valid response rate: ${displayRate(overall.validResponseRate)}.`,
    "",
    "Recall, agreement and correct abstention include attempted failures and invalid responses as misses. Unexpected missing records also count as incomplete misses. Explicit not_run records are excluded. Precision compares concern statuses only on labelled criteria; false-alarm rate uses valid responses with satisfactory reference labels. Unlabelled criteria are excluded from label metrics. Every rate gives its numerator and denominator; zero denominators are not assessed.",
    "",
    "## Provisional criterion status metrics",
    "",
    "| Criterion | Status agreement | Concern recall | Concern precision | False alarms | Correct abstention | Major/critical concern signal recall |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const criterion of lessonReviewCriteria) {
    const metric = overall.criteria[criterion];
    lines.push(
      `| ${criterion} | ${[metric.statusAgreement, metric.concernRecall, metric.concernPrecision, metric.falseAlarmRate, metric.correctAbstention, metric.majorCriticalConcernRecall].map(displayRate).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    "A matching concern status does not establish that the model found the annotated defect. Major/critical concern signal recall uses labelled criteria containing at least one major or critical reference issue; it does not measure semantic detection of individual defects.",
    "",
    "## Locale breakdown",
    "",
    "Locale is the requested explanation language, not verified output-language compliance.",
    "",
    "| Locale | Cases / families | Attempted / planned | Valid / evaluation attempts | Invalid / failed / missing / not run | Status agreement | Concern recall | Precision | False alarms | Correct abstention |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [locale, data] of Object.entries(summary.byLocale)) {
    const metric = data.metrics;
    lines.push(
      `| ${cell(locale)} | ${data.cases} / ${data.uniqueFamilies} | ${data.attempted} / ${data.planned} | ${data.valid} / ${data.evaluationAttempts} | ${data.invalid} / ${data.failed} / ${data.missing} / ${data.notRun} | ${[metric.statusAgreement, metric.concernRecall, metric.concernPrecision, metric.falseAlarmRate, metric.correctAbstention].map(displayRate).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    "## Development and holdout",
    "",
    "| Split | Cases / families | Attempted / planned | Valid response rate | Status agreement | Concern recall | Concern precision | Correct abstention |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [split, data] of Object.entries(summary.bySplit)) {
    const metric = data.metrics;
    lines.push(
      `| ${cell(split)} | ${data.cases} / ${data.uniqueFamilies} | ${data.attempted} / ${data.planned} | ${[data.validResponseRate, metric.statusAgreement, metric.concernRecall, metric.concernPrecision, metric.correctAbstention].map(displayRate).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    "## Repeats and human assessment",
    "",
    `Valid repeat pairs: ${displayRate(summary.repeats.validPairRate)}; status agreement across valid pairs: ${displayRate(summary.repeats.statusAgreement)}; eligible cases with all observed/planned non-skipped repeats valid and agreeing: ${displayRate(summary.repeats.allRepeatsValidAndAgree)}. Matching failures are never counted as agreement.`,
    "",
    `Exact target/quote/evidence-set matches: ${displayRate(overall.metrics.locationDiagnostics.expectedLocationsMatched)} expected locations. This is only an anchor diagnostic; alternative valid quotations can differ. It is not semantic precision or recall.`,
    "",
    "Educational accuracy, semantic finding correctness, suggestion quality, and explanation-language compliance: not assessed (null); qualified human review required. A complete, valid JSON response alone does not establish review quality.",
    "",
  );
  return lines.join("\n");
}
