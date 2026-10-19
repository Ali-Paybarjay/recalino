/**
 * Session progress copy approved word for word by the product owner on 2026-10-19 (audit batch 5;
 * UX-09 and UX-13, docs/design/UI_COPY_PENDING.md). A D-number is assigned later.
 */
export const learningProgressCopy = {
  // A stop caused by Terms that changed; the action beside it is the "Read and accept" button.
  termsGuidance: "Read and accept the updated Terms to continue.",
  // Under "Waiting to process" and "Creating notes and flashcards" (UX-13). It needs no figures
  // from the stage times (NFR-07), so it promises nothing beyond "a few minutes".
  waitEstimate:
    "Most sessions are ready within a few minutes after you stop recording. Longer recordings take longer. You can leave this page.",
  // The invite is one approved sentence pair: the question is text and the second sentence opens
  // the notifications setting (the Notifications panel, which holds the device switch).
  notificationQuestion: "Want a message when your notes are ready?",
  notificationAction: "Turn on notifications in Settings.",
} as const;
