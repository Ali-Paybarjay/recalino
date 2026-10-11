import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLessonReviewInput,
  LESSON_REVIEW_RUBRIC_VERSION,
  type LessonReviewResponse,
  lessonReviewCriteria,
} from "../../packages/core/src/eval";
import { isExplanationLanguage, matchesExplanationScript } from "../../packages/core/src/lkm";
import { snapshotSourceSchema } from "../../packages/core/src/proc/contracts";
import {
  benchmarkCases,
  type LessonReviewBenchmarkCase,
  lessonReviewBenchmarkProvenance,
} from "./lesson-review-benchmark-fixtures";

function fixture(id: string): LessonReviewBenchmarkCase {
  const result = benchmarkCases.find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing benchmark case ${id}`);
  return result;
}

/** Schema validation of reference labels is not a model run or educational accuracy score. */
function referenceResponse(entry: LessonReviewBenchmarkCase): LessonReviewResponse {
  return {
    rubricVersion: LESSON_REVIEW_RUBRIC_VERSION,
    checks: lessonReviewCriteria.map((criterion) => {
      const label = entry.expected.checks[criterion];
      return {
        criterion,
        status: label?.status ?? "not_assessable",
        reason: label?.rationale ?? "This dimension intentionally has no reference label.",
        findings: (label?.issues ?? []).map((issue) => ({
          targetId: issue.targetId,
          quote: issue.quote,
          evidenceKeys: issue.evidenceKeys,
          explanation: issue.rationale,
          suggestion: "A qualified human must independently assess an appropriate correction.",
        })),
      };
    }),
  };
}

describe("AC-EE-02/04 multilingual reviewer benchmark fixture contracts, not semantic certification", () => {
  it("contains 72 cases with exactly 12 development-only smoke cases", () => {
    expect(benchmarkCases).toHaveLength(72);
    const smoke = benchmarkCases.filter((entry) => entry.smoke);
    expect(smoke).toHaveLength(12);
    expect(smoke.every((entry) => entry.split === "development")).toBe(true);
    for (const tag of ["clean", "defect", "insufficient"])
      expect(
        smoke.some((entry) => entry.tags.includes(tag)),
        tag,
      ).toBe(true);
    expect(new Set(smoke.map((entry) => entry.explanationLanguage)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(benchmarkCases.map((entry) => entry.id)).size).toBe(benchmarkCases.length);
  });

  it("keeps paired mutations within family-level splits without translation replicas", () => {
    const families = new Map<string, LessonReviewBenchmarkCase[]>();
    for (const entry of benchmarkCases)
      families.set(entry.familyId, [...(families.get(entry.familyId) ?? []), entry]);
    expect(families.size).toBe(46);
    for (const [id, entries] of families) {
      expect(new Set(entries.map((entry) => entry.split)).size, id).toBe(1);
      expect(new Set(entries.map((entry) => entry.explanationLanguage)).size, id).toBe(1);
      if (entries.some((entry) => entry.tags.includes("paired-mutation"))) {
        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => entry.tags[0]).sort()).toEqual(["clean", "defect"]);
        expect(entries[0]?.input.sources[0]?.blocks).toEqual(entries[1]?.input.sources[0]?.blocks);
        expect(entries[0]?.input.knowledge.model.learningItems).not.toEqual(
          entries[1]?.input.knowledge.model.learningItems,
        );
      }
    }
    const independentSourceTexts = new Set(
      [...families.values()].map((entries) =>
        JSON.stringify(
          entries[0]?.input.sources.map((source) => source.blocks.map((block) => block.text)),
        ),
      ),
    );
    expect(independentSourceTexts.size).toBe(families.size);
    expect(
      benchmarkCases.filter((entry) => entry.split === "holdout").length,
    ).toBeGreaterThanOrEqual(20);
  });

  it("uses nine supported explanation locales with real localized prose and English subject language", () => {
    expect([...new Set(benchmarkCases.map((entry) => entry.explanationLanguage))].sort()).toEqual([
      "ar",
      "de",
      "en",
      "es",
      "fa",
      "fr",
      "ja",
      "ru",
      "zh-Hans",
    ]);
    for (const language of new Set(benchmarkCases.map((entry) => entry.explanationLanguage))) {
      expect(isExplanationLanguage(language), language).toBe(true);
      const entries = benchmarkCases.filter((entry) => entry.explanationLanguage === language);
      expect(
        entries.some((entry) => entry.tags.includes("clean")),
        language,
      ).toBe(true);
      expect(
        entries.some((entry) => entry.tags.includes("defect")),
        language,
      ).toBe(true);
      for (const entry of entries) {
        expect(entry.input.knowledge.model.language).toEqual({
          learning: "en",
          explanation: language,
        });
        for (const item of entry.input.knowledge.model.learningItems) {
          expect(matchesExplanationScript(item.claim.text, language), entry.id).toBe(true);
          expect(matchesExplanationScript(item.back, language), entry.id).toBe(true);
        }
      }
    }
  });

  it.each(benchmarkCases)(
    "$id reaches the real production input and binds reference labels to supplied targets",
    (entry) => {
      for (const source of entry.input.sources)
        expect(snapshotSourceSchema.safeParse(source).success).toBe(true);
      const built = buildLessonReviewInput(entry.input);
      const result = built.schema.safeParse(referenceResponse(entry));
      expect(result.success, result.success ? entry.id : JSON.stringify(result.error.issues)).toBe(
        true,
      );
      expect(entry.provenance).toEqual(lessonReviewBenchmarkProvenance);
      expect(entry.provenance.humanReview).toBe("required");
      const serialized = built.input;
      for (const privateKey of [
        '"expected":',
        '"familyId":',
        '"labelAuthor":',
        '"humanReview":',
        '"tags":',
      ])
        expect(serialized, entry.id).not.toContain(privateKey);
      expect(serialized, entry.id).not.toContain(entry.id);
      for (const [criterion, label] of Object.entries(entry.expected.checks)) {
        expect(lessonReviewCriteria).toContain(criterion);
        expect(label.rationale.length).toBeGreaterThan(20);
        expect(Boolean(label.issues?.length), `${entry.id}:${criterion}`).toBe(
          label.status === "concern",
        );
      }
    },
  );

  it("keeps ambiguous dimensions genuinely unlabelled instead of forcing an abstention or pass", () => {
    expect(fixture("pronunciation-from-transcript-unavailable").expected.checks).not.toHaveProperty(
      "educational_correctness",
    );
    expect(fixture("conflicting-assignment-deadlines").expected.checks).not.toHaveProperty(
      "source_grounding",
    );
    for (const entry of benchmarkCases.filter(
      (item) => item.tags.includes("paired-mutation") && item.tags.includes("defect"),
    )) {
      expect(entry.expected.checks).not.toHaveProperty("learner_fit");
      expect(entry.expected.checks).not.toHaveProperty("coverage");
    }
  });

  it("covers selected evidence limits without treating silent audio gaps as missing pages", () => {
    const input = (id: string) =>
      JSON.parse(buildLessonReviewInput(fixture(id).input).input) as {
        incompleteSources: boolean;
        evidence: { text: string }[];
      };
    expect(input("selected-pdf-page-missing").incompleteSources).toBe(true);
    expect(input("blank-extraction").evidence).toEqual([]);
    expect(input("unreadable-board-portion").incompleteSources).toBe(true);
    expect(input("speech-gap-is-not-missing-content").incompleteSources).toBe(false);
    const selected = input("unselected-page-excluded");
    expect(selected.incompleteSources).toBe(false);
    expect(selected.evidence).toHaveLength(1);
    expect(JSON.stringify(selected.evidence)).not.toContain("Future perfect");
  });

  it("includes worked-example, valid-expansion, scaffolding and adversarial controls", () => {
    expect(fixture("visible-worked-example").expected.checks.exercise_quality?.status).toBe(
      "satisfactory",
    );
    expect(fixture("self-test-front-answer-leak").expected.checks.exercise_quality?.status).toBe(
      "concern",
    );
    expect(fixture("legitimate-ai-expansion").expected.checks.source_grounding?.status).toBe(
      "satisfactory",
    );
    expect(
      fixture("advanced-topic-with-beginner-scaffolding").expected.checks.learner_fit?.status,
    ).toBe("satisfactory");
    expect(fixture("a1-unexplained-metalanguage").expected.checks.learner_fit?.status).toBe(
      "concern",
    );
    expect(
      fixture("source-injection-as-data").expected.checks.educational_correctness?.status,
    ).toBe("satisfactory");
    expect(
      fixture("lesson-injection-hides-error").expected.checks.educational_correctness?.status,
    ).toBe("concern");
    expect(fixture("essential-contrast-omitted").expected.checks.coverage?.status).toBe("concern");
  });

  it("serializes repeatably without random IDs or current timestamps", () => {
    const digest = (entry: LessonReviewBenchmarkCase) =>
      createHash("sha256").update(buildLessonReviewInput(entry.input).input).digest("hex");
    expect(benchmarkCases.map(digest)).toEqual(structuredClone(benchmarkCases).map(digest));
    expect(new Set(benchmarkCases.map(digest)).size).toBe(benchmarkCases.length);
  });
});
