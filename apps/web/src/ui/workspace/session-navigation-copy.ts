/**
 * Session navigation and next-step copy (workstream 5, docs/plans/SESSION_NAVIGATION_2026-10-12.md),
 * approved word for word by the product owner on 2026-10-13 (D65 review). Used by the next-step
 * resolver (session-state.ts) and the next-step cards (SessionNextStep.tsx).
 */
export const sessionNavigationCopy = {
  // Label above the next-step card on the session page and Today.
  nextStep: "Next step",
  // Status line while more than one file is being sent.
  uploadCount: "{sent} of {total} files sent.",
  // The run stopped because the saved audio never reached the server in time.
  audioNotReceived:
    "Your saved audio did not reach Recalino. Retry to send it again from this device; your material is still saved.",
  // A finished recording is on this device and has not reached the server yet.
  savedOnDevice: {
    heading: "Saved on this device",
    online: "Your recording uploads automatically while this app is open.",
    offline: "Your recording uploads when this device is back online. Keep this app open.",
  },
  // Upload during capture (D60) and the last part after Stop.
  capture: {
    background: "Finished parts upload in the background. Keep recording; nothing interrupts it.",
    lastPart: "Sending the last part",
    lastPartDetail: "The other parts are already sent. Keep this app open until it finishes.",
  },
  // The lesson is written and publication waits for the voice check.
  voiceCheck: {
    heading: "Finishing your notes",
    detail:
      "Your lesson is written. Recalino is checking the voices in your recording before it shows the notes. This can take a few minutes; you can leave this page.",
  },
  // The optional voice step on the session page.
  voice: {
    action: "Confirm your voice",
    ready: "Your notes are ready. Confirming your voice in this session is optional.",
    cardBody:
      "Optional: listen to a few excerpts and confirm which voice is yours, so spoken mistakes can be included. Your notes are already available.",
  },
} as const;
