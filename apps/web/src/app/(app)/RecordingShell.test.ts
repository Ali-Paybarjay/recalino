import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingShell, RecordingShellFrame } from "./RecordingShell";

const mocks = vi.hoisted(() => ({ quiet: false }));
vi.mock("../../ui/recording/RecordingProvider", () => ({ useCaptureQuiet: () => mocks.quiet }));
vi.mock("next/navigation", () => ({ usePathname: () => "/recordings" }));

const header = createElement("h1", null, "Record a session");
const notice = createElement("p", null, "Our Terms changed");
const content = "Timer and Stop";
const frame = (capturing: boolean, mode?: "while-capturing" | "always"): string =>
  renderToStaticMarkup(
    createElement(
      RecordingShellFrame,
      { capturing, header, notice, ...(mode ? { mode } : {}) } as unknown as Parameters<
        typeof RecordingShellFrame
      >[0],
      content,
    ),
  );
beforeEach(() => {
  mocks.quiet = false;
});

// UX-02, owner decision 2026-10-19 (D90 as amended): the recording pages are in full focus mode,
// with no navigation in any phase; "while-capturing" is the alternative one constant away.
describe("the recording pages' shell", () => {
  it("has no navigation, New session, skip link or notice before Start, while capturing or after Stop", () => {
    for (const capturing of [false, true]) {
      const html = frame(capturing);
      expect(html).not.toMatch(/<nav\b/);
      expect(html).not.toMatch(/<aside\b/);
      expect(html).not.toContain("New session");
      expect(html).not.toContain("Skip to content");
      expect(html).not.toContain("Our Terms changed");
      expect(html).toContain("Record a session");
      expect(html).toContain(content);
      expect(html.match(/<main\b/g)).toHaveLength(1);
    }
  });

  it('with "while-capturing", has the learner navigation, New session and the Terms notice outside capture', () => {
    const html = frame(false, "while-capturing");
    expect(html.match(/<nav\b/g)).toHaveLength(2);
    expect(html).toMatch(/<aside\b/);
    expect(html).toContain("New session");
    expect(html).toContain("Record a session");
    expect(html).toContain("Our Terms changed");
    expect(html).toContain(content);
    expect(html).toContain('aria-current="page"');
  });

  it('with "while-capturing", has no navigation, New session, skip link or notice while capturing', () => {
    const html = frame(true, "while-capturing");
    expect(html).not.toMatch(/<nav\b/);
    expect(html).not.toMatch(/<aside\b/);
    expect(html).not.toContain("New session");
    expect(html).not.toContain("Skip to content");
    expect(html).not.toContain("Our Terms changed");
    expect(html).toContain("Record a session");
    expect(html).toContain(content);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  it("reads the capture phase from the recording provider", () => {
    const render = (mode?: "while-capturing") =>
      renderToStaticMarkup(
        createElement(
          RecordingShell,
          { header, notice, ...(mode ? { mode } : {}) } as unknown as Parameters<
            typeof RecordingShell
          >[0],
          content,
        ),
      );
    for (const quiet of [false, true]) {
      mocks.quiet = quiet;
      expect(render()).not.toMatch(/<nav\b/);
    }
    mocks.quiet = false;
    expect(render("while-capturing")).toMatch(/<nav\b/);
    mocks.quiet = true;
    expect(render("while-capturing")).not.toMatch(/<nav\b/);
  });
});
