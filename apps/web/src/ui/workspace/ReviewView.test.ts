import type { StudyCard } from "@recalino/core/card";
import { DEFAULT_REVIEW_SETTINGS, type ReviewQueue } from "@recalino/core/srs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../strings";
import { ListeningAnswer, ReviewView } from "./ReviewView";

const userId = "10000000-0000-4000-8000-000000000002";
const claim = {
  id: "claim-1",
  text: "Already",
  origin: "from_class",
  creation: "ai_generation",
  evidence: "ai",
  sourceRefs: [],
  speakerRole: "unknown",
  uncertain: false,
} as unknown as StudyCard["provenance"];
const card: StudyCard = {
  id: "card-1",
  ownerId: userId,
  learningItemId: "item-1",
  sessionIds: ["10000000-0000-4000-8000-000000000001"],
  template: "basic",
  direction: "forward",
  front: "Already?",
  back: "Before now",
  provenance: claim,
  status: "active",
  contentVersion: 1,
  important: false,
  qualityConfirmed: true,
  frontMediaId: null,
  backMediaId: null,
  createdAt: "2026-10-06T00:00:00Z",
  updatedAt: "2026-10-06T00:00:00Z",
};
const queue: ReviewQueue = {
  cards: [],
  hasCards: false,
  dueCount: 0,
  newRemaining: 0,
  buriedSiblings: 0,
  nextDueAt: null,
  studyDay: "2026-10-18",
  timezone: "Europe/London",
  settings: DEFAULT_REVIEW_SETTINGS,
};
const render = (initial: ReviewQueue) =>
  renderToStaticMarkup(createElement(ReviewView, { initial, userId }));

describe("review empty states (UX-12)", () => {
  it("says there are no cards yet when the learner has none at all", () => {
    const html = render(queue);
    expect(html).toContain(strings.empty.review);
    expect(html).not.toContain("No cards are due right now.");
    expect(html).not.toContain("ready for a break");
  });

  it("says nothing is due when cards exist but none is due now", () => {
    const html = render({ ...queue, hasCards: true, nextDueAt: "2026-10-20T09:00:00Z" });
    expect(html).toContain("No cards are due right now.");
    expect(html).toContain("ready for a break");
    expect(html).not.toContain(strings.empty.review);
  });
});

describe("review card focus (A11Y-03)", () => {
  const due: ReviewQueue = {
    ...queue,
    hasCards: true,
    dueCount: 1,
    cards: [
      {
        card,
        schedule: {
          cardId: card.id,
          version: 1,
          state: {} as ReviewQueue["cards"][number]["schedule"]["state"],
          dueAt: "2026-10-18T08:00:00Z",
          introducedAt: null,
        },
      },
    ],
  };

  it("keeps the answer region focusable and Show answer outside of it", () => {
    const html = render(due);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Show answer");
    // The question is in the region that receives focus; the button that is replaced is not.
    const region = html.indexOf('tabindex="-1"');
    expect(html.indexOf("Already?")).toBeGreaterThan(region);
    expect(html.indexOf("Show answer")).toBeGreaterThan(html.indexOf("Already?"));
    expect(html).not.toContain("Before now");
  });
});

describe("listening answer (A11Y-02)", () => {
  it("follows the direction of the learner's own text and keeps its line breaks", () => {
    const html = renderToStaticMarkup(
      createElement(ListeningAnswer, { text: "او گفت: «I can\u2019t fault it»\nدرست است" }),
    );
    expect(html).toContain('<p dir="auto" style="white-space:pre-wrap">');
    expect(html).toContain("I can\u2019t fault it");
  });
});
