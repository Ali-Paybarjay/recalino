import type { Claim, KnowledgeModel, KnowledgeVersion } from "@recalino/core/lkm";
import type { Notebook, NotebookRevision } from "@recalino/core/note";
import { type ButtonHTMLAttributes, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteView } from "./NoteView";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  buttons: new Map<string, { disabled: boolean; click: () => unknown }>(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  workspaceRequest: mocks.request,
}));
vi.mock("./primitives", async (original) => {
  const primitives = await original<typeof import("./primitives")>();
  return {
    ...primitives,
    Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) => {
      if (typeof props.children === "string")
        mocks.buttons.set(props.children, {
          disabled: props.disabled ?? false,
          click: () => props.onClick?.({} as MouseEvent<HTMLButtonElement>),
        });
      return createElement(primitives.Button, props);
    },
  };
});

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
function claim(id: string, text: string): Claim {
  return {
    id,
    text,
    origin: "ai_expansion",
    creation: "ai_generation",
    evidence: "ai",
    sourceRefs: [],
    speakerRole: "unknown",
    uncertain: false,
  };
}
const model: KnowledgeModel = {
  schemaVersion: "1",
  title: "Synthetic class preview",
  language: { learning: "en", explanation: "en" },
  summary: [claim("summary", "Preview summary text")],
  topics: [{ id: "topic", title: "Preview topic", claims: [claim("topic-claim", "Topic text")] }],
  learningItems: [
    {
      id: "item",
      kind: "vocabulary",
      front: "Preview question",
      back: "Preview answer",
      claim: claim("item-claim", "Learning claim"),
    },
  ],
  homework: [claim("homework", "Preview homework")],
  uncertainties: [claim("uncertain", "Preview uncertainty")],
  coverage: { complete: false, missingSourceIds: [userId] },
};
const latest: KnowledgeVersion = {
  id: "10000000-0000-4000-8000-000000000003",
  sessionId,
  runId: "10000000-0000-4000-8000-000000000004",
  version: 2,
  sourcesVersion: 4,
  sourceFingerprint: "synthetic-selection",
  model,
  generation: {},
  createdAt: "2026-10-06T10:00:00.000Z",
};
const revision: NotebookRevision = {
  id: "10000000-0000-4000-8000-000000000005",
  notebookId: "10000000-0000-4000-8000-000000000006",
  sessionId,
  number: 1,
  knowledgeVersionId: "10000000-0000-4000-8000-000000000007",
  model: {
    ...model,
    title: "Saved learner notes",
    summary: [claim("saved", "Saved learner edit")],
  },
  edits: { claims: { saved: "Saved learner edit" }, items: {} },
  createdAt: "2026-10-05T10:00:00.000Z",
};
const notebook: Notebook = {
  id: revision.notebookId,
  sessionId,
  current: revision,
  proposedKnowledgeVersionId: "10000000-0000-4000-8000-000000000008",
};

function render(props: Partial<Parameters<typeof NoteView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(NoteView, { sessionId, userId, initial: null, latest, ...props }),
  );
}
function click(label: string) {
  const button = mocks.buttons.get(label);
  expect(button).toBeDefined();
  expect(button?.disabled).toBe(false);
  return button?.click();
}
beforeEach(() => {
  mocks.request.mockReset();
  mocks.refresh.mockReset();
  mocks.push.mockReset();
  mocks.buttons.clear();
});

describe("notes before saving", () => {
  it("shows the complete generated preview without enabling edits, cards, or exports", () => {
    const html = render();
    for (const text of [
      model.title,
      "Preview summary text",
      "Preview topic",
      "Topic text",
      "Preview question",
      "Preview answer",
      "Preview homework",
      "Preview uncertainty",
      "AI expansion",
      "Some class material is missing.",
      "Read-only preview",
      "Save class notes",
      "Save notes and make flashcards",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Edit this note");
    expect(html).not.toContain("Edit question");
    expect(html).not.toContain("Edit answer");
    expect(html).not.toContain(`href="/classes/${sessionId}/cards"`);
    expect(html).not.toContain(`href="/classes/${sessionId}/export"`);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("offers processing saved material or changing sources when no notes exist", () => {
    const html = render({ latest: null });
    expect(html).toContain("Start with class material");
    expect(html).toContain("Create class notes");
    expect(html).toContain(`href="/classes/${sessionId}/estimate"`);
    expect(html).toContain("Add or change material");
    expect(html).toContain(`href="/classes/${sessionId}/sources"`);
    expect(html).not.toContain("Save class notes");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("saves the preview through the existing API with a first-revision concurrency check", async () => {
    mocks.request.mockResolvedValue(notebook);
    render();
    await click("Save class notes");
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      `/api/classes/${sessionId}/notes`,
      "POST",
      { expectedRevisionId: null, knowledgeVersionId: latest.id },
      expect.any(String),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("opens cards only after saving succeeds and ignores a second click while saving", async () => {
    let resolveSave: ((value: Notebook) => void) | undefined;
    const pending = new Promise<Notebook>((resolve) => {
      resolveSave = resolve;
    });
    mocks.request.mockReturnValue(pending);
    render();
    const saving = click("Save notes and make flashcards");
    await click("Save class notes");
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    resolveSave?.(notebook);
    await saving;
    expect(mocks.request).toHaveBeenCalledWith(
      `/api/classes/${sessionId}/notes`,
      "POST",
      { expectedRevisionId: null, knowledgeVersionId: latest.id },
      expect.any(String),
    );
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/classes/${sessionId}/cards`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the idempotency key after a failed save and never navigates on failure", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Synthetic connection failure"));
    render();
    await click("Save notes and make flashcards");
    const firstKey = mocks.request.mock.calls[0]?.[3];
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue(notebook);
    await click("Save notes and make flashcards");
    expect(mocks.request.mock.calls[1]?.[3]).toBe(firstKey);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/classes/${sessionId}/cards`);
  });
});

describe("saved notes and revisions", () => {
  it("preserves saved edits while giving an explicit next action and newer-version choice", () => {
    const html = render({ initial: notebook });
    expect(html).toContain("Saved learner notes");
    expect(html).toContain("Saved learner edit");
    expect(html).not.toContain(model.title);
    expect(html).toContain("Edit this note");
    expect(html).toContain("Next: make flashcards");
    expect(html).toContain("Make flashcards");
    expect(html).toContain(`href="/classes/${sessionId}/cards"`);
    expect(html).toContain(`href="/classes/${sessionId}/export"`);
    expect(html).toContain("Apply newer version");
    expect(html).not.toContain("Save class notes");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("applies a proposed version only on an explicit action with the saved revision check", async () => {
    mocks.request.mockResolvedValue(notebook);
    render({ initial: notebook });
    await click("Apply newer version");
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      `/api/classes/${sessionId}/notes`,
      "POST",
      {
        expectedRevisionId: revision.id,
        knowledgeVersionId: notebook.proposedKnowledgeVersionId,
      },
      expect.any(String),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps an explicitly opened older revision read-only instead of showing the latest preview", () => {
    const html = render({ initial: notebook, readOnlyRevision: revision });
    expect(html).toContain("Saved learner notes");
    expect(html).toContain("Note version 1");
    expect(html).not.toContain("Read-only preview");
    expect(html).not.toContain("Edit this note");
    expect(html).not.toContain("Apply newer version");
    expect(html).not.toContain("Save class notes");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
