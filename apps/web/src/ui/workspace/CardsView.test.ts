import type { StudyCard } from "@recalino/core/card";
import type { Claim, KnowledgeModel } from "@recalino/core/lkm";
import type { Notebook } from "@recalino/core/note";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardsView } from "./CardsView";
import { undoOffer } from "./card-actions";
import { cardActionsCopy } from "./card-actions-copy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const claim: Claim = {
  id: "claim-1",
  text: "An explanation of already",
  origin: "ai_expansion",
  creation: "ai_generation",
  evidence: "ai",
  sourceRefs: [],
  speakerRole: "unknown",
  uncertain: false,
};
const model: KnowledgeModel = {
  schemaVersion: "1",
  title: "Synthetic class",
  language: { learning: "en", explanation: "en" },
  summary: [claim],
  topics: [],
  learningItems: [{ id: "item-1", kind: "grammar", front: "Already?", back: "Before now", claim }],
  homework: [],
  uncertainties: [],
  coverage: { complete: true, missingSourceIds: [] },
};
const notebook: Notebook = {
  id: "notebook-1",
  sessionId,
  current: {
    id: "revision-1",
    notebookId: "notebook-1",
    sessionId,
    number: 1,
    knowledgeVersionId: "knowledge-1",
    model,
    edits: { claims: {}, items: {} },
    createdAt: "2026-10-06T00:00:00Z",
  },
  proposedKnowledgeVersionId: null,
};
const candidate: StudyCard = {
  id: "card-1",
  ownerId: userId,
  learningItemId: "item-1",
  sessionIds: [sessionId],
  template: "basic",
  direction: "forward",
  front: "Already?",
  back: "Before now",
  provenance: claim,
  status: "candidate",
  contentVersion: 1,
  important: false,
  qualityConfirmed: false,
  frontMediaId: null,
  backMediaId: null,
  createdAt: "2026-10-06T00:00:00Z",
  updatedAt: "2026-10-06T00:00:00Z",
};
function render(overrides: Partial<Parameters<typeof CardsView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(CardsView, { sessionId, userId, initial: [], notebook: null, ...overrides }),
  );
}
describe("flashcard next actions", () => {
  it("points to adding material and explains automatic creation for an empty class", () => {
    const html = render();
    expect(html).toContain(`/sessions/${sessionId}/sources`);
    expect(html).toContain("automatically with your notes");
    expect(html).not.toContain("Prepare cards");
    expect(html).not.toContain("Review this session");
    expect(html).not.toContain("Publish session notes");
  });
  it("does not ask the learner to save notes or prepare cards when output is pending", () => {
    const html = render({ hasGeneratedNotes: true });
    expect(html).toContain("Session notes");
    expect(html).not.toContain("Read and save notes");
    expect(html).not.toContain(`/sessions/${sessionId}/estimate`);
  });
  it("only asks for confirmation for cards that still need checking", () => {
    const html = render({ notebook, initial: [candidate] });
    expect(html).not.toContain("Prepare cards");
    expect(html).toContain("Confirm and add");
    expect(html).not.toContain("Review this session");
  });
  it("offers review once cards have been added", () => {
    const html = render({ notebook, initial: [{ ...candidate, status: "active" }] });
    expect(html).toContain("Review this session");
    expect(html).toContain(`/review?sessionId=${sessionId}`);
  });
  it("explains the absence of learning items instead of an unexplained disabled action", () => {
    const html = render({
      notebook: {
        ...notebook,
        current: { ...notebook.current, model: { ...model, learningItems: [] } },
      },
    });
    expect(html).toContain("These notes contain no learning items for flashcards.");
    expect(html).not.toContain("Prepare cards");
  });
});

describe("rejecting a suggested card (UX-03)", () => {
  const rejected: StudyCard = { ...candidate, status: "rejected", contentVersion: 2 };

  it("offers Reject, and shows no Undo message until a card was rejected", () => {
    const html = render({ notebook, initial: [candidate] });
    expect(html).toContain("Reject");
    expect(html).not.toContain(cardActionsCopy.rejected);
    expect(html).not.toContain(">Undo<");
  });

  it("keeps Reject out of the way of the confirming action", () => {
    const html = render({ notebook, initial: [candidate] });
    expect(html.indexOf("Confirm and add")).toBeLessThan(html.indexOf("Reject"));
  });

  it("says the approved words after a rejection, and the card says it is rejected", () => {
    expect(cardActionsCopy.rejected).toBe("Card rejected");
    const html = render({ notebook, initial: [rejected] });
    expect(html).toContain("Rejected");
    expect(html).not.toContain("Confirm and add");
  });

  it("offers Undo only for a rejection that worked and never while a session is recorded", () => {
    expect(undoOffer("reject", rejected, false)).toBe(rejected);
    expect(undoOffer("reject", rejected, true)).toBeNull();
    expect(undoOffer("reject", undefined, false)).toBeNull();
    expect(undoOffer("activate", { ...candidate, status: "active" }, false)).toBeNull();
  });
});

// UX-05: a card says what it is in words, never the stored value.
describe("what a card says about itself (UX-05)", () => {
  it.each([
    ["candidate", "Suggested · Question and answer"],
    ["active", "In your review queue · Question and answer"],
    ["suspended", "Suspended · Question and answer"],
    ["known", "Known · Question and answer"],
    ["rejected", "Rejected · Question and answer"],
  ] as const)("shows a %s card as %s", (status, text) => {
    const html = render({ notebook, initial: [{ ...candidate, status }] });
    expect(html).toContain(`>${text}<`);
    for (const raw of [
      "candidate ·",
      "· forward ·",
      "· basic",
      "forward",
      "production",
      "recognition",
    ])
      expect(html).not.toContain(raw);
  });

  it("names the card type and importance", () => {
    const html = render({
      notebook,
      initial: [{ ...candidate, status: "active", template: "correction", important: true }],
    });
    expect(html).toContain(">In your review queue · Error correction · Important<");
  });

  it("names the study sets with the approved words of Your learning", () => {
    const html = render({
      notebook,
      initial: [
        { ...candidate, status: "active", studySet: "production", studyPosition: 1 },
        { ...candidate, id: "card-2", status: "active", studySet: "recognition", studyPosition: 2 },
      ],
    });
    expect(html).toContain("Core cards (1)");
    expect(html).toContain("Supplementary cards (1)");
    expect(html).not.toMatch(/Core · production|Supplementary · recognition/);
  });
});
