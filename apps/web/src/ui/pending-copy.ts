/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 * The 2026-10-10 approval emptied it; entries below were added after that.
 */
export const pendingCopy = {
  voice: {
    // D55: every source that needs a choice is waiting for its excerpts to play on this device.
    confirmBlockedSummary:
      "Voice check finished. To confirm your voice, its excerpts must first play on this device; the next step is shown below. Your session notes stay available.",
    playback: {
      // D55: no confirmation is offered until the excerpts can play on this device.
      listenFirst:
        "You confirm your voice by listening to these excerpts. Until they can play here, spoken mistakes from this source are withheld; your session notes stay available.",
      // D55: a failed clip no longer suggests deciding from the transcript.
      clipFailed: "This clip could not play. Try again.",
    },
  },
} as const;
