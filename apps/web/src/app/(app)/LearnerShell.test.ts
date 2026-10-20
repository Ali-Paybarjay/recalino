import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Learner } from "../../server/auth/learner";
import { LearnerShell } from "./LearnerShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const learner = {
  userId: "10000000-0000-4000-8000-000000000002",
  state: { pending: { terms: false } },
} as unknown as Learner;

const render = (reviewDue?: number) =>
  renderToStaticMarkup(
    createElement(
      LearnerShell,
      { learner, current: "today", header: "Today", reviewDue } as Parameters<
        typeof LearnerShell
      >[0],
      "x",
    ),
  );

// UX-12: the badge on Review shows the cards that are due.
describe("the Review badge in the shell", () => {
  it("shows the due count in the sidebar and for screen readers in the bottom navigation", () => {
    const html = render(7);
    expect(html).toContain("7 due");
  });

  it("shows nothing when no card is due or the page did not read the queue", () => {
    expect(render(0)).not.toContain("due");
    expect(render()).not.toContain("due");
  });
});
