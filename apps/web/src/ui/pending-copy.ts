/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  /** Workstream 5, session navigation and next step (2026-10-12). */
  sessionNavigation: {
    nextStep: "Next step",
    uploadCount: "{sent} of {total} files sent.",
    audioNotReceived:
      "Your saved audio did not reach Recalino. Retry to send it again from this device; your material is still saved.",
    savedOnDevice: {
      heading: "Saved on this device",
      online: "Your recording uploads automatically while this app is open.",
      offline: "Your recording uploads when this device is back online. Keep this app open.",
    },
    voice: {
      action: "Confirm your voice",
      ready: "Your notes are ready. Confirming your voice in this session is optional.",
      cardBody:
        "Optional: listen to a few excerpts and confirm which voice is yours, so spoken mistakes can be included. Your notes are already available.",
    },
  },
};
