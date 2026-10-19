import type { AccountState } from "@recalino/core/acc";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileSettings } from "./ProfileSettings";

const state: Pick<AccountState, "profile" | "timezone"> = {
  profile: {
    version: 1,
    firstLanguage: "fa",
    learningLanguage: "en",
    explanationLanguage: "first_language",
    level: "B1",
    goal: "esol",
  },
  timezone: "Europe/London",
};
const render = (legal?: { terms: string; privacy: string }) =>
  renderToStaticMarkup(createElement(ProfileSettings, { state, legal }));

// UX-07: after sign-in the Terms and the Privacy Notice can be read again from Settings.
describe("Settings row for the legal texts", () => {
  it("opens the reading sheet with the Terms and the Privacy Notice", () => {
    const html = render({ terms: "TERMS TEXT", privacy: "PRIVACY TEXT" });
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*Terms and Privacy Notice/);
    expect(html).toContain("Terms · Privacy Notice");
    // The sheet is a dialog that starts closed and shows the Terms first.
    expect(html).toMatch(/<dialog[^>]*aria-labelledby/);
    expect(html).toContain("TERMS TEXT");
    expect(html).toContain('aria-pressed="true"');
    // It only lets the learner read: accepting new versions stays with the banner.
    expect(html).not.toContain("Accept and continue");
    expect(html).not.toContain('type="checkbox"');
  });

  it("is left out when no texts are given", () => {
    expect(render()).not.toContain("Terms and Privacy Notice");
  });
});
