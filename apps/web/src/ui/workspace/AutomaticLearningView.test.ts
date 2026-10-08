import { type ButtonHTMLAttributes, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticLearningNotice, AutomaticLearningView } from "./AutomaticLearningView";
import type { AutomaticLearningStatus } from "./automatic-learning";

const mocks = vi.hoisted(() => ({
  status: null as AutomaticLearningStatus | null,
  request: vi.fn(),
  refresh: vi.fn(),
  notify: vi.fn(),
  accept: vi.fn(),
  buttons: new Map<string, () => unknown>(),
}));
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
function render(view: "notice" | "progress" = "notice") {
  return renderToStaticMarkup(
    view === "notice"
      ? createElement(AutomaticLearningNotice, { sessionId })
      : createElement(AutomaticLearningView, { sessionId, initial: blocked }),
  );
}
function retry() {
  const click = mocks.buttons.get("Retry failed attempt");
  expect(click).toBeDefined();
  return click?.();
}
beforeEach(() => {
  mocks.status = blocked;
  mocks.request.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset();
  mocks.accept.mockReset();
  mocks.buttons.clear();
});

describe("retry from the class notice", () => {
  it("makes the word retry an action alongside View progress", () => {
    const html = render();
    expect(html).toMatch(/Check the material or <button[^>]*>retry<\/button> this attempt\./);
    expect(html).toContain(`href="/classes/${sessionId}/processing"`);
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

  it("hides the failure notice after processing succeeds", () => {
    mocks.status = { ...blocked, state: "ready", lastError: null };
    expect(render()).toBe("");
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
      expect(html).toContain(`href="/classes/${sessionId}/notes"`);
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
    expect(html).toContain(`href="/classes/${sessionId}/processing"`);
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
      new RegExp(`href="/classes/${sessionId}/sources"[^>]*>Review material<\\/a>`),
    );
    expect(html).not.toContain("Add material");
    expect(mocks.buttons.size).toBe(0);
  });
  it.each([
    ["awaiting_review", "Your request is recorded for this class"],
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
    expect(mocks.buttons.has("Request processing review")).toBe(false);
    expect(mocks.buttons.has("Retry after service update")).toBe(false);
  });
});
