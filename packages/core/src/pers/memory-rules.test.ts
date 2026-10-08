import { describe, expect, it } from "vitest";
import {
  deriveLearningMemory,
  evidenceAmount,
  goalStatus,
  type MemoryCardInput,
  type MemoryEventInput,
  type MemoryFeedbackInput,
} from "./memory-rules";

const now = new Date("2026-10-08T12:00:00Z");
const window = { from: "2026-09-08T12:00:00.000Z", to: now.toISOString(), days: 30 };
const card = (id: string, item: string, status = "active"): MemoryCardInput => ({
  cardId: id,
  learningItemId: item,
  status,
  studySet: "production",
  fallbackLabel: `fallback ${id}`,
});
let order = 0;
const answer = (cardId: string, rating: number, day: number): MemoryEventInput => ({
  cardId,
  rating,
  at: `2026-10-0${day}T09:00:00.000Z`,
  order: ++order,
});
function memory(input: {
  cards: MemoryCardInput[];
  events: MemoryEventInput[];
  feedback?: MemoryFeedbackInput[];
  dueAt?: Record<string, string>;
  dueCount?: number;
}) {
  return deriveLearningMemory({
    now,
    window,
    cards: input.cards,
    events: input.events,
    dueAt: input.dueAt ?? {},
    goals: [
      {
        learningItemId: "goal-a",
        sessionId: "11111111-1111-4111-8111-111111111111",
        itemId: "look-forward",
        label: "look forward to + -ing / noun",
        meaning: "be pleased about something that will happen",
        explanationLanguage: "en",
        classDate: "2026-10-01",
        classTitle: "Synthetic class",
        courseId: "course",
        courseName: null,
      },
    ],
    feedback: input.feedback ?? [],
    dueCount: input.dueCount ?? 0,
    nextDueAt: null,
    hasCards: input.cards.length > 0,
  });
}

describe("D48 learning memory rules (PRD-PERS-03/05)", () => {
  it("labels evidence amounts by count only", () => {
    expect([1, 2, 3, 5, 6].map(evidenceAmount)).toEqual([
      "little",
      "little",
      "some",
      "some",
      "more",
    ]);
    expect(goalStatus({ again: 2, recalledSinceLastAgain: 1 })).toBe("needs_practice");
    expect(goalStatus({ again: 5, recalledSinceLastAgain: 2 })).toBe("recalled_recently");
    expect(goalStatus({ again: 1, recalledSinceLastAgain: 0 })).toBe("practising");
  });

  it("cold start has no inference, no evidence date and an honest next step", () => {
    const empty = memory({ cards: [], events: [] });
    expect(empty.lastEvidenceAt).toBeNull();
    expect(empty.needsPractice).toEqual([]);
    expect(empty.recalledRecently).toEqual([]);
    expect(empty.nextStep).toEqual({ kind: "no_cards", href: "/classes" });
    const quiet = memory({ cards: [card("c1", "goal-a")], events: [] });
    expect(quiet.nextStep).toEqual({ kind: "nothing_due", nextDueAt: null });
  });

  it("one Again is not a difficulty; two are a practice suggestion with dated reasons", () => {
    const once = memory({ cards: [card("c1", "goal-a")], events: [answer("c1", 1, 1)] });
    expect(once.needsPractice).toEqual([]);
    expect(once.practisingCount).toBe(1);
    const twice = memory({
      cards: [card("c1", "goal-a")],
      events: [answer("c1", 1, 1), answer("c1", 3, 2), answer("c1", 1, 3)],
      dueAt: { c1: "2026-10-08T11:00:00.000Z" },
    });
    const item = twice.needsPractice[0];
    expect(item).toMatchObject({
      label: "look forward to + -ing / noun",
      status: "needs_practice",
      amount: "some",
      evidence: { again: 2, reviews: 3, lastAgainAt: "2026-10-03T09:00:00.000Z" },
      card: { id: "c1", due: true },
      next: { kind: "review_class" },
    });
    expect(twice.lastEvidenceAt).toBe("2026-10-03T09:00:00.000Z");
    expect(twice.nextStep).toMatchObject({ kind: "practise_item", due: true });
  });

  it("recovers after two recalls across sibling cards of the same goal", () => {
    const result = memory({
      cards: [card("c1", "goal-a"), { ...card("c2", "goal-a"), studySet: "recognition" }],
      events: [answer("c1", 1, 1), answer("c2", 1, 2), answer("c2", 3, 3), answer("c1", 4, 4)],
    });
    expect(result.needsPractice).toEqual([]);
    expect(result.recalledRecently[0]?.evidence).toMatchObject({
      again: 2,
      recalledSinceLastAgain: 2,
      studySets: ["production", "recognition"],
    });
  });

  it("a learner correction hides the suggestion until a later Again re-opens it", () => {
    const events = [answer("c1", 1, 1), answer("c1", 1, 2)];
    const feedback: MemoryFeedbackInput[] = [
      {
        learningItemId: "goal-a",
        kind: "not_a_difficulty",
        active: true,
        evidenceOrder: events[1]?.order ?? 0,
        createdAt: "2026-10-02T10:00:00.000Z",
      },
    ];
    const hidden = memory({ cards: [card("c1", "goal-a")], events, feedback });
    expect(hidden.needsPractice).toEqual([]);
    expect(hidden.dismissed[0]?.feedback.notADifficultyAt).toBe("2026-10-02T10:00:00.000Z");
    const reopened = memory({
      cards: [card("c1", "goal-a")],
      events: [...events, answer("c1", 1, 3)],
      feedback,
    });
    expect(reopened.needsPractice).toHaveLength(1);
    expect(reopened.dismissed).toEqual([]);
    // Withdrawing the correction is a newer row; history is kept, the current state wins.
    const withdrawn = memory({
      cards: [card("c1", "goal-a")],
      events,
      feedback: [
        ...feedback,
        {
          ...feedback[0],
          active: false,
          createdAt: "2026-10-04T10:00:00.000Z",
        } as MemoryFeedbackInput,
      ],
    });
    expect(withdrawn.needsPractice).toHaveLength(1);
  });

  it("deleted, rejected and known cards never produce a practice suggestion", () => {
    const events = [answer("c1", 1, 1), answer("c1", 1, 2)];
    for (const status of ["deleted", "rejected", "known"]) {
      const result = memory({ cards: [card("c1", "goal-a", status)], events });
      expect(result.needsPractice, status).toEqual([]);
    }
    // A card absent from the owner's live list (another account or a deleted class) is ignored.
    expect(memory({ cards: [], events }).lastEvidenceAt).toBeNull();
  });

  it("asks for a card review only when a practice card is actually due", () => {
    const result = memory({
      cards: [card("c1", "goal-a")],
      events: [answer("c1", 1, 1), answer("c1", 1, 2)],
      dueAt: { c1: "2026-10-09T09:00:00.000Z" },
      dueCount: 4,
    });
    expect(result.nextStep).toMatchObject({ kind: "practise_item", due: false, href: "/cards/c1" });
  });
});
