import { type ButtonHTMLAttributes, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticLearningNotice, AutomaticLearningView } from "./AutomaticLearningView";
import { type AccountGate, AccountGateProvider } from "./account-gate";
import type { AutomaticLearningStatus } from "./automatic-learning";
import type { UploadBatch } from "./upload-store";

const mocks = vi.hoisted(() => ({
  status: null as AutomaticLearningStatus | null,
  batches: [] as UploadBatch[],
  request: vi.fn(),
  refresh: vi.fn(),
  notify: vi.fn(),
  accept: vi.fn(),
  buttons: new Map<string, () => unknown>(),
}));
vi.mock("./UploadProvider", () => ({ useUploadBatches: () => mocks.batches }));
vi.mock("./AutomaticLearningProvider", () => ({
  useAutomaticLearning: () => ({
    status: mocks.status,
    problem: null,
    refresh: mocks.refresh,
    acceptStatus: mocks.accept,
  }),
}));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  workspaceRequest: mocks.request,
}));
vi.mock("./automatic-learning", () => ({ notifyAutomaticLearning: mocks.notify }));
vi.mock("./primitives", async (original) => {
  const primitives = await original<typeof import("./primitives")>();
  return {
    ...primitives,
    Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) => {
      const label = props["aria-label"] ?? String(props.children);
      mocks.buttons.set(label, () => props.onClick?.({} as MouseEvent<HTMLButtonElement>));
      return createElement(primitives.Button, props);
    },
  };
});

const sessionId = "10000000-0000-4000-8000-000000000001";
const blocked: AutomaticLearningStatus = {
  state: "blocked",
  revision: 2,
  batchId: null,
  run: null,
  snapshot: null,
  lastError: "provider_output_truncated",
  message:
    "Automatic creation could not finish. Your material and earlier notes and cards are saved. Check the material or retry this attempt.",
  notesReady: true,
  cardsReady: false,
};
const pendingReview = {
  state: "not_requested" as const,
  runId: "20000000-0000-4000-8000-000000000001",
  requestedRunId: null,
  requestedAt: null,
  updatedAt: "2026-10-08T10:00:00.000Z",
  errorCode: "processing_budget_session",
  canRequest: true,
};
function render(view: "notice" | "progress" = "notice", gate?: AccountGate) {
  const page =
    view === "notice"
      ? createElement(AutomaticLearningNotice, { sessionId })
      : createElement(AutomaticLearningView, { sessionId, initial: blocked });
  return renderToStaticMarkup(
    gate ? createElement(AccountGateProvider, { value: gate }, page) : page,
  );
}
function retry() {
  const click = mocks.buttons.get("Retry failed attempt");
  expect(click).toBeDefined();
  return click?.();
}
beforeEach(() => {
  mocks.status = blocked;
  mocks.batches = [];
  mocks.request.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset();
  mocks.accept.mockReset();
  mocks.buttons.clear();
});

describe("retry from the class notice", () => {
  it("keeps pre-send checking visible before the server has acknowledged a new upload", () => {
    mocks.status = { ...blocked, state: "idle", lastError: null };
    mocks.batches = [
      {
        id: "preparing-batch",
        userId: "user",
        sessionId,
        createdAt: 1,
        phase: "uploading",
        entries: [
          {
            id: "audio-file",
            displayName: "lecture.m4a",
            phase: "checking",
            sentBytes: 0,
            sizeBytes: 100,
          },
        ],
        receipt: { revision: null },
      } as UploadBatch,
    ];
    const html = render();
    expect(html).toContain("Preparing your files for upload");
    expect(html).toContain("Checking files before upload");
    expect(html).toContain('aria-label="Material upload progress"');
    expect(html).not.toContain('value="0"');
    expect(html).not.toContain("0%");
  });

  it("shows a prominent retry action alongside View progress", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*>Retry failed attempt<\/button>/);
    expect(html).toContain("Your session needs attention");
    expect(html).toContain('aria-label="Session progress"');
    expect(html).toContain(`href="/sessions/${sessionId}/sources#session-progress"`);
  });

  it.each(["notice", "progress"] as const)(
    "%s retries saved material without opening another page, and ignores a concurrent click",
    async (view) => {
      let release: (() => void) | undefined;
      mocks.request.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      render(view);
      const pending = retry();
      await retry();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
        `/api/classes/${sessionId}/learning`,
        "POST",
        { action: "retry" },
        expect.any(String),
      );
      expect(mocks.refresh).not.toHaveBeenCalled();
      release?.();
      await pending;
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(sessionId);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("reuses the retry key after a failed response and renews it after acknowledgement", async () => {
    mocks.request
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValue(undefined);
    render();
    await retry();
    await retry();
    await retry();
    const keys = mocks.request.mock.calls.map((call) => call[3]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("applies an acknowledged retry before attempting a progress read that can fail", async () => {
    const processing: AutomaticLearningStatus = {
      ...blocked,
      state: "processing",
      lastError: null,
      message: "Creating notes and flashcards…",
    };
    mocks.request.mockResolvedValue(processing);
    mocks.refresh.mockRejectedValue(new Error("Connection interrupted"));
    render();
    await retry();
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(processing);
    expect(mocks.accept.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    "provider_outcome_unresolved",
    "provider_outcome_unknown",
    "provider_timestamps_invalid",
    "upload_needs_attention",
    "acceptance_required",
  ])("does not offer a retry that bypasses %s", (lastError) => {
    mocks.status = { ...blocked, lastError };
    render();
    expect(mocks.buttons.has("Retry failed attempt")).toBe(false);
  });

  // UX-09: /setup sends a learner with finished setup back to Today, so new Terms use their sheet.
  it.each(["notice", "progress"] as const)(
    "%s sends a stop for new Terms to the Terms sheet, not to setup",
    (view) => {
      mocks.status = { ...blocked, lastError: "acceptance_required" };
      const html = render(view, {
        setupComplete: true,
        termsPending: true,
        termsChangedOn: "1 Oct",
      });
      expect(html).toContain("Read and accept");
      // The approved Settings sentence (frame G3), with the date the server gives.
      expect(html).toContain(
        "The Terms changed on 1 Oct. Please read and accept them to keep processing new sessions.",
      );
      expect(html).not.toContain("Read and accept the updated Terms to continue.");
      expect(html).not.toContain("Review account setup");
      expect(html).not.toContain('href="/setup"');
      const dispatchEvent = vi.fn(() => true);
      vi.stubGlobal("window", { dispatchEvent });
      try {
        mocks.buttons.get("Read and accept")?.();
      } finally {
        vi.unstubAllGlobals();
      }
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      const [event] = dispatchEvent.mock.calls[0] as unknown as [Event];
      expect(event.type).toBe("recalino:open-terms-notice");
    },
  );

  it("shows no made-up sentence for new Terms when the date is not known", () => {
    mocks.status = { ...blocked, lastError: "acceptance_required" };
    const html = render("progress");
    expect(html).toContain("Read and accept");
    expect(html).not.toContain("Terms changed on");
    expect(html).not.toContain("Read and accept the updated Terms");
    expect(html).not.toContain("Review account setup");
  });

  it("replaces the failure notice with a ready state and next actions", () => {
    mocks.status = { ...blocked, state: "ready", lastError: null, cardsReady: true };
    const html = render();
    expect(html).toContain("Notes and flashcards are ready");
    expect(html).toContain("Session notes");
    expect(html).not.toContain("Retry failed attempt");
  });
});

describe("recovery actions match the processing blocker", () => {
  it.each(["notice", "progress"] as const)(
    "%s directs a learner allowance shortfall to allowance review and an increase request",
    async (view) => {
      mocks.status = {
        ...blocked,
        lastError: "quota_insufficient",
        message: "This class needs more allowance than is currently available.",
      };
      const html = render(view);
      expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
      expect(html).toMatch(/href="\/help\/new"[^>]*>Ask for more allowance<\/a>/);
      expect(html).not.toContain("Add material");
      // Amounts the status does not name may already be covered, so the retry stays.
      expect(mocks.buttons.has("Retry after allowance changes")).toBe(true);
      expect(mocks.request).not.toHaveBeenCalled();
      mocks.request.mockResolvedValue({ ...blocked, state: "processing", lastError: null });
      await mocks.buttons.get("Retry after allowance changes")?.();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
        `/api/classes/${sessionId}/learning`,
        "POST",
        { action: "retry" },
        expect.any(String),
      );
    },
  );

  const amounts = (document: number, regeneration = 0) => ({
    audio: 0,
    document,
    regeneration,
    tts: 0,
    storage: 0,
  });

  it.each(["notice", "progress"] as const)(
    "FR-QUOTA-007: %s offers more allowance or less material for a named shortage",
    (view) => {
      mocks.status = {
        ...blocked,
        lastError: "quota_insufficient",
        message: "Pages and images: 2 needed, 1 left.",
        allowance: { active: true, required: amounts(2), available: amounts(1) },
      };
      const html = render(view);
      expect(html).toMatch(/href="\/help\/new"[^>]*>Ask for more allowance<\/a>/);
      expect(html).toMatch(
        new RegExp(`href="/sessions/${sessionId}/sources"[^>]*>Review material</a>`),
      );
      expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
      // A known shortage would only stop again; the retry appears once the allowance covers it.
      expect(mocks.buttons.has("Retry after allowance changes")).toBe(false);
      if (view === "progress")
        expect(html).toContain(
          "After your allowance is updated, retry using this session&#x27;s saved material.",
        );
    },
  );

  it.each(["notice", "progress"] as const)(
    "FR-QUOTA-007: %s does not ask for less material when only a new version is short",
    (view) => {
      mocks.status = {
        ...blocked,
        lastError: "quota_insufficient",
        message: "New versions: 1 needed, 0 left.",
        allowance: { active: true, required: amounts(1, 1), available: amounts(5, 0) },
      };
      const html = render(view);
      expect(html).toMatch(/href="\/help\/new"[^>]*>Ask for more allowance<\/a>/);
      expect(html).not.toContain("Review material");
      expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
    },
  );

  it.each(["notice", "progress"] as const)(
    "FR-QUOTA-003: %s sends a learner without an allowance to the pilot operator",
    (view) => {
      mocks.status = {
        ...blocked,
        lastError: "quota_insufficient",
        message: "Your material is saved. You have no active processing allowance.",
        allowance: { active: false, required: amounts(1), available: amounts(0) },
      };
      const html = render(view);
      expect(html).toMatch(/href="\/help\/new"[^>]*>Ask the pilot operator<\/a>/);
      expect(html).not.toContain("Ask for more allowance");
      expect(html).not.toContain("Review material");
      expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
      expect(mocks.buttons.has("Retry after allowance changes")).toBe(false);
    },
  );

  it.each(["notice", "progress"] as const)(
    "FR-QUOTA-007 rule 5: %s retries a class its allowance now covers, without asking for more",
    async (view) => {
      mocks.status = {
        ...blocked,
        lastError: "quota_insufficient",
        message:
          "Your material is saved. Your allowance now covers this class. Retry to create the notes and flashcards. You do not need to upload the same files again.",
        allowance: { active: true, required: amounts(1), available: amounts(1) },
      };
      const html = render(view);
      expect(html).not.toContain("/help/new");
      expect(html).not.toContain("Review allowance");
      expect(html).not.toContain("Retry after allowance changes");
      expect(html).not.toContain("After your allowance is updated");
      expect(html).not.toContain("After it is updated");
      expect(html).toContain(
        "Your allowance now covers this session. Choose Retry processing to continue with your saved material.",
      );
      expect(html).toMatch(/<button[^>]*>Retry processing<\/button>/);
      mocks.request.mockResolvedValue({ ...blocked, state: "processing", lastError: null });
      await mocks.buttons.get("Retry processing")?.();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
        `/api/classes/${sessionId}/learning`,
        "POST",
        { action: "retry" },
        expect.any(String),
      );
    },
  );

  it.each([
    "processing_budget_session",
    "processing_budget_user_month",
    "processing_budget_system_day",
    "processing_budget_system_month",
    "service_processing_blocked",
    "service_processing_paused",
    "service_cost_policy_missing",
    "service_cost_unknown",
    "service_reservation_missing",
  ])(
    "offers a linked processing review for %s without suggesting learner quota or new uploads",
    (lastError) => {
      mocks.status = {
        ...blocked,
        lastError,
        message: "Processing needs a service update.",
        processingReview: pendingReview,
      };
      const html = render("progress");
      expect(html).toContain('id="processing-review"');
      expect(html).toContain("Request processing review");
      expect(html).not.toContain("/help/new");
      expect(html).not.toContain("Review allowance");
      expect(html).not.toContain("Add material");
      expect(mocks.buttons.has("Retry after service update")).toBe(false);
      expect(mocks.request).not.toHaveBeenCalled();
      expect(html).toContain(`href="/sessions/${sessionId}/notes"`);
    },
  );

  it("requests one exact class review from the class notice, without retrying paid processing", async () => {
    mocks.status = {
      ...blocked,
      lastError: "processing_budget_session",
      message: "The class processing budget needs attention from the Recalino team.",
      processingReview: pendingReview,
    };
    const html = render();
    expect(html).toContain("View processing review");
    expect(html).toContain(`href="/sessions/${sessionId}/sources#session-progress"`);
    expect(html).not.toContain("Review allowance");
    mocks.request.mockResolvedValue({
      ...mocks.status,
      processingReview: { ...pendingReview, state: "awaiting_review", canRequest: false },
    });
    const click = mocks.buttons.get("Request processing review");
    expect(click).toBeDefined();
    await click?.();
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      `/api/classes/${sessionId}/learning`,
      "POST",
      { action: "request_review", runId: pendingReview.runId },
      expect.any(String),
    );
  });

  it.each([
    "provider_outcome_unresolved",
    "provider_outcome_unknown",
    "provider_timestamps_invalid",
  ])("%s offers help without permitting another paid attempt", (lastError) => {
    mocks.status = { ...blocked, lastError };
    const html = render("progress");
    expect(html).toContain("Processing review");
    expect(html).not.toContain("Add material");
    expect(mocks.buttons.has("Retry failed attempt")).toBe(false);
  });

  it("takes an upload error to its material review rather than a processing retry", () => {
    mocks.status = { ...blocked, lastError: "upload_needs_attention" };
    const html = render("progress");
    expect(html).toMatch(
      new RegExp(`href="/sessions/${sessionId}/sources"[^>]*>Review material<\\/a>`),
    );
    expect(html).not.toContain("Add material");
    expect(mocks.buttons.size).toBe(0);
  });
  it.each([
    ["awaiting_review", "Your request is recorded for this session"],
    ["retrying", "Processing is continuing with your saved material"],
    ["resolved", "Processing has finished"],
  ] as const)("shows the actual %s review state and avoids repeated requests", (state, message) => {
    mocks.status = {
      ...blocked,
      lastError: "processing_budget_session",
      processingReview: {
        ...pendingReview,
        state,
        requestedAt: "2026-10-08T10:01:00.000Z",
        canRequest: false,
      },
    };
    const html = render("progress");
    expect(html).toContain(message);
    if (state === "awaiting_review") {
      expect(html).toContain("Follow its status below");
      expect(html).not.toContain("Request a review below");
    }
    expect(mocks.buttons.has("Request processing review")).toBe(false);
    expect(mocks.buttons.has("Retry after service update")).toBe(false);
  });
  it("opens published partial notes and explains their limitations without requesting another attempt", () => {
    mocks.status = {
      ...blocked,
      state: "ready",
      lastError: null,
      notesReady: true,
      cardsReady: true,
      processingReview: {
        ...pendingReview,
        state: "resolved",
        partialResult: true,
        requestedAt: "2026-10-08T10:01:00.000Z",
        canRequest: false,
      },
    };
    const html = render("progress");
    expect(html).toContain("notes and flashcards are available with some source limitations");
    expect(html).toContain(`href="/sessions/${sessionId}/notes"`);
    expect(html).toContain("Open session notes");
    expect(mocks.buttons.has("Request processing review")).toBe(false);
    expect(mocks.buttons.has("Retry failed attempt")).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
