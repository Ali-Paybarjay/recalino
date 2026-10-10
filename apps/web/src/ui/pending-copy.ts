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
      "Your session notes and flashcards are available with some source limitations. Open the notes to see what could not be processed.",
  },
  voice: {
    // Some excerpts were skipped or decoded short (partial_audio).
    partialCoverage:
      "Some parts of this recording could not be read during the voice check and were skipped. Speech in those parts cannot contribute spoken mistakes. Your full transcript and session notes remain available.",
    // A service spending limit stopped spoken corrections; retrying cannot help.
    serviceBlockedSummary:
      "Spoken mistakes were not checked because this session reached a Recalino service limit. This is not your personal allowance. Your session notes remain available.",
    serviceBlockedDetail:
      "Speakers were prepared, but spoken mistakes were not checked because this session reached a Recalino service limit. This is not your personal allowance, and retrying the voice check will not change it. You can still confirm your speaker below.",
    // Confirmation instructions that match what the learner can actually do.
    listenPrompt: "Listen to the excerpts, then confirm which voice is yours.",
    readPrompt:
      "These speakers have saved lines but no timed audio excerpts, so there is nothing to play. Read their lines to decide, or choose “None of these voices is mine”. Your session notes stay available.",
    playback: {
      // The original is on another device or was cleared; relinking stays on this device.
      missingDetail:
        "To play these excerpts here, select the original recording of this session. Recalino checks on this device that it is exactly the same file and does not upload it.",
      incomplete:
        "The copy of this recording saved on this device is incomplete, so its excerpts cannot play. Select the original recording to restore it on this device.",
      unreadable:
        "Recordings saved on this device could not be read. Close other Recalino tabs and try again.",
      select: "Select original recording",
      checking: "Checking the selected file on this device…",
      cancel: "Cancel",
      cancelled: "Checking was cancelled. Nothing was changed.",
      linked: "The original recording is back on this device. You can play the excerpts now.",
      notOriginal:
        "This file is not the original recording of this session source, so nothing was changed.",
      noChecksum:
        "This recording cannot be checked on this device, so its original cannot be restored here.",
      active: "This recording is still in progress on this device. Stop it before restoring it.",
      storageFull:
        "This device does not have enough free storage to keep the recording. Free some space and try again.",
      saveFailed:
        "The recording could not be saved on this device. Nothing else changed. Try again.",
      checkFailed: "The selected file could not be checked on this device. Try again.",
    },
    // What a manual confirmation contributed to later automatic matching.
    reference: {
      added: "Saved as a voice reference for later sessions.",
      short:
        "This session had less than 20 seconds of your clear speech, so it was not saved as a voice reference. Later sessions still ask you.",
      expired:
        "Confirmed after the 24-hour window for voice patterns, so this session was not saved as a voice reference. Later sessions still ask you.",
      missing:
        "No voice pattern was available for this speaker, so this session was not saved as a voice reference. Later sessions still ask you.",
      mismatch:
        "This voice does not sound like your saved voice sample, so it will not be used to recognise you. If it is not your voice, choose “This is not my voice”.",
      retired:
        "This session was a voice reference earlier. Newer confirmed sessions or your current voice sample now take its place.",
    },
    // Why an acoustic check asked instead of matching automatically.
    match: {
      no_sample:
        "Recalino asked because no voice sample was saved when this session was checked. Automatic matching of later sessions would need a sample and one confirmed session.",
      no_reference:
        "Recalino asked because, when this session was checked, none of your confirmed sessions could be used as a voice reference.",
      policy_unavailable:
        "Automatic voice matching was not switched on when this session was checked, so it needs your confirmation.",
      few_voices:
        "Recalino asks because fewer than two voices in this recording had enough clear speech to compare.",
      no_clear_match:
        "Recalino asks because no voice in this recording, with enough clear speech, matched your saved voice closely enough.",
      similar_voices:
        "Recalino asks because more than one voice in this recording sounds similar to yours.",
    },
    // Settings summary of what automatic matching still needs.
    readiness: {
      needs_sample:
        "Automatic matching needs a voice sample. Save one below; until then, each session asks you.",
      needs_class:
        "Automatic matching also needs one session where you confirmed your voice with enough clear speech. Until then, each session asks you.",
      unavailable:
        "Your sample and confirmed sessions are saved. Automatic matching is not available yet, so each session asks you. Confirming or rejecting more sessions can make it available.",
      ready:
        "Later sessions can be matched automatically when your voice is clearly recognised. Unclear sessions still ask you.",
    },
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
      "Asked on {date}. When this session, or a session in the same course that teaches it, is processed again, Recalino can use this request to ask for a simpler explanation.",
    // The date is when the learner asked, not review evidence.
    adaptationAskedSimpler:
      "“{target}” appears in this lesson. You asked for a simpler explanation of it on {date}.",
  },
} as const;
