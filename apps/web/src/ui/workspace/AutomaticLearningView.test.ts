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
    "quota_insufficient",
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
