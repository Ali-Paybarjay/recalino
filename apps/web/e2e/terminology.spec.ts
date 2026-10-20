import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

// Vocabulary A (owner decision 2026-10-19, UX-06): "session" for a class meeting, "course" for a
// course, and every way to /courses is called "Manage courses".
test("the tab, the page and the links use the same words as where they go", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsNewLearner(page, { setup: "complete" });

  // The second tab opens the list of sessions and the page says so.
  await page.goto("/today");
  const nav = page.getByRole("navigation", { name: "Your learning space" });
  await nav.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Sessions", exact: true }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Courses", exact: true })).toHaveCount(0);

  // Course tools: the link to /courses is "Manage courses".
  await page.locator("summary").filter({ hasText: "Course tools" }).click();
  await expect(page.getByRole("link", { name: "Manage courses", exact: true })).toHaveAttribute(
    "href",
    "/courses",
  );
  await expect(page.getByRole("link", { name: "View courses", exact: true })).toHaveCount(0);

  // Settings: the row that opens /courses is "Manage courses" too.
  await page.goto("/me");
  await expect(page.getByRole("link", { name: /^Manage courses/ })).toHaveAttribute(
    "href",
    "/courses",
  );

  // The courses page names its way back by where it goes: the list of sessions.
  await page.goto("/courses");
  await expect(
    page.getByRole("heading", { level: 1, name: "Manage courses", exact: true }),
  ).toBeVisible();
  const back = page.getByRole("link", { name: "← Back to sessions", exact: true });
  await expect(back).toHaveAttribute("href", "/sessions");
  await expectNoAxeViolations(page);
});

test("a session's options page is titled like the link that opens it", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/sessions/new");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.locator("summary").filter({ hasText: "More session tools" }).click();
  await page.getByRole("link", { name: "Session options", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/options$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Session options", exact: true }),
  ).toBeVisible();
  // The organise page keeps its own title, so no two pages share a header.
  await page.goto("/sessions/organize");
  await expect(
    page.getByRole("heading", { level: 1, name: "Keep your sessions organised", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to sessions", exact: true })).toHaveAttribute(
    "href",
    "/sessions",
  );
});
