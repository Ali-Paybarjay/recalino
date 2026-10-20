/**
 * Delete-card confirmation, word for word from frame E3-delete ("Delete confirm · Undo snackbar",
 * docs/design/handoff-r1/Recalino Screens 6 - Cards Review.dc.html). "Delete this card" and
 * "Keep it" are texts the app already uses. The snackbar message for Reject is not in the frames;
 * the product owner approved it word for word on 2026-10-19 (audit batch 5, UX-03, see
 * docs/design/UI_COPY_PENDING.md), in the pattern of frame E3 ("Card suspended"). A D-number is
 * assigned later.
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

export const cardActionsCopy = {
  // The Undo snackbar after Reject; never shown while a session is being recorded (PRD-REC-02).
  rejected: "Card rejected",
} as const;
