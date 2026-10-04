import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

// Signed-in pages, Settings, sign-out and new text versions (FR-ACC-002, 004, 006, 007, D33,
// FR-PLT-001).

test("Settings shows the profile and edits one answer at a time", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete", firstLanguage: "ru" });
  await page.goto("/me");
  const firstLanguage = page.getByRole("link", { name: /First language/ });
  await expect(firstLanguage).toContainText("Russian");
  await firstLanguage.click();
  await expect(
    page.getByText("Changes apply to future explanations. Your existing notes stay the same."),
  ).toBeVisible();
  await page.getByRole("combobox").fill("ukrain");
  await page.getByRole("option", { name: /Ukrainian/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: /First language/ })).toContainText("Ukrainian");
});

test("Cancel preserves the saved level and goal while Save changes updates them", async ({
  page,
}) => {
  await signInAsNewLearner(page, { setup: "complete" });
  const response = await page.request.patch("/api/profile", {
    data: { field: "level_goal", level: "B1", goal: "esol" },
  });
  expect(response.status()).toBe(200);
  await page.goto("/me/edit/level-goal");
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
  await page.getByText("C1", { exact: true }).click();
  await page.getByText("IELTS", { exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  const saved = page.getByRole("link", { name: /Level.*Goal/i });
  await expect(saved).toContainText("B1");
  await expect(saved).toContainText("ESOL");
  await saved.click();
  await page.getByText("C1", { exact: true }).click();
  await page.getByText("IELTS", { exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: /Level.*Goal/i })).toContainText("C1");
  await expect(page.getByRole("link", { name: /Level.*Goal/i })).toContainText("IELTS");
});

test("sign out ends the session, and the old cookies no longer work", async ({ page, browser }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/me");
  const before = await page.context().cookies();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.goto("/today");
  await expect(page).toHaveURL(/\/\?next=%2Ftoday$/);

  // FR-PLT-001: a token from before the sign-out is refused.
  const replay = await browser.newContext();
  await replay.addCookies(before);
  const replayed = await replay.newPage();
  await replayed.goto("/today");
  await expect(replayed).toHaveURL(/\/\?next=%2Ftoday$/);
  await replay.close();
});

test("new Terms: a calm notice until the learner reads and accepts them", async ({ page }) => {
  await signInAsNewLearner(page, {
    setup: "complete",
    acceptedVersions: { terms: "0.0", privacy: "0.0" },
  });
  await page.goto("/today");
  const notice = page.getByText(/The Terms changed on .*Please read and accept them/);
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your English, one class at a time." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read and accept" }).click();
  const sheet = page.getByRole("dialog", { name: "Terms and Privacy Notice", exact: true });
  const accept = sheet.getByRole("button", { name: "Accept and continue" });
  await expect(accept).toHaveAttribute("aria-disabled", "true");
  await sheet.getByText("I accept the Terms and Privacy Notice", { exact: true }).click();
  await accept.click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(notice).toBeHidden();
});

test("a new recording consent version is asked once before Today", async ({ page }) => {
  await signInAsNewLearner(page, {
    setup: "complete",
    acceptedVersions: { "recording-consent": "0.0" },
  });
  await page.goto("/today");
  await expect(page).toHaveURL(/\/setup\/consent$/);
  const checkbox = page.getByRole("checkbox", {
    name: "I understand that I must ask the people in my class before I record.",
    exact: true,
  });
  await expect(checkbox).toBeEnabled();
  await page
    .getByText("I understand that I must ask the people in my class before I record.", {
      exact: true,
    })
    .click();
  await expect(checkbox).toBeChecked();
  const accept = page.getByRole("button", { name: "Accept and continue", exact: true });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
});

for (const path of ["/today", "/classes", "/review", "/me", "/me/edit/level-goal"]) {
  for (const scheme of ["light", "dark"] as const) {
    for (const [name, viewport] of [
      ["mobile", VIEWPORTS.mobile],
      ["desktop", VIEWPORTS.desktop],
    ] as const) {
      test(`${path} has no WCAG 2.2 AA violations: ${scheme}, ${name}`, async ({ page }) => {
        await signInAsNewLearner(page, { setup: "complete" });
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await expectNoAxeViolations(page);
      });
    }
  }
}
