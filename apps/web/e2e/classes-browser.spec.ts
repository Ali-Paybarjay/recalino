import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

async function createCourse(page: Page, name: string) {
  const response = await page.request.post("/api/courses", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

async function createClass(page: Page, title: string, classDate: string, courseId?: string) {
  const response = await page.request.post("/api/classes", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { title, classDate, ...(courseId ? { courseId } : {}) },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; courseId: string };
}

function classRows(page: Page) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.locator("details") });
}

test("one course is selected automatically and a dated class opens its details before navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  const lesson = await createClass(page, "Travel conversations", "2026-09-30");
  for (let day = 25; day <= 28; day++) {
    await createClass(
      page,
      `English reading practice ${day - 24}`,
      `2026-09-${day}`,
      lesson.courseId,
    );
  }
  await page.goto("/classes");

  await expect(page.getByRole("heading", { name: "My classes", exact: true })).toBeVisible();
  const rows = classRows(page);
  await expect(rows).toHaveCount(5);
  const row = rows.first();
  const disclosure = row.locator("summary");
  await expect(disclosure).toContainText("Travel conversations");
  await expect(disclosure.locator("time")).toHaveAttribute("datetime", "2026-09-30");
  await expect(row.locator("details")).not.toHaveAttribute("open", "");
  await expect(row.getByRole("link", { name: "Go to session", exact: true })).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("classes-desktop-collapsed.png"),
    fullPage: true,
  });

  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(row.locator("details")).toHaveAttribute("open", "");
  await expect(row.getByRole("link", { name: "Go to session", exact: true })).toHaveAttribute(
    "href",
    `/classes/${lesson.id}`,
  );
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("classes-desktop-expanded.png"),
    fullPage: true,
  });
  await row.getByRole("link", { name: "Go to session", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${lesson.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Travel conversations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Session notes", exact: true })).toHaveAttribute(
    "href",
    `/classes/${lesson.id}/notes`,
  );
  await expect(page.getByRole("link", { name: "Flashcards", exact: true })).toHaveAttribute(
    "href",
    `/classes/${lesson.id}/cards`,
  );
  await expectNoAxeViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("class-overview-desktop.png"),
    fullPage: true,
  });
});

test("multiple courses require a choice, isolate their classes and offer an explicit all-classes view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  const esol = await createCourse(page, "ESOL at college");
  const spanish = await createCourse(page, "Spanish evening course");
  await createClass(page, "English speaking practice", "2026-10-02", esol.id);
  await createClass(page, "Spanish greetings", "2026-09-28", spanish.id);
  await page.goto("/classes");

  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toHaveValue("");
  await expect(course.locator("option:checked")).toHaveText("Choose a course");
  await expect(classRows(page)).toHaveCount(0);
  await course.selectOption(esol.id);
  await expect(page).toHaveURL(`/classes?courseId=${esol.id}`);
  await expect(classRows(page)).toHaveCount(1);
  await expect(classRows(page)).toContainText("English speaking practice");
  await expect(page.getByRole("main").getByText("Spanish greetings", { exact: true })).toHaveCount(
    0,
  );

  await course.selectOption(spanish.id);
  await expect(classRows(page)).toHaveCount(1);
  await expect(classRows(page)).toContainText("Spanish greetings");
  await expect(
    page.getByRole("main").getByText("English speaking practice", { exact: true }),
  ).toHaveCount(0);

  await course.selectOption("__all__");
  await expect(page).toHaveURL("/classes?scope=all");
  await expect(classRows(page)).toHaveCount(2);
  await expect(classRows(page).nth(0)).toContainText("English speaking practice");
  await expect(classRows(page).nth(1)).toContainText("Spanish greetings");
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(course).toHaveValue("__all__");
  await expect(classRows(page)).toHaveCount(2);
});

test("scroll loading can retry a failed page and append classes without losing date order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  const course = await createCourse(page, "ESOL reading");
  for (let day = 1; day <= 25; day++) {
    await createClass(
      page,
      `Reading lesson ${day}`,
      `2026-09-${String(day).padStart(2, "0")}`,
      course.id,
    );
  }
  await page.goto(`/classes?courseId=${course.id}`);
  const rows = classRows(page);
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText("Reading lesson 25");
  await expect(rows.last()).toContainText("Reading lesson 6");

  let failNextPage = true;
  await page.route("**/api/classes?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("offset") === "20" && failNextPage) {
      failNextPage = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "temporarily_unavailable", message: "Try again." } }),
      });
      return;
    }
    await route.continue();
  });
  const isNextPage = (response: { url(): string }) => {
    const url = new URL(response.url());
    return url.pathname === "/api/classes" && url.searchParams.get("offset") === "20";
  };
  const failedPage = page.waitForResponse(isNextPage);
  await page
    .getByRole("button", { name: "Load more sessions", exact: true })
    .scrollIntoViewIfNeeded();
  expect((await failedPage).status()).toBe(503);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "More sessions could not be loaded. Try again.",
  );
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText("Reading lesson 25");
  const nextPage = page.waitForResponse(isNextPage);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  expect((await nextPage).status()).toBe(200);
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("Reading lesson 25");
  await expect(rows.last()).toContainText("Reading lesson 1");
  const dates = await rows
    .locator("summary time")
    .evaluateAll((times) => times.map((time) => time.getAttribute("datetime")));
  expect(dates).toEqual(
    Array.from({ length: 25 }, (_, index) => `2026-09-${String(25 - index).padStart(2, "0")}`),
  );
  await expect(page.getByRole("button", { name: "Load more sessions", exact: true })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`class disclosures fit a mobile screen and stay accessible: ${scheme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.emulateMedia({ colorScheme: scheme });
    await signInAsNewLearner(page, { setup: "complete" });
    const lesson = await createClass(
      page,
      "تمرین مکالمه دربارهٔ سفر — 日本語の長いクラス名 — English conversation",
      "2026-09-30",
    );
    for (const path of ["/classes", `/courses/${lesson.courseId}`, "/today"]) {
      await page.goto(path);
      const row = classRows(page).first();
      await expect(row).toBeVisible();
      if (path === "/classes") {
        await page.screenshot({
          path: testInfo.outputPath(`classes-mobile-${scheme}-collapsed.png`),
          fullPage: true,
        });
      }
      await row.locator("summary").click();
      await expect(row.getByRole("link", { name: "Go to session", exact: true })).toBeVisible();
      if (path === "/classes") {
        await page.screenshot({
          path: testInfo.outputPath(`classes-mobile-${scheme}-expanded.png`),
          fullPage: true,
        });
      }
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
}
