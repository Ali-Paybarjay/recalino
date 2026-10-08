/**
 * D49 learning memory: deterministic rules over owned evidence. Nothing here calls a model,
 * diagnoses a language weakness, or estimates CEFR, speaking or FSRS retention (PRD-PERS-03/04).
 */
export const MEMORY_WINDOW_DAYS = 30;
const LIST_LIMIT = 10;

export type MemoryStatus = "needs_practice" | "recalled_recently" | "practising";
/** A count label, defined in the UI: 1–2 answers little, 3–5 some, 6 or more more. */
export type EvidenceAmount = "little" | "some" | "more";
export type MemoryStudySet = "production" | "recognition" | "legacy";
export type FeedbackKind = "not_a_difficulty" | "explain_simpler";

export interface MemoryCardInput {
  cardId: string;
  learningItemId: string;
  status: string;
  studySet: MemoryStudySet;
  /** Plain-text fallback label, never markup. */
  fallbackLabel: string;
}
export interface MemoryEventInput {
  cardId: string;
  rating: number;
  at: string;
  order: number;
}
export interface MemoryGoalInput {
  learningItemId: string;
  sessionId: string | null;
  itemId: string | null;
  label: string | null;
  meaning: string | null;
  explanationLanguage: string | null;
  classDate: string | null;
  classTitle: string | null;
  courseId: string | null;
  courseName: string | null;
}
export interface MemoryFeedbackInput {
  learningItemId: string;
  kind: FeedbackKind;
  active: boolean;
  evidenceOrder: number | null;
  createdAt: string;
}

export interface MemoryItem {
  learningItemId: string;
  label: string;
  meaning: string | null;
  explanationLanguage: string | null;
  sessionId: string | null;
  itemId: string | null;
  classDate: string | null;
  classTitle: string | null;
  courseId: string | null;
  courseName: string | null;
  status: MemoryStatus;
  amount: EvidenceAmount;
  evidence: {
    reviews: number;
    again: number;
    recalled: number;
    /** Consecutive recalled answers after the latest Again, across this goal's cards. */
    recalledSinceLastAgain: number;
    firstReviewedAt: string;
    lastReviewedAt: string;
    lastAgainAt: string | null;
    /** Server order of the latest answer; a dismissal stores it as its baseline. */
    lastOrder: number;
    lastAgainOrder: number | null;
    studySets: MemoryStudySet[];
  };
  markedKnown: boolean;
  /** The learner said this is not a difficulty after the latest Again; a new Again re-opens it. */
  dismissed: boolean;
  feedback: { notADifficultyAt: string | null; explainSimplerAt: string | null };
  card: { id: string; due: boolean; dueAt: string | null };
  next: { kind: "review_class" | "open_card"; href: string };
}

export type NextStep =
  | { kind: "practise_item"; learningItemId: string; label: string; href: string; due: boolean }
  | { kind: "review_due"; count: number; href: string }
  | { kind: "nothing_due"; nextDueAt: string | null }
  | { kind: "no_cards"; href: string };

export interface LearningMemory {
  window: { from: string; to: string; days: number };
  /** Time of the latest saved answer considered, never the time this page was opened. */
  lastEvidenceAt: string | null;
  needsPractice: MemoryItem[];
  recalledRecently: MemoryItem[];
  dismissed: MemoryItem[];
  /** Goals the learner asked to have explained more simply; withdrawable at any time. */
  simplerRequests: MemoryItem[];
  practisingCount: number;
  nextStep: NextStep;
}

export function evidenceAmount(reviews: number): EvidenceAmount {
  return reviews >= 6 ? "more" : reviews >= 3 ? "some" : "little";
}

/** Latest row per goal and kind; append-only history stays in storage. */
export function currentFeedback(
  rows: readonly MemoryFeedbackInput[],
): Map<string, Partial<Record<FeedbackKind, MemoryFeedbackInput>>> {
  const current = new Map<string, Partial<Record<FeedbackKind, MemoryFeedbackInput>>>();
  for (const row of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const entry = current.get(row.learningItemId) ?? {};
    entry[row.kind] = row;
    current.set(row.learningItemId, entry);
  }
  return current;
}

/** Shared by the view and by feedback writes, so a dismissal baseline matches what was shown. */
export function summariseGoalEvents(events: readonly MemoryEventInput[]) {
  const ordered = [...events].sort((a, b) => a.order - b.order);
  let again = 0,
    recalledSinceLastAgain = 0,
    lastAgain: MemoryEventInput | undefined;
  for (const event of ordered) {
    if (event.rating === 1) {
      again += 1;
      lastAgain = event;
      recalledSinceLastAgain = 0;
    } else recalledSinceLastAgain += 1;
  }
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) return undefined;
  return {
    reviews: ordered.length,
    again,
    recalled: ordered.length - again,
    recalledSinceLastAgain,
    firstReviewedAt: first.at,
    lastReviewedAt: last.at,
    lastAgainAt: lastAgain?.at ?? null,
    lastOrder: last.order,
    lastAgainOrder: lastAgain?.order ?? null,
    lastCardId: last.cardId,
  };
}

/**
 * needs_practice: at least two Again/Forgot answers and fewer than two recalls since the latest.
 * recalled_recently: the last two answers reported recall. Anything else is still practising.
 */
export function goalStatus(summary: {
  again: number;
  recalledSinceLastAgain: number;
}): MemoryStatus {
  if (summary.again >= 2 && summary.recalledSinceLastAgain < 2) return "needs_practice";
  return summary.recalledSinceLastAgain >= 2 ? "recalled_recently" : "practising";
}

const reviewable = new Set(["active", "suspended", "known"]);

export function deriveLearningMemory(input: {
  now: Date;
  window: { from: string; to: string; days: number };
  cards: readonly MemoryCardInput[];
  events: readonly MemoryEventInput[];
  dueAt: Readonly<Record<string, string>>;
  goals: readonly MemoryGoalInput[];
  feedback: readonly MemoryFeedbackInput[];
  dueCount: number;
  nextDueAt: string | null;
  hasCards: boolean;
}): LearningMemory {
  const cards = new Map(input.cards.map((card) => [card.cardId, card]));
  const goals = new Map(input.goals.map((goal) => [goal.learningItemId, goal]));
  const feedback = currentFeedback(input.feedback);
  const grouped = new Map<string, MemoryEventInput[]>();
  for (const event of input.events) {
    const card = cards.get(event.cardId);
    // Rejected, deleted and unlinked cards leave the view; their history is not rewritten.
    if (!card || !reviewable.has(card.status)) continue;
    const list = grouped.get(card.learningItemId) ?? [];
    list.push(event);
    grouped.set(card.learningItemId, list);
  }
  const now = input.now.toISOString();
  const items: MemoryItem[] = [];
  let lastEvidenceAt: string | null = null;
  for (const [learningItemId, events] of grouped) {
    const summary = summariseGoalEvents(events);
    if (!summary) continue;
    const goal = goals.get(learningItemId);
    const goalCards = [...new Set(events.map((event) => event.cardId))]
      .map((id) => cards.get(id))
      .filter((card): card is MemoryCardInput => !!card);
    const latestCard = cards.get(summary.lastCardId) ?? goalCards[0];
    if (!latestCard) continue;
    const current = feedback.get(learningItemId) ?? {};
    const dismissal = current.not_a_difficulty;
    const dismissed =
      !!dismissal?.active &&
      (summary.lastAgainOrder === null ||
        (dismissal.evidenceOrder !== null && dismissal.evidenceOrder >= summary.lastAgainOrder));
    // A due, active card makes the practice link land on a real review question.
    const dueCard = goalCards.find((card) => {
      const due = input.dueAt[card.cardId];
      return card.status === "active" && due !== undefined && due <= now;
    });
    const linkCard = dueCard ?? latestCard;
    const sessionId = goal?.sessionId ?? null;
    if (!lastEvidenceAt || summary.lastReviewedAt > lastEvidenceAt)
      lastEvidenceAt = summary.lastReviewedAt;
    items.push({
      learningItemId,
      label: goal?.label || latestCard.fallbackLabel,
      meaning: goal?.meaning ?? null,
      explanationLanguage: goal?.explanationLanguage ?? null,
      sessionId,
      itemId: goal?.itemId ?? null,
      classDate: goal?.classDate ?? null,
      classTitle: goal?.classTitle ?? null,
      courseId: goal?.courseId ?? null,
      courseName: goal?.courseName ?? null,
      status: goalStatus(summary),
      amount: evidenceAmount(summary.reviews),
      evidence: {
        reviews: summary.reviews,
        again: summary.again,
        recalled: summary.recalled,
        recalledSinceLastAgain: summary.recalledSinceLastAgain,
        firstReviewedAt: summary.firstReviewedAt,
        lastReviewedAt: summary.lastReviewedAt,
        lastAgainAt: summary.lastAgainAt,
        lastOrder: summary.lastOrder,
        lastAgainOrder: summary.lastAgainOrder,
        studySets: [...new Set(goalCards.map((card) => card.studySet))].sort(),
      },
      markedKnown: goalCards.every((card) => card.status === "known"),
      dismissed,
      feedback: {
        notADifficultyAt: dismissal?.active ? dismissal.createdAt : null,
        explainSimplerAt: current.explain_simpler?.active
          ? current.explain_simpler.createdAt
          : null,
      },
      card: {
        id: linkCard.cardId,
        due: linkCard === dueCard,
        dueAt: input.dueAt[linkCard.cardId] ?? null,
      },
      next:
        dueCard && sessionId
          ? { kind: "review_class", href: `/review?sessionId=${encodeURIComponent(sessionId)}` }
          : { kind: "open_card", href: `/cards/${encodeURIComponent(linkCard.cardId)}` },
    });
  }
  const byRecentAgain = (a: MemoryItem, b: MemoryItem) =>
    (b.evidence.lastAgainAt ?? "").localeCompare(a.evidence.lastAgainAt ?? "") ||
    b.evidence.again - a.evidence.again ||
    a.learningItemId.localeCompare(b.learningItemId);
  const needsPractice = items
    .filter((item) => item.status === "needs_practice" && !item.dismissed && !item.markedKnown)
    .sort(byRecentAgain)
    .slice(0, LIST_LIMIT);
  const dismissed = items
    .filter((item) => item.status === "needs_practice" && item.dismissed && !item.markedKnown)
    .sort(byRecentAgain)
    .slice(0, LIST_LIMIT);
  const recalledRecently = items
    .filter((item) => item.status === "recalled_recently" && !item.markedKnown)
    .sort(
      (a, b) =>
        b.evidence.lastReviewedAt.localeCompare(a.evidence.lastReviewedAt) ||
        a.learningItemId.localeCompare(b.learningItemId),
    )
    .slice(0, LIST_LIMIT);
  const simplerRequests = items
    .filter((item) => item.feedback.explainSimplerAt !== null && !item.markedKnown)
    .sort(
      (a, b) =>
        (b.feedback.explainSimplerAt ?? "").localeCompare(a.feedback.explainSimplerAt ?? "") ||
        a.learningItemId.localeCompare(b.learningItemId),
    )
    .slice(0, LIST_LIMIT);
  const first = needsPractice[0];
  const nextStep: NextStep = first
    ? {
        kind: "practise_item",
        learningItemId: first.learningItemId,
        label: first.label,
        href: first.next.href,
        due: first.card.due,
      }
    : input.dueCount > 0
      ? { kind: "review_due", count: input.dueCount, href: "/review" }
      : input.hasCards
        ? { kind: "nothing_due", nextDueAt: input.nextDueAt }
        : { kind: "no_cards", href: "/classes" };
  return {
    window: input.window,
    lastEvidenceAt,
    needsPractice,
    recalledRecently,
    dismissed,
    simplerRequests,
    practisingCount: items.filter((item) => item.status === "practising").length,
    nextStep,
  };
}
