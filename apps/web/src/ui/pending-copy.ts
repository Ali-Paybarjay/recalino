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
    // Confirmation instructions that match what the learner can actually do.
    listenPrompt: "Listen to the excerpts, then confirm which voice is yours.",
    readPrompt:
      "These speakers have saved lines but no timed audio excerpts, so there is nothing to play. Read their lines to decide, or choose “None of these voices is mine”. Your class notes stay available.",
    playback: {
      // The original is on another device or was cleared; relinking stays on this device.
      missingDetail:
        "To play these excerpts here, select the original recording of this class. Recalino checks on this device that it is exactly the same file and does not upload it.",
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
        "This file is not the original recording of this class source, so nothing was changed.",
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
      added: "Saved as a voice reference for later classes.",
      short:
        "This class had less than 20 seconds of your clear speech, so it was not saved as a voice reference. Later classes still ask you.",
      expired:
        "Confirmed after the 24-hour window for voice patterns, so this class was not saved as a voice reference. Later classes still ask you.",
      missing:
        "No voice pattern was available for this speaker, so this class was not saved as a voice reference. Later classes still ask you.",
      mismatch:
        "This voice does not sound like your saved voice sample, so it will not be used to recognise you. If it is not your voice, choose “This is not my voice”.",
      retired:
        "This class was a voice reference earlier. Newer confirmed classes or your current voice sample now take its place.",
    },
    // Why an acoustic check asked instead of matching automatically.
    match: {
      no_sample:
        "Recalino asks because you have not saved a voice sample. With a sample and one confirmed class, later classes can be matched automatically when the evidence is clear.",
      no_reference:
        "Recalino asks because none of your confirmed classes can be used as a voice reference yet. Confirm one class with enough clear speech from you.",
      policy_unavailable:
        "Automatic voice matching is not switched on yet, so each class needs your confirmation.",
      few_voices:
        "Recalino asks because fewer than two voices in this recording had enough clear speech to compare.",
      no_clear_match:
        "Recalino asks because no voice in this recording matched both your sample and your confirmed class closely enough.",
      similar_voices:
        "Recalino asks because more than one voice in this recording sounds similar to yours.",
    },
    // Settings summary of what automatic matching still needs.
    readiness: {
      needs_sample:
        "Automatic matching needs a voice sample. Save one below; until then, each class asks you.",
      needs_class:
        "Automatic matching starts after you confirm your voice in one class with enough clear speech. Until then, each class asks you.",
      unavailable:
        "Your sample and confirmed classes are saved. Automatic matching is not switched on yet, so each class asks you.",
      ready:
        "Later classes can be matched automatically when your voice is clearly recognised. Unclear classes still ask you.",
    },
  },
} as const;
