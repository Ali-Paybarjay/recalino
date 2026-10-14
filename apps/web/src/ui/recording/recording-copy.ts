/**
 * In-app recording copy (workstream 2, docs/plans/RECORDING_CAPTURE_2026-10-12.md), approved word
 * for word by the product owner on 2026-10-13 (D65 review). The missing-audio texts are shown only
 * after Stop (PRD-REC-02) and name the intervals the learner meant to record but no audio reached
 * the device (PRD-REC-03, PRD-REC-05). `{minutes}` is rounded up; `{time}` is the local start time.
 */
export const recordingCopy = {
  // Recording page introduction; replaced the pre-D60 "After Stop, all recorded parts are saved…"
  // text on the owner's decision of 2026-10-13 (parts are sent while recording, D60).
  introduction:
    "Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.",
  missingSummary: "Part of this class was not recorded: about {minutes} min in total.",
  missingInterval: "About {minutes} min missing from {time}.",
  missingHint:
    "This usually happens when the screen locks or another app uses the microphone. Keep Recalino open and the screen on during class.",
  partMissing: "{minutes} min not recorded",
  // D72 layers 1 and 2 (docs/plans/PHOTO_READABILITY_2026-10-13.md), approved word for word by the
  // product owner on 2026-10-13: on-device photo readability, shown only inside the photo row,
  // never as a dialog, toast or sound (PRD-REC-02).
  photoQuality: {
    ok: "Looks sharp",
    blurry: "May be hard to read: blurry. Retake?",
    too_dark: "May be hard to read: too dark. Retake?",
    too_bright: "May be hard to read: washed out. Retake?",
    glare: "May be hard to read: glare on the board. Retake?",
    low_detail: "Hard to see writing in this photo. Move closer or retake?",
    retake: "Retake",
    zoomPrompt: "Can you read the smallest writing? If not, retake while the board is still there.",
  },
  // D72 follow-up, approved word for word by the product owner on 2026-10-14 (D76): remove a board
  // photo that exists only on this device, from its row or the zoom sheet, after a confirmation.
  photoRemove: {
    action: "Remove this photo",
    confirm: "Remove this photo from this device?",
    notUploaded: "It has not been uploaded.",
    keep: "Keep",
  },
} as const;
