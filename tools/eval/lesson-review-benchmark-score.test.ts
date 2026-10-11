import { describe, expect, it } from "vitest";
import {
  LESSON_REVIEW_RUBRIC_VERSION,
  type LessonReviewResponse,
  lessonReviewCriteria,
} from "../../packages/core/src/eval/lesson-review";
import type {
  LessonReviewBenchmarkCase,
  LessonReviewCriterion,
} from "./lesson-review-benchmark-fixtures";
import {
  type LessonReviewBenchmarkRecord,
  renderLessonReviewBenchmarkReport,
  scoreLessonReviewBenchmark,
} from "./lesson-review-benchmark-score";

const sourceId = "00000000-0000-4000-8000-000000000001";
const contentVersionId = "00000000-0000-4000-8000-000000000002";
const anchor = { targetId: "item:past", quote: "Complete", evidenceKeys: ["source:0:block:0"] };

function fixture(id = "case-en"): LessonReviewBenchmarkCase {
  return {
    id,
    familyId: "past-tense",
    split: "holdout",
    smoke: true,
    title: "Past simple",
    tags: ["synthetic"],
    explanationLanguage: "en",
    provenance: { kind: "synthetic", labelAuthor: "ai", humanReview: "required" },
    input: {
      knowledge: {
        id: "00000000-0000-4000-8000-000000000003",
        sessionId: "00000000-0000-4000-8000-000000000004",
        runId: "00000000-0000-4000-8000-000000000005",
        version: 1,
        sourcesVersion: 1,
        sourceFingerprint: "synthetic-test",
        createdAt: "2026-10-11T12:00:00.000Z",
        generation: {},
        model: {
          schemaVersion: "1",
          title: "Past simple",
          language: { learning: "en", explanation: "en" },
          summary: [],
          topics: [],
          learningItems: [
            {
              id: "past",
              kind: "expression",
              front: "Complete: Yesterday I ___ home.",
              back: "went",
              claim: {
                id: "past-claim",
                text: "Went is the past tense of go.",
                origin: "from_class",
                creation: "ai_generation",
                evidence: "material",
                sourceRefs: [
                  {
                    sourceId,
                    contentVersionId,
                    locator: { kind: "text", blockId: "b1", start: 0, end: 31 },
                  },
                ],
                speakerRole: "unknown",
                uncertain: false,
              },
            },
          ],
          homework: [],
          uncertainties: [],
          coverage: { complete: true, missingSourceIds: [] },
        },
      },
      sources: [
        {
          sourceId,
          contentVersionId,
          kind: "text",
          role: "class_material",
          sha256: "a".repeat(64),
          mimeType: "text/plain",
          durationMs: null,
          pageCount: null,
          objectId: null,
          captureAnchor: null,
          ranges: [],
          units: [{ id: "d1", kind: "document", start: 0, status: "extracted" }],
          blocks: [
            {
              id: "b1",
              kind: "paragraph",
              unitId: "d1",
              text: "Went is the past tense of go. Yesterday I went home.",
            },
          ],
        },
      ],
      learner: { declaredLevel: "A2", goal: "general" },
      maxInputCharacters: 120000,
    },
    expected: {
      checks: Object.fromEntries(
        lessonReviewCriteria.map((criterion) => [
          criterion,
          {
            status: "satisfactory" as const,
            rationale: "Synthetic reference only.",
          },
        ]),
      ),
    },
  };
}

function clear(): LessonReviewResponse {
  return {
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
    checks: lessonReviewCriteria.map((criterion) => ({
      criterion,
      status: "satisfactory",
      reason: "Synthetic reason.",
      findings: [],
    })),
  };
}

function concern(criterion: LessonReviewCriterion = "exercise_quality"): LessonReviewResponse {
  const response = clear();
  const check = response.checks.find((candidate) => candidate.criterion === criterion);
  if (!check) throw new Error("Missing check");
  check.status = "concern";
  check.findings = [
    { ...anchor, explanation: "Unreviewed explanation.", suggestion: "Unreviewed suggestion." },
  ];
  return response;
}

function dangerous(id = "danger-en"): LessonReviewBenchmarkCase {
  const value = fixture(id);
  value.expected.checks.exercise_quality = {
    status: "concern",
    rationale: "Synthetic major concern label.",
    issues: [{ id: "leak", ...anchor, severity: "major", rationale: "Synthetic defect location." }],
  };
  return value;
}

function record(
  caseId: string,
  response: unknown = clear(),
  repeat = 0,
): LessonReviewBenchmarkRecord {
  return { caseId, repeat, outcome: "response", response };
}

describe("lesson review benchmark scoring", () => {
  it("reports explicit precision, recall, false-alarm, and status agreement denominators", () => {
    const cases = [
      dangerous("detected"),
      dangerous("missed"),
      fixture("false-alarm"),
      fixture("clean"),
    ];
    const result = scoreLessonReviewBenchmark(cases, [
      record("detected", concern()),
      record("missed"),
      record("false-alarm", concern()),
      record("clean"),
    ]);
    expect(result.overall.criteria.exercise_quality).toMatchObject({
      statusAgreement: { numerator: 2, denominator: 4, value: 0.5 },
      concernRecall: { numerator: 1, denominator: 2, value: 0.5 },
      concernPrecision: { numerator: 1, denominator: 2, value: 0.5 },
      falseAlarmRate: { numerator: 1, denominator: 2, value: 0.5 },
      majorCriticalConcernRecall: { numerator: 1, denominator: 2, value: 0.5 },
    });
    expect(result.overall.metrics.statusAgreement).toEqual({
      numerator: 18,
      denominator: 20,
      value: 0.9,
    });
  });

  it("counts failure, invalid response and unexpected missing dangerous records as end-to-end misses", () => {
    const cases = [
      dangerous("failed"),
      dangerous("invalid"),
      dangerous("missing"),
      dangerous("detected"),
    ];
    const result = scoreLessonReviewBenchmark(cases, [
      { caseId: "failed", repeat: 0, outcome: "failure", failureCode: "timeout" },
      record("invalid", { checks: [] }),
      record("detected", concern()),
    ]);
    expect(result.overall).toMatchObject({
      planned: 4,
      attempted: 3,
      evaluationAttempts: 4,
      valid: 1,
      invalid: 1,
      failed: 1,
      missing: 1,
      validResponseRate: { numerator: 1, denominator: 4, value: 0.25 },
    });
    expect(result.overall.criteria.exercise_quality.majorCriticalConcernRecall).toEqual({
      numerator: 1,
      denominator: 4,
      value: 0.25,
    });
    expect(result.outcomes.find((item) => item.caseId === "missing")?.reason).toBe(
      "missing_record",
    );
  });

  it("classifies rejected returned outputs as invalid without inventing usable semantic responses", () => {
    const rejectedCodes = [
      "provider_schema_invalid",
      "provider_response_invalid",
      "provider_output_truncated",
    ];
    const codes = [...rejectedCodes, "provider_timeout", "provider_http_error"];
    const result = scoreLessonReviewBenchmark(
      codes.map((code) => dangerous(code)),
      codes.map((failureCode) => ({
        caseId: failureCode,
        repeat: 0,
        outcome: "failure",
        failureCode,
      })),
    );
    expect(result.overall).toMatchObject({ attempted: 5, invalid: 3, failed: 2, valid: 0 });
    expect(result.overall.criteria.exercise_quality.concernRecall).toEqual({
      numerator: 0,
      denominator: 5,
      value: 0,
    });
    for (const outcome of result.outcomes) {
      expect(outcome.outcome).toBe(rejectedCodes.includes(outcome.caseId) ? "invalid" : "failure");
      expect(outcome.reason).toBe(outcome.caseId);
      expect(outcome.statuses).toEqual({});
    }
  });

  it("does not turn explicit budget or transport skips into model misses", () => {
    const cases = [dangerous("a"), dangerous("b"), dangerous("c"), dangerous("d")];
    const result = scoreLessonReviewBenchmark(cases, [
      record("a", concern()),
      { caseId: "b", repeat: 0, outcome: "not_run", reason: "budget_limit" },
      { caseId: "c", repeat: 0, outcome: "not_run", reason: "previous_unknown_outcome" },
      { caseId: "d", repeat: 0, outcome: "not_run", reason: "transport_guard" },
    ]);
    expect(result.overall).toMatchObject({
      planned: 4,
      attempted: 1,
      evaluationAttempts: 1,
      notRun: 3,
    });
    expect(result.overall.criteria.exercise_quality.concernRecall).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
  });

  it("validates evidence-bound contract failures instead of scoring superficially complete JSON", () => {
    const value = dangerous();
    const response = concern();
    response.checks[2]?.findings.forEach((finding) => {
      finding.evidenceKeys = ["invented-source"];
    });
    const result = scoreLessonReviewBenchmark([value], [record(value.id, response)]);
    expect(result.overall.invalid).toBe(1);
    expect(result.overall.criteria.exercise_quality.concernRecall).toEqual({
      numerator: 0,
      denominator: 1,
      value: 0,
    });
  });

  it("scores correct abstention and includes failed attempts in its denominator", () => {
    const first = fixture("unknown-level"),
      second = fixture("failed-level");
    for (const value of [first, second]) {
      value.input.learner.declaredLevel = null;
      value.expected.checks.learner_fit = { status: "not_assessable", rationale: "Unknown level." };
    }
    const response = clear();
    const fit = response.checks.find((check) => check.criterion === "learner_fit");
    if (!fit) throw new Error("Missing check");
    fit.status = "not_assessable";
    const result = scoreLessonReviewBenchmark(
      [first, second],
      [
        record(first.id, response),
        { caseId: second.id, repeat: 0, outcome: "failure", failureCode: "timeout" },
      ],
    );
    expect(result.overall.criteria.learner_fit.correctAbstention).toEqual({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(result.overall.criteria.learner_fit.falseAlarmRate.value).toBeNull();
  });

  it("excludes unlabelled criteria and uses null instead of perfect values for empty denominators", () => {
    const value = fixture();
    value.expected.checks = { coverage: { status: "satisfactory", rationale: "Bounded label." } };
    const result = scoreLessonReviewBenchmark([value], [record(value.id, concern())]);
    expect(result.overall.metrics).toMatchObject({
      labelledEvaluations: 1,
      unlabelledEvaluations: 4,
    });
    expect(result.overall.metrics.concernPrecision).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
    });
    expect(result.overall.criteria.exercise_quality.statusAgreement.value).toBeNull();
    expect(scoreLessonReviewBenchmark([], []).overall.validResponseRate.value).toBeNull();
  });

  it("does not count failed satisfactory cases as successful clean reviews in false-alarm denominator", () => {
    const result = scoreLessonReviewBenchmark(
      [fixture("failed"), fixture("valid")],
      [
        { caseId: "failed", repeat: 0, outcome: "failure", failureCode: "provider_error" },
        record("valid", concern()),
      ],
    );
    expect(result.overall.criteria.exercise_quality.falseAlarmRate).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
    expect(result.overall.criteria.exercise_quality.statusAgreement).toEqual({
      numerator: 0,
      denominator: 2,
      value: 0,
    });
  });

  it("counts locale variants and repeats without inflating unique case families", () => {
    const en = dangerous("en"),
      fa = dangerous("fa");
    fa.explanationLanguage = "fa";
    fa.input.knowledge.model.language.explanation = "fa";
    for (const item of fa.input.knowledge.model.learningItems) {
      item.back = "پاسخ: went";
      item.claim.text = "واژهٔ went شکل گذشتهٔ go است.";
    }
    const result = scoreLessonReviewBenchmark(
      [en, fa],
      [
        record("en", concern(), 0),
        record("en", clear(), 1),
        record("fa", concern(), 0),
        record("fa", concern(), 1),
      ],
      { expectedRepeats: 2 },
    );
    expect(result.overall).toMatchObject({
      cases: 2,
      uniqueFamilies: 1,
      planned: 4,
      attemptedFamilies: 1,
    });
    expect(result.byLocale.en?.criteria.exercise_quality.concernRecall.value).toBe(0.5);
    expect(result.byLocale.fa?.criteria.exercise_quality.concernRecall.value).toBe(1);
    expect(result.repeats).toMatchObject({
      eligibleCasePairs: 2,
      validCasePairs: 2,
      statusAgreement: { numerator: 9, denominator: 10, value: 0.9 },
      allRepeatsValidAndAgree: { numerator: 1, denominator: 2, value: 0.5 },
    });
  });

  it("never calls matching failures repeat agreement and separately shows pair coverage", () => {
    const value = fixture();
    const records: LessonReviewBenchmarkRecord[] = [0, 1].map((repeat) => ({
      caseId: value.id,
      repeat,
      outcome: "failure",
      failureCode: "same-timeout",
    }));
    const result = scoreLessonReviewBenchmark([value], records, { expectedRepeats: 3 });
    expect(result.repeats).toMatchObject({
      eligibleCasePairs: 3,
      validCasePairs: 0,
      statusAgreement: { numerator: 0, denominator: 0, value: null },
      allRepeatsValidAndAgree: { numerator: 0, denominator: 1, value: 0 },
    });
  });

  it("reports anchors only as diagnostics even when unreviewed semantics share exact gold locations", () => {
    const value = dangerous();
    const result = scoreLessonReviewBenchmark([value], [record(value.id, concern())]);
    expect(result.overall.metrics.locationDiagnostics.expectedLocationsMatched.value).toBe(1);
    expect(result.releaseDecision).toBe("human_review_required");
    expect(result.humanAssessment).toEqual({
      educationalAccuracy: null,
      semanticFindingCorrectness: null,
      suggestionQuality: null,
      explanationLanguageCompliance: null,
      status: "required",
    });
    const report = renderLessonReviewBenchmarkReport(result);
    expect(report).toContain("not evidence of educational accuracy");
    expect(report).toContain("No release pass gate is evaluated");
    expect(report).toContain("not semantic precision or recall");
    expect(report).toContain("1/1 (100.0%)");
  });

  it("does not confuse different valid quotations with semantic misses", () => {
    const value = dangerous();
    const response = concern();
    response.checks[2]?.findings.forEach((finding) => {
      finding.quote = "Yesterday";
    });
    const result = scoreLessonReviewBenchmark([value], [record(value.id, response)]);
    expect(result.overall.criteria.exercise_quality.concernRecall.value).toBe(1);
    expect(result.overall.metrics.locationDiagnostics.expectedLocationsMatched.value).toBe(0);
    expect(result.humanAssessment.semanticFindingCorrectness).toBeNull();
  });

  it("rejects unknown reference labels instead of silently removing their denominator", () => {
    const value = fixture();
    value.expected.checks = {
      imaginary: { status: "satisfactory", rationale: "invalid" },
    } as typeof value.expected.checks;
    expect(() => scoreLessonReviewBenchmark([value], [])).toThrow("Invalid reference label");
    value.expected.checks = {
      coverage: { status: "unknown", rationale: "invalid" },
    } as unknown as typeof value.expected.checks;
    expect(() => scoreLessonReviewBenchmark([value], [])).toThrow("Invalid reference label");
  });

  it("rejects duplicate, unknown and out-of-range records so input mistakes cannot inflate scores", () => {
    const value = fixture();
    expect(() => scoreLessonReviewBenchmark([value, value], [])).toThrow(
      "Duplicate benchmark case",
    );
    expect(() => scoreLessonReviewBenchmark([value], [record("unknown")])).toThrow(
      "Unknown benchmark case",
    );
    expect(() => scoreLessonReviewBenchmark([value], [record(value.id), record(value.id)])).toThrow(
      "Duplicate benchmark record",
    );
    expect(() => scoreLessonReviewBenchmark([value], [record(value.id, clear(), 1)])).toThrow(
      "Invalid repeat",
    );
    expect(() => scoreLessonReviewBenchmark([value], [], { expectedRepeats: 0 })).toThrow(
      "expectedRepeats",
    );
  });

  it("is deterministic across input order and keeps development and holdout separate", () => {
    const a = dangerous("a"),
      b = fixture("b");
    b.split = "development";
    const records = [record("a", concern()), record("b")];
    const first = scoreLessonReviewBenchmark([b, a], records);
    expect(scoreLessonReviewBenchmark([a, b], [...records].reverse())).toEqual(first);
    expect(first.bySplit.holdout?.metrics.concernRecall.denominator).toBe(1);
    expect(first.bySplit.development?.metrics.concernRecall.denominator).toBe(0);
  });
});
