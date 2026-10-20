import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { FocusShell } from "./FocusShell";

// UX-02, frame C2: recording is a focus mode with no navigation.
describe("FocusShell", () => {
  const focus = renderToStaticMarkup(createElement(FocusShell, null, "Timer and Stop"));

  it("holds only the page content in one main landmark", () => {
    expect(focus).toContain("Timer and Stop");
    expect(focus.match(/<main\b/g)).toHaveLength(1);
    expect(focus).toContain('id="content"');
  });

  it("has no sidebar, bottom navigation, New session or skip link", () => {
    expect(focus).not.toMatch(/<nav\b/);
    expect(focus).not.toMatch(/<aside\b/);
    expect(focus).not.toContain("New session");
    expect(focus).not.toContain("Skip to content");
    expect(focus).not.toContain("<a ");
  });

  it("is what AppShell is not: the same page inside AppShell does have them", () => {
    const shell = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          current: "classes",
          hrefs: { today: "/today", classes: "/sessions", review: "/review", me: "/me" },
          newClassHref: "/sessions/new",
        } as Parameters<typeof AppShell>[0],
        "Timer and Stop",
      ),
    );
    expect(shell).toMatch(/<nav\b/);
    expect(shell).toContain("New session");
  });
});
