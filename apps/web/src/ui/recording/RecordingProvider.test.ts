import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useCaptureQuiet } from "./RecordingProvider";

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
