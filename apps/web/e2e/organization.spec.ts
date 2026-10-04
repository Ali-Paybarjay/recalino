import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

test("courses, optional units and a class can be created, moved and deleted through real APIs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Your first class starts here." })).toBeVisible();
  await page.goto("/classes/organize");
  await page.getByLabel("New course name").fill("English B1");
  await page.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(page.getByLabel("Selected course")).toHaveValue(/.+/);
  await page.getByLabel("New unit name").fill("Travel");
  await page.getByRole("button", { name: "Create unit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Travel", exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "View course", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "English B1" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "New class", exact: true }).click();
  await expect(page.getByLabel("Course", { exact: true })).toContainText("English B1");
  await page.getByLabel("Class name (optional)").fill("کلاس سفر 日本語");
  await page.getByLabel("Class date").fill("2026-09-30");
  await page.getByLabel("Unit (optional)").selectOption({ label: "Travel" });
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "کلاس سفر 日本語" })).toBeVisible();
  const classUrl = page.url();
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "Class options", exact: true }).click();
  await page.getByLabel("Class name (optional)").fill("Renamed lesson");
  await page.getByLabel("Unit (optional)").selectOption("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Renamed lesson" })).toBeVisible();
  await page.goto("/classes/organize");
  await page.getByRole("button", { name: "Delete empty course", exact: true }).click();
  const courseDialog = page.getByRole("dialog", { name: "Delete this course?" });
  await courseDialog.getByRole("button", { name: "Delete course", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Move or delete" })).toHaveText(
    "Move or delete the classes in this group first.",
  );
  await courseDialog.getByRole("button", { name: "Keep it" }).click();
  await page.goto(`${classUrl}/options`);
  await page.getByRole("button", { name: "Delete class", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete this class?" })
    .getByRole("button", { name: "Delete class", exact: true })
    .click();
  await expect(page).toHaveURL(/\/classes$/);
  await expect(page.getByRole("heading", { name: "Renamed lesson" })).toHaveCount(0);
  await page.goto("/classes/organize");
  await page.getByRole("button", { name: "Delete empty course", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete this course?" })
    .getByRole("button", { name: "Delete course", exact: true })
    .click();
  await expect(page.getByLabel("Selected course")).toHaveCount(0);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`organization pages are accessible without horizontal overflow: ${name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await signInAsNewLearner(page, { setup: "complete" });
    for (const path of ["/today", "/classes", "/classes/new", "/classes/organize"]) {
      await page.goto(path);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
}
