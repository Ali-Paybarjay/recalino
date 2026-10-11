import type { LessonReviewView } from "@recalino/core/eval";
import type { NotebookRevision } from "@recalino/core/note";
import { describe, expect, it } from "vitest";
import {
  canRequestLessonReview,
  hasLessonEdits,
  lessonReviewComplete,
  lessonReviewNeedsOperator,
  lessonReviewPending,
} from "./lesson-review-state";

const report: LessonReviewView = {
  runId: "review-run",
  knowledgeVersionId: "generated-version",
  knowledgeVersion: 1,
  state: "queued",
  lastError: null,
  reviewerModel: "synthetic-reviewer",
  rubricVersion: "lesson-review-1",
  createdAt: "2026-10-11T10:00:00.000Z",
  response: null,
  verdict: null,
};

describe("AC-EE-04/05/07 lesson review state", () => {
  it("allows an explicit first request and a fresh request only after known terminal failure", () => {
    expect(canRequestLessonReview(null)).toBe(true);
    for (const state of ["failed", "cancelled"] as const)
      expect(canRequestLessonReview({ ...report, state })).toBe(true);
    for (const state of [
      "queued",
      "processing",
      "needs_input",
      "partial_ready",
      "ready",
      "awaiting_upload",
    ] as const)
      expect(canRequestLessonReview({ ...report, state })).toBe(false);
  });

  it.each(["provider_outcome_unknown", "provider_outcome_unresolved"])(
    "keeps %s out of the paid retry flow even when a failed state is returned",
    (lastError) => {
      const unknown = { ...report, state: "failed" as const, lastError };
      expect(lessonReviewNeedsOperator(unknown)).toBe(true);
      expect(canRequestLessonReview(unknown)).toBe(false);
    },
  );

  it("polls active work but never mistakes a missing report for a completed review", () => {
    expect(lessonReviewPending(report)).toBe(true);
    expect(lessonReviewPending({ ...report, state: "processing" })).toBe(true);
    expect(lessonReviewPending({ ...report, state: "needs_input" })).toBe(false);
    expect(
      lessonReviewComplete({ ...report, state: "ready", verdict: "no_major_issues_found" }),
    ).toBe(false);
    expect(lessonReviewComplete({ ...report, state: "partial_ready" })).toBe(false);
  });

  it("detects title, claim and item edits, including edits carried from older material", () => {
    const revision = { edits: { claims: {}, items: {} } } as NotebookRevision;
    expect(hasLessonEdits(undefined)).toBe(false);
    expect(hasLessonEdits(revision)).toBe(false);
    const variants: NotebookRevision["edits"][] = [
      { title: "My title", claims: {}, items: {} },
      { claims: { "earlier-claim": "My explanation" }, items: {} },
      { claims: {}, items: { "earlier-item": { back: "My answer" } } },
    ];
    for (const edits of variants) expect(hasLessonEdits({ ...revision, edits })).toBe(true);
  });
});
