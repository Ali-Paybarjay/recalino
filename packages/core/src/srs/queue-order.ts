import type { StudyCard } from "../card";

type QueueCard = Pick<StudyCard, "id" | "createdAt" | "sessionIds" | "studySet">;

const setRank = (card: QueueCard) =>
  card.studySet === "production" ? 0 : card.studySet === "recognition" ? 1 : 2;

/**
 * D78: new cards from the most recently generated session come first. A session's generation
 * time is its earliest card, so a card added later does not move an older session forward.
 * Within one session, core (production) cards precede supplementary (recognition) and older
 * cards; otherwise the session's own order, as given, is kept.
 */
export function orderNewCards<T extends { card: QueueCard }>(
  items: readonly T[],
  sessionCards: readonly QueueCard[],
): T[] {
  const session = (card: QueueCard) => card.sessionIds[0] ?? card.id;
  const generatedAt = new Map<string, number>();
  for (const card of sessionCards) {
    const time = Date.parse(card.createdAt);
    generatedAt.set(session(card), Math.min(time, generatedAt.get(session(card)) ?? time));
  }
  const time = (card: QueueCard) => generatedAt.get(session(card)) ?? Date.parse(card.createdAt);
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        time(b.item.card) - time(a.item.card) ||
        session(a.item.card).localeCompare(session(b.item.card)) ||
        setRank(a.item.card) - setRank(b.item.card) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}
