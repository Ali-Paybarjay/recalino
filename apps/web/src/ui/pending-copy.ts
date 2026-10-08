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
} as const;
