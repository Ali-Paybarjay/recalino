/**
 * Educational evaluator copy: docs/plans/EDUCATIONAL_EVALUATOR_2026-10-11.md,
 * AC-EE-01, AC-EE-04 and AC-EE-07. This new flow uses existing UI primitives.
 */
export const lessonReviewCopy = {
  title: "Lesson quality review",
  intro:
    "Ask AI to check this generated lesson and its exercises against the selected source material.",
  scope: "This reviews the original generated lesson. Your edits are not included.",
  edited: "These notes contain your edits. This report only covers the original generated lesson.",
  advisory:
    "AI can miss problems or make mistakes. This is advice about the lesson, not human approval or a test of your level.",
  generatedVersion: (version: number) => `Generated lesson version ${version}`,
  originalVersion: "Original generated lesson",
  versionId: "Generated version ID",
  start: "Review generated lesson",
  retry: "Try lesson review again",
  retryRequest: "Retry review request",
  check: "Check review status",
  loading: "Loading the saved review…",
  submitting: "Requesting a lesson review…",
  queued: "The lesson review is queued. You can keep reading your notes.",
  processing: "AI is checking the generated lesson. You can keep reading your notes.",
  failed: "The lesson review could not finish. You can try it again.",
  cancelled: "The lesson review was cancelled.",
  unresolved:
    "The review result needs checking. Check its status or contact the operator before requesting another review.",
  incomplete: "A complete review is not available. Check its status or contact the operator.",
  loadError: "The saved review could not be loaded. Check its status to try again.",
  requestError: "The request could not be confirmed. Check its status or retry the same request.",
  providerUnavailable: "Lesson reviews are not available right now. Try again later.",
  unavailable: "This generated lesson is no longer available for review. Refresh your notes.",
  details: "Review details",
  checked: (date: string) => `Requested: ${date}`,
  model: "Reviewer model",
  rubric: "Review criteria version",
  target: "Lesson item",
  evidence: "Source evidence",
  suggestion: "Suggested change",
  verdict: {
    no_major_issues_found: "No major issues found by AI",
    needs_attention: "Some parts need attention",
    insufficient_evidence: "Not enough evidence for a full review",
  },
  criterion: {
    source_grounding: "Support from the sources",
    educational_correctness: "Teaching accuracy",
    exercise_quality: "Exercises and hidden answers",
    learner_fit: "Fit with your chosen level",
    coverage: "Coverage of the selected material",
  },
  status: {
    satisfactory: "No concern found",
    concern: "Needs attention",
    not_assessable: "Not enough evidence",
  },
} as const;
