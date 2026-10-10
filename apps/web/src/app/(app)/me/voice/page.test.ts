import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceSettingsPage from "./page";

const mocks = vi.hoisted(() => ({ requireLearner: vi.fn() }));
vi.mock("../../../../server/auth/learner", () => ({ requireLearner: mocks.requireLearner }));
vi.mock("../../LearnerShell", () => ({
  LearnerShell: ({ children, current }: { children: ReactNode; current: string }) =>
    createElement("main", { "data-current": current }, children),
}));
vi.mock("../../../../ui/voice/VoiceProfile", () => ({
  VoiceProfile: ({ returnHref }: { returnHref: string }) =>
    createElement("a", { href: returnHref }, "Return from voice settings"),
}));

const notes = "/sessions/10000000-0000-4000-8000-000000000001/notes";

beforeEach(() => {
  mocks.requireLearner.mockReset();
  mocks.requireLearner.mockResolvedValue({ userId: "synthetic-learner", state: {} });
});

describe("voice settings opened from a class (FR-VOC-001)", () => {
  it("passes the originating notes to the form and keeps it through sign-in", async () => {
    const html = renderToStaticMarkup(
      await VoiceSettingsPage({ searchParams: Promise.resolve({ returnTo: notes }) }),
    );
    expect(html).toContain(`href="${notes}"`);
    expect(html).toContain('data-current="classes"');
    expect(mocks.requireLearner).toHaveBeenCalledWith(
      `/me/voice?returnTo=${encodeURIComponent(notes)}`,
    );
  });

  it("keeps account settings as the destination for a direct visit", async () => {
    const html = renderToStaticMarkup(
      await VoiceSettingsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('href="/me"');
    expect(html).toContain('data-current="me"');
    expect(mocks.requireLearner).toHaveBeenCalledWith("/me/voice");
  });

  it("does not retain an untrusted return URL in authentication or navigation", async () => {
    const html = renderToStaticMarkup(
      await VoiceSettingsPage({
        searchParams: Promise.resolve({ returnTo: "https://elsewhere.example" }),
      }),
    );
    expect(html).toContain('href="/me"');
    expect(mocks.requireLearner).toHaveBeenCalledWith("/me/voice");
  });
});
