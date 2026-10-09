import { studyLexicalTarget } from "../lkm";

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
    studySets: MemoryStudySet[];
  };
  markedKnown: boolean;
  /** The learner said this is not a difficulty after the latest Again; a new Again re-opens it. */
  dismissed: boolean;
  feedback: { notADifficultyAt: string | null; explainSimplerAt: string | null };
  /**
   * A later run can use an "explain more simply" request only for a class goal in a course
   * with a lexical target; otherwise the control is not offered (practiceCandidatesForRun).
   */
  simplerApplies: boolean;
  /** `due` only when the review queue offers this card now (same rules, incl. sibling burying). */
  card: { id: string; due: boolean };
  next: { kind: "review_class" | "open_card"; href: string };
}

/** A standing "explain it more simply" request; it lasts until withdrawn, not for a window. */
export interface SimplerRequest {
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
  askedAt: string;
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
  simplerRequests: SimplerRequest[];
  practisingCount: number;
  nextStep: NextStep;
}

export function evidenceAmount(reviews: number): EvidenceAmount {
  return reviews >= 6 ? "more" : reviews >= 3 ? "some" : "little";
}

/** A stored instant as the learner's local calendar date, "YYYY-MM-DD"; invalid zones use UTC. */
export function localDate(at: string, timeZone: string): string {
  const instant = new Date(at);
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
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

/** Whether a dismissal still covers the goal: it must postdate the goal's latest Again. */
export function dismissalCovers(
  dismissal: MemoryFeedbackInput | undefined,
  lastAgainOrder: number | null,
): boolean {
  return (
    !!dismissal?.active &&
    (lastAgainOrder === null ||
      (dismissal.evidenceOrder !== null && dismissal.evidenceOrder >= lastAgainOrder))
  );
}

export function simplerApplies(goal: MemoryGoalInput | undefined, label: string): boolean {
  return !!goal?.sessionId && !!goal.courseId && !!studyLexicalTarget(label);
}

function goalFields(goal: MemoryGoalInput | undefined) {
  return {
    meaning: goal?.meaning ?? null,
    explanationLanguage: goal?.explanationLanguage ?? null,
    sessionId: goal?.sessionId ?? null,
    itemId: goal?.itemId ?? null,
    classDate: goal?.classDate ?? null,
    classTitle: goal?.classTitle ?? null,
    courseId: goal?.courseId ?? null,
    courseName: goal?.courseName ?? null,
  };
}

/**
 * `limit` bounds each list shown on Your learning; run candidates pass no limit so a class or
 * course point is never dropped by another course's items before the scope filter.
 */
export function deriveLearningMemory(input: {
  window: { from: string; to: string; days: number };
  cards: readonly MemoryCardInput[];
  events: readonly MemoryEventInput[];
  /** Cards the review queue offers right now (`cardsOfferedForReview`). */
  offered: ReadonlySet<string>;
  goals: readonly MemoryGoalInput[];
  feedback: readonly MemoryFeedbackInput[];
  dueCount: number;
  nextDueAt: string | null;
  hasCards: boolean;
  limit?: number;
}): LearningMemory {
  const limit = input.limit ?? LIST_LIMIT;
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
    const sessionId = goal?.sessionId ?? null;
    // "Review now" only when the class review would really show this goal's card next.
    const offeredCard = sessionId
      ? input.cards.find(
          (card) =>
            card.learningItemId === learningItemId &&
            card.status === "active" &&
            input.offered.has(card.cardId),
        )
      : undefined;
    const linkCard = offeredCard ?? latestCard;
    if (!lastEvidenceAt || summary.lastReviewedAt > lastEvidenceAt)
      lastEvidenceAt = summary.lastReviewedAt;
    items.push({
      learningItemId,
      label: goal?.label || latestCard.fallbackLabel,
      ...goalFields(goal),
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
        studySets: [...new Set(goalCards.map((card) => card.studySet))].sort(),
      },
      markedKnown: goalCards.every((card) => card.status === "known"),
      dismissed: dismissalCovers(dismissal, summary.lastAgainOrder),
      feedback: {
        notADifficultyAt: dismissal?.active ? dismissal.createdAt : null,
        explainSimplerAt: current.explain_simpler?.active
          ? current.explain_simpler.createdAt
          : null,
      },
      simplerApplies: simplerApplies(goal, goal?.label || latestCard.fallbackLabel),
      card: { id: linkCard.cardId, due: !!offeredCard },
      next:
        offeredCard && sessionId
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
    .slice(0, limit);
  const dismissed = items
    .filter((item) => item.status === "needs_practice" && item.dismissed && !item.markedKnown)
    .sort(byRecentAgain)
    .slice(0, limit);
  const recalledRecently = items
    .filter((item) => item.status === "recalled_recently" && !item.markedKnown)
    .sort(
      (a, b) =>
        b.evidence.lastReviewedAt.localeCompare(a.evidence.lastReviewedAt) ||
        a.learningItemId.localeCompare(b.learningItemId),
    )
    .slice(0, limit);
  // A request stands until withdrawn, with or without answers in the evidence window, while
  // the goal still has a reviewable card that is not marked known and a run can use it.
  const simplerRequests: SimplerRequest[] = [];
  for (const [learningItemId, current] of feedback) {
    const request = current.explain_simpler;
    if (!request?.active) continue;
    const goalCards = input.cards.filter(
      (card) => card.learningItemId === learningItemId && reviewable.has(card.status),
    );
    const first = goalCards[0];
    if (!first || goalCards.every((card) => card.status === "known")) continue;
    const goal = goals.get(learningItemId);
    const label = goal?.label || first.fallbackLabel;
    // A request no run can use is not listed as if it would be (see simplerApplies).
    if (!simplerApplies(goal, label)) continue;
    simplerRequests.push({
      learningItemId,
      label,
      ...goalFields(goal),
      askedAt: request.createdAt,
    });
  }
  simplerRequests.sort(
    (a, b) =>
      b.askedAt.localeCompare(a.askedAt) || a.learningItemId.localeCompare(b.learningItemId),
  );
  const first = needsPractice[0];
  const nextStep: NextStep = first
    ? {
        kind: "practise_item",
        learningItemId: first.learningItemId,
        label: first.label,
        href: first.next.href,
        due: first.next.kind === "review_class",
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
    simplerRequests: simplerRequests.slice(0, limit),
    practisingCount: items.filter((item) => item.status === "practising").length,
    nextStep,
  };
}
