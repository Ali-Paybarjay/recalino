import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

test("a learning goal stays separate while new courses preserve and organize dated classes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  const goal = await page.request.patch("/api/profile", {
    data: { field: "level_goal", level: "B1", goal: "esol" },
  });
  expect(goal.status()).toBe(200);
  const before = await page.request.get("/api/courses");
  expect(before.status()).toBe(200);
  expect(await before.json()).toEqual([]);

  await page.goto("/sessions/new");
  // D51: a new session takes its title from its material; naming happens in Session options.
  await expect(page.getByLabel("Session name (optional)")).toHaveCount(0);
  await page.getByLabel("Session date", { exact: true }).fill("28/09/2026");
  const course = page.getByLabel("Course", { exact: true });
  await expect(course.locator("option").last()).toHaveText("Create New Course");
  await expect(page.getByRole("button", { name: "Create course", exact: true })).toHaveCount(0);
  await course.focus();
  await course.selectOption({ label: "Create New Course" });
  const dialog = page.getByRole("dialog", { name: "Create a course" });
  await dialog.getByLabel("New course name").fill("ESOL at college");
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/sessions\/new$/);
  await expect(course).toBeFocused();
  await expect(course.locator("option:checked")).toHaveText("ESOL at college");
  await expect(course.locator("option").last()).toHaveText("Create New Course");
  const esolId = await course.inputValue();
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("28/09/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("28 Sept 2026");
  const esolClassUrl = page.url();

  const createdUnit = await page.request.post(`/api/courses/${esolId}/units`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name: "Travel" },
  });
  expect(createdUnit.status(), await createdUnit.text()).toBe(201);
  const { id: unitId } = (await createdUnit.json()) as { id: string };

  await page.goto("/sessions/new");
  await page.getByLabel("Session date", { exact: true }).fill("29/09/2026");
  await course.selectOption(esolId);
  const unit = page.getByLabel("Unit (optional)");
  await unit.selectOption(unitId);
  await course.focus();
  await course.selectOption({ label: "Create New Course" });
  await dialog.getByLabel("New course name").fill("Unsubmitted course");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/sessions\/new$/);
  await expect(course).toBeFocused();
  await expect(course).toHaveValue(esolId);
  await expect(unit).toHaveValue(unitId);
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("29/09/2026");

  await course.selectOption({ label: "Create New Course" });
  await dialog.getByLabel("New course name").fill("ESOL at college");
  await dialog.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "That name already exists. Choose a different name.",
  );
  await expect(course).toHaveValue(esolId);
  await expect(unit).toHaveValue(unitId);
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("29/09/2026");
  await dialog.getByLabel("New course name").fill("Spanish evening course");
  await dialog.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/sessions\/new$/);
  await expect(course).toBeFocused();
  await expect(course.locator("option:checked")).toHaveText("Spanish evening course");
  await expect(course.locator("option").last()).toHaveText("Create New Course");
  await expect(unit).toHaveCount(0);
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("29/09/2026");
  const spanishId = await course.inputValue();
  expect(spanishId).not.toBe(esolId);
  const created = await page.request.get("/api/courses");
  expect(created.status()).toBe(200);
  expect(await created.json()).toHaveLength(2);
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("29 Sept 2026");
  const spanishClassUrl = page.url();

  await page.goto("/sessions/new");
  await course.selectOption(esolId);
  await page.getByLabel("Session date", { exact: true }).fill("01/10/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  const secondEsolClassUrl = page.url();
  const esolClasses = await page.request.get(`/api/classes?courseId=${esolId}`);
  expect(esolClasses.status()).toBe(200);
  expect((await esolClasses.json()).total).toBe(2);
  const spanishClasses = await page.request.get(`/api/classes?courseId=${spanishId}`);
  expect(spanishClasses.status()).toBe(200);
  expect((await spanishClasses.json()).total).toBe(1);

  await page.goto("/courses");
  await expect(
    page.getByRole("heading", { level: 1, name: "Manage courses", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Your courses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ESOL at college", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Spanish evening course", exact: true }),
  ).toBeVisible();
  const esolRow = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "ESOL at college", exact: true }),
  });
  await expect(
    esolRow.getByRole("link", { name: "Course materials", exact: true }),
  ).toHaveAttribute("href", `/courses/${esolId}/materials`);
  await expectNoAxeViolations(page);
  await esolRow.getByRole("link", { name: "View sessions", exact: true }).click();
  const classes = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.locator("details") });
  await expect(classes).toHaveCount(2);
  for (const row of await classes.all()) await row.locator("summary").click();
  await expect(classes.getByRole("link", { name: "Go to session", exact: true })).toHaveCount(2);
  await expect(classes.locator(`a[href="${new URL(esolClassUrl).pathname}"]`)).toBeVisible();
  await expect(classes.locator(`a[href="${new URL(secondEsolClassUrl).pathname}"]`)).toBeVisible();
  await expect(page.locator(`a[href="${new URL(spanishClassUrl).pathname}"]`)).toHaveCount(0);
});

test("courses, optional units and a class can be created, moved and deleted through real APIs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/today");
  await expect(
    page.getByRole("heading", { name: "Your first session starts here." }),
  ).toBeVisible();
  await page.goto("/sessions/organize");
  await page.getByLabel("New course name").fill("English B1");
  await page.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(page.getByLabel("Selected course")).toHaveValue(/.+/);
  // D52: unit help sits behind an info button instead of filling the panel.
  await expect(page.getByLabel("New unit name")).toHaveAttribute(
    "placeholder",
    "For example: Unit 3 – Travel",
  );
  const unitHelp = page.getByText("New units go to the end of the list.", { exact: false });
  await expect(unitHelp).toBeHidden();
  await page.getByRole("button", { name: "About units" }).click();
  await expect(unitHelp).toBeVisible();
  await page.getByRole("heading", { name: "Optional units", exact: true }).click();
  await expect(unitHelp).toBeHidden();
  await page.getByLabel("New unit name").fill("Travel");
  const createdUnit = page.waitForResponse(
    (response) =>
      /\/api\/courses\/[0-9a-f-]+\/units$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create unit", exact: true }).click();
  expect((await createdUnit).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Travel", exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "View course", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "English B1" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "+ New session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/new\?courseId=[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByLabel("Course", { exact: true })).toContainText("English B1");
  await page.getByLabel("Session date", { exact: true }).fill("30/09/2026");
  await page.getByLabel("Unit (optional)").selectOption({ label: "Travel" });
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("30 Sept 2026");
  const classUrl = page.url();
  await expectNoAxeViolations(page);
  await page.locator("summary").filter({ hasText: "More session tools" }).click();
  await page.getByRole("link", { name: "Session options", exact: true }).click();
  await expect(page).toHaveURL(`${classUrl}/options`, { timeout: 30_000 });
  await page.getByLabel("Session name (optional)").fill("کلاس سفر 日本語");
  await page.getByLabel("Unit (optional)").selectOption("");
  const renamedClass = page.waitForResponse(
    (response) =>
      response.url() === classUrl.replace("/sessions/", "/api/classes/") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await renamedClass).status()).toBe(200);
  await expect(page).toHaveURL(classUrl, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "کلاس سفر 日本語" })).toBeVisible();
  await page.goto("/sessions/organize");
  await page.getByRole("button", { name: "Delete empty course", exact: true }).click();
  const courseDialog = page.getByRole("dialog", { name: "Delete this course?" });
  await courseDialog.getByRole("button", { name: "Delete course", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Move or delete" })).toHaveText(
    "Move or delete the sessions in this group first.",
  );
  await courseDialog.getByRole("button", { name: "Keep it" }).click();
  await page.goto(`${classUrl}/options`);
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  const classApiUrl = classUrl.replace("/sessions/", "/api/classes/");
  const deletedClass = page.waitForResponse(
    (response) => response.url() === classApiUrl && response.request().method() === "DELETE",
  );
  await page
    .getByRole("dialog", { name: "Delete this session?" })
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  expect((await deletedClass).status()).toBe(202);
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole("heading", { name: "کلاس سفر 日本語" })).toHaveCount(0);
  await page.goto("/sessions/organize");
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
    for (const path of ["/today", "/sessions", "/courses", "/sessions/new", "/sessions/organize"]) {
      await page.goto(path);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
}
