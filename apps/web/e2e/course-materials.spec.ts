import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

async function createCourse(page: Page, name: string) {
  const response = await page.request.post("/api/courses", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { name },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

async function createClass(page: Page, courseId: string, classDate: string, title?: string) {
  const response = await page.request.post("/api/classes", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { courseId, classDate, ...(title ? { title } : {}) },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

async function courseFixture(page: Page) {
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { sessionId } = (await response.json()) as { sessionId: string };
  const course = await createCourse(page, "ESOL کالج — 日本語");
  const moved = await page.request.patch(`/api/classes/${sessionId}`, {
    data: { courseId: course.id, classDate: "2026-09-28", title: "Travel conversations" },
  });
  expect(moved.status(), await moved.text()).toBe(200);
  const initial = await page.request.post(`/api/classes/${sessionId}/notes`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { expectedRevisionId: null },
  });
  expect(initial.status(), await initial.text()).toBe(201);
  const notebook = (await initial.json()) as { current: { id: string } };
  const edited = await page.request.post(`/api/classes/${sessionId}/notes`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      expectedRevisionId: notebook.current.id,
      edits: {
        title: "Published travel notes",
        items: { word: { back: "My own answer دربارهٔ قطار" } },
      },
    },
  });
  expect(edited.status(), await edited.text()).toBe(201);
  const next = await createClass(page, course.id, "2026-09-30");
  return { courseId: course.id, sessionId, nextId: next.id };
}

test("course materials keep published edits, dated lessons and class links when classes move", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await courseFixture(page);
  const otherCourse = await createCourse(page, "Spanish evening course");
  const otherClass = await createClass(page, otherCourse.id, "2026-09-29", "Spanish lesson");
  await page.goto(`/courses/${fixture.courseId}`);
  await page.getByRole("link", { name: "Course materials", exact: true }).click();
  await expect(page).toHaveURL(`/courses/${fixture.courseId}/materials`);
  const first = page.locator(`#class-${fixture.sessionId}`);
  const next = page.locator(`#class-${fixture.nextId}`);
  await expect(
    first.getByRole("heading", { name: "Travel conversations", exact: true }),
  ).toBeVisible();
  await expect(
    first.getByRole("heading", { name: "Published travel notes", exact: true }),
  ).toBeVisible();
  await expect(first.getByText("My own answer دربارهٔ قطار", { exact: true })).toBeVisible();
  await expect(first.getByText("A rail trip", { exact: true })).toHaveCount(0);
  await expect(first.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
  await expect(
    next.getByText("No published notes for this class yet.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(`#class-${otherClass.id}`)).toHaveCount(0);
  expect(
    await page
      .locator("section[id^='class-']")
      .evaluateAll((sections) => sections.map((section) => section.id)),
  ).toEqual([`class-${fixture.sessionId}`, `class-${fixture.nextId}`]);
  for (const [label, suffix] of [
    ["Open class", ""],
    ["Class notes", "/notes"],
    ["Flashcards", "/cards"],
    ["Class sources", "/sources"],
  ]) {
    await expect(first.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "href",
      `/classes/${fixture.sessionId}${suffix}`,
    );
  }
  await first.getByRole("link", { name: "Class notes", exact: true }).click();
  await expect(page.getByText("My own answer دربارهٔ قطار", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Read course materials", exact: true }).click();
  await expect(page).toHaveURL(`/courses/${fixture.courseId}/materials`);

  const moved = await page.request.patch(`/api/classes/${fixture.sessionId}`, {
    data: { courseId: otherCourse.id, unitId: null },
  });
  expect(moved.status(), await moved.text()).toBe(200);
  await page.reload();
  await expect(first).toHaveCount(0);
  await expect(next).toBeVisible();
  await page.goto(`/courses/${otherCourse.id}/materials`);
  await expect(first.getByText("My own answer دربارهٔ قطار", { exact: true })).toBeVisible();
  await expect(page.locator(`#class-${otherClass.id}`)).toBeVisible();
  await expect(page.locator(`#class-${fixture.nextId}`)).toHaveCount(0);
});

test("long course timelines retain chronological order across pages", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await courseFixture(page);
  const later: string[] = [];
  for (let day = 1; day <= 9; day++) {
    const session = await createClass(
      page,
      fixture.courseId,
      `2026-10-${String(day).padStart(2, "0")}`,
    );
    later.push(session.id);
  }
  await page.goto(`/courses/${fixture.courseId}/materials`);
  const sections = page.locator("section[id^='class-']");
  await expect(sections).toHaveCount(10);
  await expect(sections.first()).toHaveAttribute("id", `class-${fixture.sessionId}`);
  await expect(sections.last()).toHaveAttribute("id", `class-${later[7]}`);
  const pages = page.getByRole("navigation", { name: "Course material pages" });
  await expect(pages).toContainText("Page 1 · 11 classes · Oldest first");
  await pages.getByRole("link", { name: "Next classes", exact: true }).click();
  await expect(page).toHaveURL(`/courses/${fixture.courseId}/materials?page=2`);
  await expect(sections).toHaveCount(1);
  await expect(sections.first()).toHaveAttribute("id", `class-${later[8]}`);
  await pages.getByRole("link", { name: "Previous classes", exact: true }).click();
  await expect(sections).toHaveCount(10);
  await expect(sections.first()).toHaveAttribute("id", `class-${fixture.sessionId}`);
});

for (const name of ["mobile", "desktop"] as const) {
  test(`course materials fit and are accessible: ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORTS[name]);
    const fixture = await courseFixture(page);
    await page.goto(`/courses/${fixture.courseId}/materials`);
    await expect(page.getByRole("heading", { level: 1, name: "Course materials" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`course-materials-${name}.png`),
      fullPage: true,
    });
  });
}
