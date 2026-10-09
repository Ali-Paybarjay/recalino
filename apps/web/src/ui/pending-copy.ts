/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  processingReview: {
    // A review is already recorded; asking to "request a review below" again would mislead.
    recorded:
      "Your processing review is recorded. Follow its status below; your saved material will be used when processing continues.",
    // A published partial result resolved the review without claiming full coverage.
    resolvedPartial:
      "Your class notes and flashcards are available with some source limitations. Open the notes to see what could not be processed.",
  },
  voice: {
    // Some excerpts were skipped or decoded short (partial_audio).
    partialCoverage:
      "Some parts of this recording could not be read during the voice check and were skipped. Speech in those parts cannot contribute spoken mistakes. Your full transcript and class notes remain available.",
    // A service spending limit stopped spoken corrections; retrying cannot help.
    serviceBlockedSummary:
      "Spoken mistakes were not checked because this class reached a Recalino service limit. This is not your personal allowance. Your class notes remain available.",
    serviceBlockedDetail:
      "Speakers were prepared, but spoken mistakes were not checked because this class reached a Recalino service limit. This is not your personal allowance, and retrying the voice check will not change it. You can still confirm your speaker below.",
  },
  learningMemory: {
    // D49 review fixes, 2026-10-09: changed after the owner's 2026-10-08 copy approval.
    // Names the card type; the earlier wording read as an outcome even for failed items.
    setProduction: "core cards",
    setRecognition: "supplementary cards",
    setLegacy: "other cards",
    // Hard also counts as recalled, so the heading no longer says "well".
    recalledTitle: "Recalled in your latest answers",
    // A request is used only when such a class is processed again, among at most eight points.
    simplerReason:
      "Asked on {date}. When this class, or a class in the same course that teaches it, is processed again, Recalino can use this request to ask for a simpler explanation.",
    // The date is when the learner asked, not review evidence.
    adaptationAskedSimpler:
      "“{target}” appears in this lesson. You asked for a simpler explanation of it on {date}.",
  },
} as const;
