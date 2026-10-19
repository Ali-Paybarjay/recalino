import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

const props = {
  current: "classes",
  hrefs: { today: "/today", classes: "/sessions", review: "/review", me: "/me" },
  newClassHref: "/sessions/new",
} as const;
const render = (focus?: boolean) =>
  renderToStaticMarkup(
    createElement(
      AppShell,
      { ...props, focus } as Parameters<typeof AppShell>[0],
      "Timer and Stop",
    ),
  );

// UX-02 (owner decision 2026-10-19): the recording pages switch this on while capture runs.
describe("AppShell focus mode", () => {
  it("draws the sidebar, bottom navigation, New session and skip link by default", () => {
    for (const html of [render(), render(false)]) {
      expect(html.match(/<nav\b/g)).toHaveLength(2);
      expect(html).toMatch(/<aside\b/);
      expect(html).toContain("New session");
      expect(html).toContain("Skip to content");
      expect(html).toContain("Timer and Stop");
    }
  });

  it("draws the content column alone in focus mode", () => {
    const html = render(true);
    expect(html).toContain("Timer and Stop");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('id="content"');
    expect(html).not.toMatch(/<nav\b/);
    expect(html).not.toMatch(/<aside\b/);
    expect(html).not.toContain("New session");
    expect(html).not.toContain("Skip to content");
    expect(html).not.toContain("<a ");
  });

  it("keeps the same main landmark, so the content is not rebuilt when focus changes", () => {
    const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main(render(true))).toContain("Timer and Stop");
    expect(main(render(false))).toContain("Timer and Stop");
  });
});
