import type { Claim, KnowledgeModel, KnowledgeVersion } from "@recalino/core/lkm";
import type { Notebook, NotebookRevision } from "@recalino/core/note";
import { type ButtonHTMLAttributes, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteView } from "./NoteView";
import type { NoteSourceIssue } from "./note-source-issues";

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

describe("generated previews and automatic preparation", () => {
  it("AC-EE-01/07 scopes advisory reviews to saved generated material and excludes edits", () => {
    const html = render({ initial: notebook });
    expect(html).toContain("Lesson quality review");
    expect(html).toContain(`Generated version ID: <bdi>${revision.knowledgeVersionId}</bdi>`);
    expect(html).not.toContain(`Generated version ID: <bdi>${latest.id}</bdi>`);
    expect(html).toContain("These notes contain your edits.");
    expect(html).toContain("not human approval or a test of your level");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("AC-EE-01 keeps review actions out of historical note revisions", () => {
    expect(render({ initial: notebook, readOnlyRevision: revision })).not.toContain(
      "Lesson quality review",
    );
    expect(render({ initial: null, latest: null })).not.toContain("Lesson quality review");
  });

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
      "Some source details need checking.",
      "Read-only preview",
      "New uploads automatically save your notes and flashcards.",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Edit this note");
    expect(html).not.toContain("Edit question");
    expect(html).not.toContain("Edit answer");
    expect(html).not.toContain(`href="/sessions/${sessionId}/cards"`);
    expect(html).not.toContain(`href="/sessions/${sessionId}/export"`);
    expect(html).not.toContain("Version history");
    expect(html).not.toContain("Your session notes are ready");
    expect(html).not.toContain("Save notes and make flashcards");
    expect(html).not.toContain(">Save notes<");
    expect(html).toMatch(/<details[^>]*><summary>AI explanation<\/summary>/);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("offers material upload without a manual creation step when no notes exist", () => {
    const html = render({ latest: null });
    expect(html).toContain("Start with session material");
    expect(html).not.toContain("Create session notes");
    expect(html).not.toContain(`href="/sessions/${sessionId}/estimate"`);
    expect(html).toContain("Add material");
    expect(html).toContain("Notes and flashcards are created and saved automatically.");
    expect(html).toContain(`href="/sessions/${sessionId}/sources"`);
    expect(html).not.toContain(">Save notes<");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("shows the selected filenames and truthful upload status before creation", () => {
    const html = render({
      latest: null,
      materialSources: [
        { sourceId: "audio", name: "Class recording", order: 1, status: "local-audio" },
        { sourceId: "pdf", name: "Worksheet.pdf", order: 2, status: "ready" },
        { sourceId: "image", name: "Board.jpeg", order: 3, status: "needs-upload" },
        { sourceId: "pending", name: "Handout.pdf", order: 4, status: "uploading" },
      ],
    });
    expect(html).toContain("File 1 · <bdi>Class recording</bdi>");
    expect(html).toContain("Saved on this device · automatic upload pending");
    expect(html).toContain("Worksheet.pdf");
    expect(html).toContain("Ready");
    expect(html).toContain("Upload file 3 again");
    expect(html).toContain("Uploading…");
    expect(html).not.toContain("Upload file 1 again");
    expect(html).not.toContain("Create session notes");
    expect(html).toContain("Add material");
  });
});

describe("saved notes and revisions", () => {
  it("opens saved notes in reading mode with optional tools after the content", () => {
    const html = render({ initial: notebook, courseId: "course-1" });
    expect(html).toContain("Saved learner notes");
    expect(html).toContain("Saved learner edit");
    expect(html).not.toContain(model.title);
    expect(html).not.toContain("Edit this note");
    expect(html).not.toContain("Edit question");
    expect(html).not.toContain("Edit answer");
    expect(html).toContain("Edit notes");
    expect(html).not.toContain("Next: make flashcards");
    expect(html).toContain("Flashcards");
    expect(html).not.toContain("Make flashcards");
    expect(html).toContain(`href="/sessions/${sessionId}/cards"`);
    expect(html).toContain(`href="/sessions/${sessionId}/export"`);
    expect(html).toContain('href="/courses/course-1/materials"');
    expect(html).not.toContain("Apply newer version");
    expect(html).not.toContain(">Save notes<");
    expect(html.indexOf("Preview uncertainty")).toBeLessThan(html.indexOf("<footer"));
    expect(html).toContain("Add material");
    expect(html.match(/Back to session/g)).toHaveLength(1);
    expect(html).not.toContain("Back to course");
    expect(html).not.toContain("Version history");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("keeps an explicitly opened older revision read-only instead of showing the latest preview", () => {
    const html = render({ initial: notebook, readOnlyRevision: revision });
    expect(html).toContain("Saved learner notes");
    expect(html).toContain("Note version 1");
    expect(html).not.toContain("Read-only preview");
    expect(html).not.toContain("Edit this note");
    expect(html).not.toContain("Apply newer version");
    expect(html).not.toContain(">Save notes<");
    expect(html).not.toContain("Edit notes");
    expect(html).toContain("Current notes");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("offers history only when an earlier saved revision exists", () => {
    expect(render({ initial: notebook, hasEarlierVersions: true })).toContain("Version history");
    expect(render({ initial: notebook, hasEarlierVersions: false })).not.toContain(
      "Version history",
    );
    expect(render({ initial: { ...notebook, current: { ...revision, number: 2 } } })).toContain(
      "Version history",
    );
  });
});

describe("class material diagnostics", () => {
  const recovery = {
    sourceId: userId,
    contentVersionId: "10000000-0000-4000-8000-000000000009",
    knowledgeVersionId: latest.id,
    expectedSourcesVersion: latest.sourcesVersion,
  };
  const failedSource: NoteSourceIssue = {
    sourceId: userId,
    name: "Worksheet 2.pdf",
    order: 2,
    kind: "extraction",
    message: "The file is saved, but its text could not be read.",
    details: "The previous text extraction failed.",
    locator: "Pages 1–2",
    action: "retry",
    recovery,
  };

  it("names affected material, keeps details collapsed, and gives the correct recovery action", () => {
    const html = render({ sourceIssues: [failedSource] });
    expect(html).toContain("File 2 · <bdi>Worksheet 2.pdf</bdi>");
    expect(html).toContain(failedSource.message);
    expect(html).toContain("Pages 1–2");
    expect(html).toContain("Retry file 2");
    expect(html).toMatch(/<details[^>]*><summary>Details<\/summary>/);
    expect(html).not.toContain("Some session material is missing");
    expect(html).not.toContain("Upload file 2 again");
  });

  it("retries only the named saved source and resumes automatic preparation", async () => {
    mocks.request.mockResolvedValue({ next: `/sessions/${sessionId}/estimate` });
    render({ sourceIssues: [failedSource] });
    await click("Retry file 2");
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      `/api/classes/${sessionId}/notes/recovery`,
      "POST",
      recovery,
      expect.any(String),
    );
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      `/api/classes/${sessionId}/learning`,
      "POST",
      { action: "retry" },
      expect.any(String),
    );
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/sessions/${sessionId}/processing`);
  });

  it("preserves a recovery request key on failure and prevents duplicate retries", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Synthetic retry failure"));
    render({ sourceIssues: [failedSource] });
    await click("Retry file 2");
    const firstKey = mocks.request.mock.calls[0]?.[3];
    expect(mocks.push).not.toHaveBeenCalled();
    let resolveRecovery: ((value: { next: string }) => void) | undefined;
    mocks.request.mockReturnValue(
      new Promise<{ next: string }>((resolve) => {
        resolveRecovery = resolve;
      }),
    );
    const pending = click("Retry file 2");
    await click("Retry file 2");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1]?.[3]).toBe(firstKey);
    resolveRecovery?.({ next: `/sessions/${sessionId}/estimate` });
    mocks.request.mockResolvedValue({});
    await pending;
  });

  it("asks for a re-upload only when the source is unavailable", () => {
    const html = render({
      sourceIssues: [
        {
          ...failedSource,
          kind: "upload",
          action: "upload",
          recovery: undefined,
          message: "This file was not uploaded.",
        },
      ],
    });
    expect(html).toContain("Upload file 2 again");
    expect(html).toContain(`href="/sessions/${sessionId}/sources"`);
    expect(html).not.toContain("Retry file 2");
  });

  it("retains the automatic retry key without resetting extraction again after a lost retry acknowledgement", async () => {
    mocks.request
      .mockResolvedValueOnce({ next: `/sessions/${sessionId}/estimate` })
      .mockRejectedValueOnce(new TypeError("Lost retry acknowledgement"));
    render({ sourceIssues: [failedSource] });
    await click("Retry file 2");
    const retryKey = mocks.request.mock.calls[1]?.[3];
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue({});
    await click("Retry file 2");
    expect(
      mocks.request.mock.calls.filter((call) => call[0].endsWith("/notes/recovery")),
    ).toHaveLength(1);
    expect(mocks.request.mock.calls[2]).toEqual([
      `/api/classes/${sessionId}/learning`,
      "POST",
      { action: "retry" },
      retryKey,
    ]);
    expect(mocks.push).toHaveBeenCalledOnce();
  });

  it("treats timestamp issues as review rather than a missing upload", () => {
    const html = render({
      sourceIssues: [
        {
          ...failedSource,
          kind: "timing",
          action: "review",
          recovery: undefined,
          message: "The text is available; some timestamps need checking.",
        },
      ],
    });
    expect(html).toContain("The text is available; some timestamps need checking.");
    expect(html).toContain("Review session material");
    expect(html).not.toContain("Upload file 2 again");
    expect(html).not.toContain("Some session material is missing");
  });
});

describe("class note content direction", () => {
  const persianModel: KnowledgeModel = {
    ...model,
    title: "خلاصهٔ درس",
    language: { learning: "en", explanation: "fa-IR" },
    summary: [claim("summary", "already یعنی قبلاً")],
    topics: [
      { id: "topic", title: "کاربرد زمان‌ها", claims: [claim("topic-claim", "توضیح موضوع")] },
    ],
    learningItems: [
      {
        id: "item",
        kind: "vocabulary",
        front: "already",
        back: "already در این جمله به معنی قبلاً است.",
        claim: claim("item-claim", "توضیح واژه"),
      },
    ],
    homework: [claim("homework", "تمرین بعد از کلاس")],
    uncertainties: [claim("uncertain", "بخش نیازمند بررسی")],
  };
  const persianRevision: NotebookRevision = { ...revision, model: persianModel };

  it.each(["preview", "saved", "history"] as const)(
    "renders English-leading Persian notes RTL in the %s with English learning fronts LTR",
    (surface) => {
      const html = render({
        latest: { ...latest, model: surface === "preview" ? persianModel : model },
        initial: surface === "saved" ? { ...notebook, current: persianRevision } : null,
        readOnlyRevision: surface === "history" ? persianRevision : undefined,
      });
      for (const text of [
        "already یعنی قبلاً",
        "توضیح موضوع",
        "already در این جمله به معنی قبلاً است.",
        "تمرین بعد از کلاس",
        "بخش نیازمند بررسی",
      ]) {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(html).toMatch(
          new RegExp(`<p lang="fa-IR" dir="rtl"[^>]*><span[^>]*>${escaped}</span></p>`),
        );
      }
      expect(html).toMatch(/<h3 lang="en" dir="ltr"[^>]*>already<\/h3>/);
      expect(html).toMatch(/<h2 lang="fa-IR" dir="auto"[^>]*>خلاصهٔ درس<\/h2>/);
      expect(html).toMatch(/<h3 lang="fa-IR" dir="auto"[^>]*>کاربرد زمان‌ها<\/h3>/);
      expect(html).toContain("<h3>Class summary</h3>");
      expect(html).not.toMatch(/<article[^>]*dir="rtl"/);
    },
  );

  it("keeps English class content left to right", () => {
    const html = render();
    expect(html).toMatch(
      /<p lang="en" dir="ltr"[^>]*><span[^>]*>Preview summary text<\/span><\/p>/,
    );
    expect(html).not.toContain('dir="rtl"');
  });

  it("lets earlier edits follow their own text when their original language is unknown", () => {
    const html = render({
      initial: {
        ...notebook,
        current: {
          ...persianRevision,
          edits: {
            claims: { removed: "یادداشت قدیمی" },
            items: { removedItem: { front: "Earlier question", back: "پاسخ قدیمی" } },
          },
        },
      },
    });
    expect(html).toMatch(/<p dir="auto"[^>]*><span[^>]*>یادداشت قدیمی<\/span><\/p>/);
    expect(html).toMatch(/<h3 dir="auto"[^>]*>Earlier question<\/h3>/);
    expect(html).toMatch(/<p dir="auto"[^>]*><span[^>]*>پاسخ قدیمی<\/span><\/p>/);
  });
});
