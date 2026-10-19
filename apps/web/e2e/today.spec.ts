import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

// D32 and FR-ORG-005 (frames B1-empty, B1-default): Today has one primary action, Record a session (D50 wording).
test("Today gives a new learner one first step, and keeps one primary action after a session exists", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/today");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Your first session starts here." }),
  ).toBeVisible();
  const primary = main.locator(".btn-primary:visible");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Record a session");
  await expect(
    main.getByText("Starts right away · saved on this device · name it later"),
  ).toBeVisible();
  // No review card or empty session list before anything exists (B1-empty): nothing to choose from.
  await expect(main.getByRole("heading", { name: "Ready for a little practice?" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Your recent sessions" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "From class to confidence" })).toBeVisible();
  await expectNoAxeViolations(page);

  await main.getByRole("link", { name: "New session without recording", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/new$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/, { timeout: 30_000 });

  await page.goto("/today");
  await expect(main.getByRole("heading", { name: "Your recent sessions" })).toBeVisible();
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Record a session");
  await expect(main.getByRole("link", { name: "New session", exact: true })).toBeVisible();
  // The session has no cards yet, so there is still no "0 due" review card.
  await expect(main.getByRole("heading", { name: "Ready for a little practice?" })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

// UX-12: Review shows how many cards are due, on Today where the queue is already read.
test("Today shows the number of due cards on the Review link", async ({ page }) => {
  test.setTimeout(90_000);
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true, automaticStudyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/today");
  await expect(page.getByRole("link", { name: /^Review\b.*\b\d+ due$/ }).first()).toBeVisible();
  await expectNoAxeViolations(page);
});
