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
