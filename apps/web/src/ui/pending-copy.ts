/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
export const pendingCopy = {
  /** Workstream 1, upload reliability (2026-10-12). */
  uploadReliability: {
    audio: {
      uploadClosed:
        "This audio upload has ended, so retrying it here cannot work. Your original is still saved on this device. Open processing to see the next step.",
      notStarted:
        "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
      incomplete:
        "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
    },
    automatic: {
      notStarted:
        "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
      incomplete:
        "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
    },
  },
} as const;
