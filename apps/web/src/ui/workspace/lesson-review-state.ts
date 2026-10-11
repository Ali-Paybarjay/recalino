import type { LessonReviewView } from "@recalino/core/eval";
import type { NotebookRevision } from "@recalino/core/note";

export function hasLessonEdits(revision: NotebookRevision | undefined): boolean {
  return (
    !!revision &&
    (revision.edits.title !== undefined ||
      Object.keys(revision.edits.claims).length > 0 ||
      Object.keys(revision.edits.items).length > 0)
  );
}

export function lessonReviewPending(review: LessonReviewView | null): boolean {
  return review?.state === "queued" || review?.state === "processing";
}

export function lessonReviewNeedsOperator(review: LessonReviewView | null): boolean {
  return (
    review?.state === "needs_input" ||
    review?.lastError === "provider_outcome_unknown" ||
    review?.lastError === "provider_outcome_unresolved"
  );
}

/** A missing or partial response is never a successful review. */
export function lessonReviewComplete(review: LessonReviewView | null): boolean {
  return review?.state === "ready" && !!review.response && !!review.verdict;
}

export function canRequestLessonReview(review: LessonReviewView | null): boolean {
  return (
    !review ||
    (!lessonReviewNeedsOperator(review) &&
      (review.state === "failed" || review.state === "cancelled"))
  );
}
