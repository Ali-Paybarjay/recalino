import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureState } from "./controller";
import { RecordingView } from "./RecordingView";

type Sync = { phase: "idle" | "syncing" | "failed"; count: number; pending: number; error: string };
const mocks = vi.hoisted(() => ({
  phase: "idle" as CaptureState["phase"],
  error: null as string | null,
  sync: { phase: "idle", count: 0, pending: 0, error: "" } as Sync,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./RecordingProvider", () => ({
  RecordLauncher: () => null,
  useRecording: () => ({
    controller: {
      elapsed: () => 0,
      segmentElapsed: () => 0,
      state: { recording: null, phase: mocks.phase },
    },
    state: {
      recording: null,
      phase: mocks.phase,
      error: mocks.error,
      accountDeletionBlocked: false,
      missing: null,
    },
    store: {},
    userId: "10000000-0000-4000-8000-000000000002",
    sourceSync: { retry: vi.fn() },
    syncState: mocks.sync,
  }),
}));

const failedSync: Sync = {
  phase: "failed",
  count: 1,
  pending: 2,
  error: "The recorded parts could not be added to your session. Check your connection.",
};
const render = (props: { backHref?: string } = {}) =>
  renderToStaticMarkup(createElement(RecordingView, { sessionId: "session-1", ...props }));
beforeEach(() => {
  mocks.phase = "idle";
  mocks.error = null;
  mocks.sync = { phase: "idle", count: 0, pending: 0, error: "" };
});

// UX-11 and PRD-REC-02: until Stop, nothing but a real capture failure may speak.
describe("messages while recording", () => {
  it.each(["starting", "recording", "recovering", "paused"] as const)(
    "keeps an upload failure out of the page while %s",
    (phase) => {
      mocks.phase = phase;
      mocks.sync = failedSync;
      const html = render();
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(failedSync.error);
      expect(html).not.toContain("Retry adding session material");
      expect(html).not.toContain("Adding recorded parts to your session");
    },
  );

  it("still shows a real capture failure at once", () => {
    mocks.phase = "recording";
    mocks.error = "The microphone stopped. Tap Resume to try again.";
    mocks.sync = failedSync;
    const html = render();
    expect(html).toContain("The microphone stopped. Tap Resume to try again.");
    expect(html).not.toContain("Retry adding session material");
  });

  it("shows the upload failure and its Retry as soon as Stop was pressed", () => {
    mocks.sync = failedSync;
    for (const phase of ["saving", "saved", "idle"] as const) {
      mocks.phase = phase;
      const html = render();
      expect(html).toContain(failedSync.error);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Retry adding session material");
    }
  });
});

describe("the recording page without navigation (UX-02)", () => {
  it("puts Stop and save before the explanations while recording", () => {
    mocks.phase = "recording";
    const html = render({ backHref: "/sessions/session-1" });
    expect(html.indexOf("Stop and save")).toBeGreaterThan(-1);
    expect(html.indexOf("Stop and save")).toBeLessThan(html.indexOf("Recording continues"));
  });

  it("hides the way back during capture and shows it afterwards", () => {
    mocks.phase = "recording";
    expect(render({ backHref: "/sessions/session-1" })).not.toContain("Back to session");
    mocks.phase = "paused";
    expect(render({ backHref: "/sessions/session-1" })).not.toContain("Back to session");
    for (const phase of ["idle", "saved", "failed"] as const) {
      mocks.phase = phase;
      const html = render({ backHref: "/sessions/session-1" });
      expect(html).toContain('href="/sessions/session-1"');
      expect(html).toContain("Back to session");
    }
  });

  it("adds no back link when the page has navigation of its own", () => {
    expect(render()).not.toContain("Back to session");
  });
});
