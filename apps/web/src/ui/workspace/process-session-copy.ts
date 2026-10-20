/**
 * "Process this session" (D105, D107): the button, its summary sheet and the next step of a
 * session that waits for the learner. The first four texts were approved word for word by the
 * product owner on 2026-10-20 (docs/design/UI_COPY_PENDING.md, section D107); the others are
 * existing copy from handoff/copy.md and frame C5 ("Process this class?" under the D50 wording).
 */
export const processSessionCopy = {
  // The button on the recording page after Stop, the session's next step and the material page.
  action: "Process this session",
  // The title of the summary and allowance sheet shown before every Process.
  title: "Process this session?",
  // In the sheet, under the summary: nothing starts or is charged before the confirmation.
  nothingYet: "Nothing is processed or charged until you confirm.",
  // Under "Ready to process": the session waits for the learner.
  readyDetail: "Your notes and flashcards are made when you process this session.",
  // handoff/copy.md, "Class statuses".
  readyHeading: "Ready to process",
  // handoff/copy.md, "Changed sources": material added after the notes reopens the session.
  reopenedHeading: "New sources since your notes were made",
  // handoff/copy.md, the second sentence of "Retry" (D59).
  reopenedDetail: "A new version of existing notes also uses 1 New versions unit.",
  // Frame C5.
  confirm: "Confirm and process",
  notNow: "Not now",
} as const;
