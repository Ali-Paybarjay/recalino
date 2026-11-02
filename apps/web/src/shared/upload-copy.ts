/**
 * Audio upload problem copy (workstream 1, docs/plans/UPLOAD_RELIABILITY_2026-10-12.md), approved
 * word for word by the product owner on 2026-10-13 (D65 review). `audio` texts belong to the
 * upload queue and the processing page; `automatic` texts are the automatic-learning status
 * messages of a blocked run (server/automatic-learning.ts). Shared by the browser (`ui`) and the
 * server so the server does not import values from `ui` (RR-30, R-29).
 */
export const uploadCopy = {
  audio: {
    // The server no longer accepts this run's upload; retrying here cannot work.
    uploadClosed:
      "This audio upload has ended, so retrying it here cannot work. Your original is still saved on this device. Open processing to see the next step.",
    // The upload never started before the run's window closed (audio_upload_not_started).
    notStarted:
      "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
    // The upload started but did not finish in time (audio_upload_incomplete).
    incomplete:
      "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again.",
  },
  automatic: {
    // A verifier rejection is a material problem; sending the same file again cannot help.
    rejected:
      "The audio could not be verified, so sending the same file again would stop at the same point. Open Review material to replace the audio or remove it from the selection.",
    notStarted:
      "The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
    incomplete:
      "The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again.",
  },
} as const;
