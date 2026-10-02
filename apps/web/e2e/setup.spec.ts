import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

// A2 — profile setup (FR-ACC-003, FR-ACC-005, FR-ACC-006, D33), through the real API.

test("a new learner goes through the seven steps to Today", async ({ page }) => {
  await signInAsNewLearner(page);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/setup$/);

  // 1 — first language, chosen with the keyboard; Persian is Experimental until tested (D31).
  await expect(page.getByText("1 of 7")).toBeVisible();
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  await search.fill("فار");
  await search.press("Enter");
  await expect(page.getByRole("option", { name: /Persian/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Explanations in Persian may have mistakes")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Continue" }).click();

  // 3 — explanation language: no default, the reason is shown until one is chosen.
  await expect(page.getByText("3 of 7")).toBeVisible();
  const next = page.getByRole("button", { name: "Continue" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toHaveAccessibleDescription("Please choose one.");
  await page.getByRole("radio", { name: /فارسی/ }).check({ force: true });
  await expectNoAxeViolations(page);
  await next.click();

  // 4–5 — level and goal are optional.
  await expect(page.getByText("4 of 7")).toBeVisible();
  await page.getByRole("radio", { name: "B1" }).check({ force: true });
  await page.getByRole("radio", { name: "IELTS" }).check({ force: true });
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Continue" }).click();

  // 6 — the time zone from the browser.
  await expect(page.getByText("6 of 7")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Yes, that's right" }).click();

  // 7 — recording consent: never pre-ticked; finish only after ticking.
  await expect(page.getByText("7 of 7")).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish setup" });
  const consent = page.getByRole("checkbox", {
    name: "I understand that I must ask the people in my class before I record.",
  });
  await expect(consent).not.toBeChecked();
  await expect(finish).toHaveAttribute("aria-disabled", "true");
  await expectNoAxeViolations(page);
  await consent.check({ force: true });
  await finish.click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("Record your first class.")).toBeVisible();
});

test("a learner who leaves comes back to the same step, and Back keeps the answer", async ({
  page,
}) => {
  await signInAsNewLearner(page);
  await page.goto("/setup");
  await page.getByRole("combobox").fill("japan");
  await page.getByRole("option", { name: /Japanese/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("3 of 7")).toBeVisible();

  await page.reload();
  await expect(page.getByText("3 of 7")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("1 of 7")).toBeVisible();
  await expect(page.getByRole("option", { name: /Japanese/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the clear button empties the search and gives the field its focus back", async ({ page }) => {
  await signInAsNewLearner(page);
  await page.goto("/setup");
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  const clear = page.getByRole("button", { name: "Clear search" });
  await expect(clear).toBeHidden();
  await search.fill("zzz");
  await expect(page.getByText("Check the spelling.")).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.getByRole("option", { name: /Persian/ })).toBeVisible();
});

test("a finished setup is not shown again", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/today$/);
});
