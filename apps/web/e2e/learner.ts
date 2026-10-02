import { expect, type Page } from "@playwright/test";

type SessionOptions = {
  setup?: "none" | "complete";
  firstLanguage?: string;
  acceptedVersions?: Partial<Record<"terms" | "privacy" | "recording-consent", string>>;
};

/**
 * Signs a fresh learner in through the local-only test route (Google is not reachable in tests).
 * The session cookies land in the page's browser context.
 */
export async function signInAsNewLearner(page: Page, options: SessionOptions = {}) {
  const response = await page.request.post("/dev/auth/session", { data: options });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { userId: string };
}
