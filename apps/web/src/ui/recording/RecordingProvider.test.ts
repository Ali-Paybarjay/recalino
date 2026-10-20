import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  indicatorDismissKey,
  recordingHref,
  useCaptureQuiet,
  useWaitingRecordings,
} from "./RecordingProvider";
import type { Recording } from "./store";

vi.mock("next/navigation", () => ({ usePathname: () => "/today", useRouter: () => ({}) }));

function Probe() {
  return createElement("span", null, String(useCaptureQuiet()));
}

// UX-02: the recording pages read this to hide the navigation; outside the provider nothing is captured.
describe("useCaptureQuiet", () => {
  it("is false outside the recording provider, where nothing is being captured", () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>false</span>");
  });
});

// D107: the notes, flashcards and material pages read it; outside the provider nothing waits.
describe("useWaitingRecordings", () => {
  it("finds nothing recorded or waiting on this device outside the recording provider", () => {
    function Waiting() {
      const device = useWaitingRecordings("session", "1");
      return createElement(
        "span",
        null,
        `${device.capturing} ${device.waiting} ${device.background}`,
      );
    }
    expect(renderToStaticMarkup(createElement(Waiting))).toBe("<span>false 0 false</span>");
  });
});

// D104: from Today or "/" after a reload, "Open recording" leads back to the paused capture.
describe("recordingHref", () => {
  it("opens the session's recording page, or this device's recordings without a session", () => {
    const sessionId = "8d0f3c51-1d4e-4a8b-9f5e-1f2a3b4c5d6e";
    expect(recordingHref({ sessionId } as Recording)).toBe(`/sessions/${sessionId}/record`);
    expect(recordingHref({ sessionId: null } as Recording)).toBe("/recordings");
    expect(recordingHref(null)).toBe("/recordings");
  });
});

// Owner request 2026-10-20: the bar that reports a finished recording can be closed; during
// capture it holds Pause, Resume and Stop and stays.
describe("indicatorDismissKey", () => {
  const recording = { id: "30000000-0000-4000-8000-000000000001" } as Recording;
  it("lets the learner close the bar after Stop or a failure, for that outcome only", () => {
    expect(indicatorDismissKey({ phase: "saved", recording })).toBe(`${recording.id}:saved`);
    expect(indicatorDismissKey({ phase: "failed", recording })).toBe(`${recording.id}:failed`);
    expect(indicatorDismissKey({ phase: "saved", recording: null })).toBe("none:saved");
  });

  it("never offers closing while a recording runs or saves", () => {
    for (const phase of ["starting", "recording", "recovering", "paused", "saving"] as const)
      expect(indicatorDismissKey({ phase, recording })).toBeNull();
  });
});
