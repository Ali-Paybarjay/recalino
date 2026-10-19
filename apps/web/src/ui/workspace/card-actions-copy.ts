/**
 * Delete-card confirmation, word for word from frame E3-delete ("Delete confirm · Undo snackbar",
 * docs/design/handoff-r1/Recalino Screens 6 - Cards Review.dc.html). "Delete this card" and
 * "Keep it" are texts the app already uses. A snackbar message for Reject is not in the frames;
 * the proposal waits for the owner in docs/design/UI_COPY_PENDING.md and Reject has no snackbar.
 */
export const cardDeleteCopy = {
  open: "Delete this card",
  title: "Delete this card?",
  linked: "This removes this card from every linked session and from review.",
  consequences: [
    "Its review history will be deleted.",
    "It won't come back if you regenerate cards.",
    "Your notes don't change.",
  ],
  suspendHint: "Want to stop seeing it for now? Suspend instead.",
  suspendInstead: "Suspend instead",
  confirm: "Delete",
  keep: "Keep it",
} as const;
