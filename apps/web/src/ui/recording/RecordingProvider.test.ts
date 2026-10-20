import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { recordingHref, useCaptureQuiet, useWaitingRecordings } from "./RecordingProvider";
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
