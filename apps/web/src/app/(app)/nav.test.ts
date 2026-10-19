import { describe, expect, it } from "vitest";
import { NAV_HREFS, shellSectionFor } from "./nav";

// UX-08: while a page loads, the shell shows the navigation item the page itself marks.
describe("shell section of a signed-in path", () => {
  it.each([
    ["/today", "today"],
    ["/review", "review"],
    ["/me", "me"],
    ["/me/data", "me"],
    ["/me/review-settings", "me"],
    ["/help", "me"],
    ["/help/new", "me"],
    ["/sessions", "classes"],
    ["/sessions/new", "classes"],
    ["/sessions/organize", "classes"],
    ["/sessions/0f0a/notes", "classes"],
    ["/sessions/0f0a/notes/versions", "classes"],
    ["/courses", "classes"],
    ["/courses/0f0a/materials", "classes"],
    ["/cards/0f0a", "classes"],
    ["/notes/0f0a", "classes"],
  ] as const)("%s belongs to %s", (path, section) => {
    expect(shellSectionFor(path)).toBe(section);
  });

  it.each([
    "/recordings",
    "/sessions/0f0a/record",
    "/sessions/0f0a/processing",
    "/me/edit/level-goal",
    "/unknown",
    "/",
  ])("%s draws no shell", (path) => {
    expect(shellSectionFor(path)).toBeNull();
  });

  it("links every section to the page the shell links to", () => {
    expect(NAV_HREFS).toEqual({
      today: "/today",
      classes: "/sessions",
      review: "/review",
      me: "/me",
    });
  });
});
