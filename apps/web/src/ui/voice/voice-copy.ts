/**
 * Voice check copy added after the design handoff. The product owner approved these texts on
 * 2026-10-10 (D54, follow-up), including the reworded reference, reason and readiness texts that
 * stay true while the account's own calibration can still accept later sessions.
 */
export const voiceCopy = {
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
    saveFailed: "The recording could not be saved on this device. Nothing else changed. Try again.",
    checkFailed: "The selected file could not be checked on this device. Try again.",
  },
  // What a manual confirmation contributed to later automatic matching.
  reference: {
    added: "Saved as a voice reference for later sessions.",
    short:
      "This session had less than 20 seconds of your clear speech, so it was not saved as a voice reference.",
    expired:
      "Confirmed after the 24-hour window for voice patterns, so this session was not saved as a voice reference.",
    missing:
      "No voice pattern was available for this speaker, so this session was not saved as a voice reference.",
    mismatch:
      "This voice does not sound like your saved voice sample, so it will not be used to recognise you. If it is not your voice, choose “This is not my voice”.",
    retired:
      "This session was a voice reference earlier. Newer confirmed sessions or your current voice sample now take its place.",
  },
  // Why an acoustic check asked instead of matching automatically.
  match: {
    no_sample:
      "No voice sample was saved when this session was checked. Recalino asked you to confirm this session.",
    no_reference:
      "When this session was checked, none of your confirmed sessions could be used as a voice reference. Recalino asked you to confirm this session.",
    policy_unavailable:
      "Automatic voice matching was not available when this session was checked, so it needs your confirmation.",
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
      "Save a voice sample below to help Recalino recognise your voice in later sessions. Until automatic matching is available, sessions ask you.",
    needs_class:
      "Confirming your voice in a session with enough clear speech helps Recalino recognise you in later sessions. Until automatic matching is available, sessions ask you.",
    unavailable:
      "Your sample and confirmed sessions are saved. Automatic matching is not available yet, so each session asks you.",
    ready:
      "Later sessions can be matched automatically when your voice is clearly recognised. Unclear sessions still ask you.",
  },
} as const;
