/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  voice: {
    // What a manual confirmation contributed to later automatic matching. Held on 2026-10-10:
    // "Later sessions still ask you" is not true while the account's own calibration (D54) can
    // accept later sessions.
    reference: {
      short:
        "This session had less than 20 seconds of your clear speech, so it was not saved as a voice reference. Later sessions still ask you.",
      expired:
        "Confirmed after the 24-hour window for voice patterns, so this session was not saved as a voice reference. Later sessions still ask you.",
      missing:
        "No voice pattern was available for this speaker, so this session was not saved as a voice reference. Later sessions still ask you.",
    },
    // Why an acoustic check asked instead of matching automatically. Held on 2026-10-10: these
    // reasons can also follow a decline by the account's own calibration (D54).
    match: {
      no_sample:
        "Recalino asked because no voice sample was saved when this session was checked. Automatic matching of later sessions would need a sample and one confirmed session.",
      no_reference:
        "Recalino asked because, when this session was checked, none of your confirmed sessions could be used as a voice reference.",
      policy_unavailable:
        "Automatic voice matching was not switched on when this session was checked, so it needs your confirmation.",
    },
    // Settings summary of what automatic matching still needs. Held on 2026-10-10: the account's
    // own calibration (D54) needs neither a switch nor, in every case, a sample or a reference.
    readiness: {
      needs_sample:
        "Automatic matching needs a voice sample. Save one below; until then, each session asks you.",
      needs_class:
        "Automatic matching also needs one session where you confirmed your voice with enough clear speech. Until then, each session asks you.",
      unavailable:
        "Your sample and confirmed sessions are saved. Automatic matching is not available yet, so each session asks you. Confirming or rejecting more sessions can make it available.",
    },
  },
} as const;
