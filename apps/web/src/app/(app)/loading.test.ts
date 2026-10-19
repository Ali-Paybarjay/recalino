import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Loading from "./loading";

const mocks = vi.hoisted(() => ({ path: "/today", quiet: false }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("../../ui/recording/RecordingProvider", () => ({ useCaptureQuiet: () => mocks.quiet }));
beforeEach(() => {
  mocks.path = "/today";
  mocks.quiet = false;
});

const render = () => renderToStaticMarkup(createElement(Loading));

// UX-08 and UX-02: the loading screen draws the navigation the page will draw.
describe("the loading screen of a signed-in page", () => {
  it("draws the navigation on a normal page", () => {
    expect(render()).toMatch(/<nav\b/);
  });

  // Full focus mode (D90 as amended): no navigation on the recording pages in any phase.
  it.each([
    ["/recordings", false],
    ["/recordings", true],
    ["/sessions/0f0a/record", false],
    ["/sessions/0f0a/record", true],
  ] as const)("draws no navigation on %s (capturing: %s)", (path, quiet) => {
    mocks.path = path;
    mocks.quiet = quiet;
    const html = render();
    expect(html).not.toMatch(/<nav\b/);
    expect(html).not.toMatch(/<aside\b/);
    expect(html).toContain('role="status"');
  });

  it("keeps the navigation on other pages even while capture is in progress", () => {
    mocks.quiet = true;
    expect(render()).toMatch(/<nav\b/);
  });
});
