import type { StudyCard } from "@recalino/core/card";
import type { Claim, KnowledgeModel } from "@recalino/core/lkm";
import type { Notebook } from "@recalino/core/note";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardsView } from "./CardsView";

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
    expect(html).toContain(`/classes/${sessionId}/sources`);
    expect(html).toContain("automatically with your notes");
    expect(html).not.toContain("Prepare cards");
    expect(html).not.toContain("Review this class");
    expect(html).not.toContain("Publish class notes");
  });
  it("does not ask the learner to save notes or prepare cards when output is pending", () => {
    const html = render({ hasGeneratedNotes: true });
    expect(html).toContain("Class notes");
    expect(html).not.toContain("Read and save notes");
    expect(html).not.toContain(`/classes/${sessionId}/estimate`);
  });
  it("only asks for confirmation for cards that still need checking", () => {
    const html = render({ notebook, initial: [candidate] });
    expect(html).not.toContain("Prepare cards");
    expect(html).toContain("Confirm and add");
    expect(html).not.toContain("Review this class");
  });
  it("offers review once cards have been added", () => {
    const html = render({ notebook, initial: [{ ...candidate, status: "active" }] });
    expect(html).toContain("Review this class");
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
