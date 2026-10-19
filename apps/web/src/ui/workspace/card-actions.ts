import type { CardActionInput, StudyCard } from "@recalino/core/card";

/** A card action as the learner's page sends it; the version makes a stale page fail loudly. */
export function cardActionBody(
  card: Pick<StudyCard, "contentVersion">,
  action: CardActionInput["action"],
): CardActionInput {
  return { expectedVersion: card.contentVersion, action, confirmQuality: true };
}

/**
 * The request that takes back a card action. The server's `undo` restores the revision before
 * the one `changed` is on, so after Reject the card is a suggestion again. Sending it twice for
 * the same card version changes nothing the second time (a stale version is refused).
 */
export function undoBody(changed: Pick<StudyCard, "contentVersion">): CardActionInput {
  return { expectedVersion: changed.contentVersion, action: "undo" };
}

/**
 * The card the Undo snackbar offers to take back (UX-03): the one a Reject has just changed.
 * Nothing is offered after another action, after a failure (`changed` is undefined), or while a
 * session is being recorded (`recording`), because no message may appear then (PRD-REC-02).
 */
export function undoOffer<T extends Pick<StudyCard, "contentVersion">>(
  action: CardActionInput["action"],
  changed: T | undefined,
  recording: boolean,
): T | null {
  return changed && action === "reject" && !recording ? changed : null;
}
