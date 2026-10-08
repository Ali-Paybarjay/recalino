import type { LearningMemory, MemoryItem } from "@recalino/core/pers";
import type { LessonAdaptationView } from "@recalino/core/proc";
import { type ButtonHTMLAttributes, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LearningMemoryPanel, memoryDate, NextStepPanel } from "./LearningMemory";
import { LessonAdaptation } from "./LessonAdaptation";

const buttons = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock("./primitives", async (original) => {
  const primitives = await original<typeof import("./primitives")>();
  return {
    ...primitives,
    Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) => {
      buttons.set(String(props.children), () =>
        props.onClick?.({} as MouseEvent<HTMLButtonElement>),
      );
      return createElement(primitives.Button, props);
    },
  };
});

const item: MemoryItem = {
  learningItemId: "20000000-0000-4000-8000-000000000002",
  label: "look forward to + -ing / noun",
  meaning: "منتظر چیزی بودن و از آن خوشحال بودن",
  explanationLanguage: "fa",
  sessionId: "10000000-0000-4000-8000-000000000001",
  itemId: "look-forward",
  classDate: "2026-10-01",
  classTitle: "Synthetic class",
  courseId: "30000000-0000-4000-8000-000000000003",
  courseName: "Synthetic course",
  status: "needs_practice",
  amount: "some",
  evidence: {
    reviews: 3,
    again: 2,
    recalled: 1,
    recalledSinceLastAgain: 0,
    firstReviewedAt: "2026-10-02T08:00:00.000Z",
    lastReviewedAt: "2026-10-06T23:30:00.000Z",
    lastAgainAt: "2026-10-06T23:30:00.000Z",
    lastOrder: 9,
    lastAgainOrder: 9,
    studySets: ["production"],
  },
  markedKnown: false,
  dismissed: false,
  feedback: { notADifficultyAt: null, explainSimplerAt: null },
  card: { id: "40000000-0000-4000-8000-000000000004", due: true, dueAt: null },
  next: { kind: "review_class", href: "/review?sessionId=10000000-0000-4000-8000-000000000001" },
};
const memory: LearningMemory = {
  window: { from: "2026-09-08T12:00:00.000Z", to: "2026-10-08T12:00:00.000Z", days: 30 },
  lastEvidenceAt: item.evidence.lastReviewedAt,
  needsPractice: [item],
  recalledRecently: [],
  dismissed: [],
  simplerRequests: [],
  practisingCount: 0,
  nextStep: {
    kind: "practise_item",
    learningItemId: item.learningItemId,
    label: item.label,
    href: item.next.href,
    due: true,
  },
};

beforeEach(() => buttons.clear());

describe("D49 Your learning memory view", () => {
  it("shows dated, scoped evidence with a working next step and no level claim", () => {
    const html = renderToStaticMarkup(
      createElement(LearningMemoryPanel, {
        memory,
        timeZone: "Europe/London",
        busy: false,
        onFeedback: () => {},
      }),
    );
    expect(html).toContain("look forward to + -ing / noun");
    expect(html).toContain('lang="fa" dir="auto"');
    // 23:30 UTC on 6 October is 00:30 on 7 October in London.
    expect(html).toContain("most recently on 7 Oct 2026");
    expect(html).toContain("Evidence: some (3 answers; recalled from its meaning).");
    expect(html).toContain("From your class on 1 Oct 2026 · Synthetic course");
    expect(html).toContain(`href="${item.next.href}"`);
    expect(html).not.toMatch(/mastery|mastered|CEFR level is|your weakness/i);
    const next = renderToStaticMarkup(
      createElement(NextStepPanel, { memory, timeZone: "Europe/London" }),
    );
    expect(next).toContain("Practise “look forward to + -ing / noun” in review now.");
  });

  it("sends one stable key per correction so a retry cannot apply it twice", () => {
    const sent: { body: unknown; key: string }[] = [];
    renderToStaticMarkup(
      createElement(LearningMemoryPanel, {
        memory,
        timeZone: "UTC",
        busy: false,
        onFeedback: (body, key) => sent.push({ body, key }),
      }),
    );
    buttons.get("This isn't a difficulty for me")?.();
    buttons.get("This isn't a difficulty for me")?.();
    buttons.get("Explain it more simply next time")?.();
    expect(sent[0]?.body).toEqual({
      learningItemId: item.learningItemId,
      kind: "not_a_difficulty",
      active: true,
    });
    expect(sent[0]?.key).toBe(sent[1]?.key);
    expect(sent[2]?.key).not.toBe(sent[0]?.key);
    expect(sent[2]?.body).toMatchObject({ kind: "explain_simpler", active: true });
  });

  it("states a cold start honestly", () => {
    const html = renderToStaticMarkup(
      createElement(LearningMemoryPanel, {
        memory: {
          ...memory,
          lastEvidenceAt: null,
          needsPractice: [],
          nextStep: { kind: "no_cards", href: "/classes" },
        },
        timeZone: "UTC",
        busy: false,
        onFeedback: () => {},
      }),
    );
    expect(html).toContain("Not enough evidence yet.");
    expect(html).not.toContain("Latest answer considered");
    expect(memoryDate("2026-10-08T00:00:00.000Z", "Not/AZone")).toBe("2026-10-08");
  });

  it("explains a lesson adaptation from recorded inputs only", () => {
    const adaptation: LessonAdaptationView = {
      declaredLevel: "B1",
      goal: "none",
      shorterExamples: false,
      simplerExplanations: true,
      focus: [
        {
          target: "look forward to + -ing / noun",
          reason: "recall_difficulty",
          scope: "same_course",
          lastEvidenceDate: "2026-10-06",
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(LessonAdaptation, { adaptation }));
    expect(html).toContain("Your chosen level: B1");
    expect(html).not.toContain("Your goal");
    expect(html).toContain("Simpler explanations (your choice)");
    expect(html).toContain("“look forward to + -ing / noun” appears in this lesson.");
    expect(html).toContain("not a test result");
    expect(
      renderToStaticMarkup(
        createElement(LessonAdaptation, {
          adaptation: { shorterExamples: false, simplerExplanations: false, focus: [] },
        }),
      ),
    ).toBe("");
  });
});
