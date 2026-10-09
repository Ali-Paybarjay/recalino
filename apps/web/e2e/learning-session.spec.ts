import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

const MATERIAL_TITLE = "Synthetic notes for local testing";
const PUBLISHED_TITLE = "Travel: asking about trains";
const TOPIC = "Travel questions";
const TOPICS = [TOPIC, "Present simple", "Station vocabulary", "Polite requests"];

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

async function materialFixture(page: Page) {
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { sessionId } = (await response.json()) as { sessionId: string };
  const course = await createCourse(page, "ESOL کالج — 日本語");
  const updated = await page.request.patch(`/api/classes/${sessionId}`, {
    data: { courseId: course.id, classDate: "2026-09-28", title: null },
  });
  expect(updated.status(), await updated.text()).toBe(200);
  return { sessionId, courseId: course.id };
}

async function publishNotes(page: Page, sessionId: string, title = PUBLISHED_TITLE) {
  const response = await page.request.post(`/api/classes/${sessionId}/notes`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { expectedRevisionId: null, edits: { title } },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function getClass(page: Page, sessionId: string) {
  const response = await page.request.get(`/api/classes/${sessionId}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test("material titles and topics appear automatically, while a learner can keep or clear their own title", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await materialFixture(page);
  expect(await getClass(page, fixture.sessionId)).toMatchObject({
    title: null,
    displayTitle: MATERIAL_TITLE,
    titleSource: "material",
    topics: TOPICS,
    courseId: fixture.courseId,
    classDate: "2026-09-28",
  });
  const notes = await page.request.get(`/api/classes/${fixture.sessionId}/notes`);
  expect(notes.status()).toBe(200);
  expect((await notes.json()).notebook).toBeNull();
  await page.goto(`/sessions/${fixture.sessionId}`);
  await expect(page.getByRole("heading", { level: 1, name: MATERIAL_TITLE })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topics covered", exact: true })).toBeVisible();
  await expect(page.getByText(TOPIC, { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Topics covered", exact: true })).toContainText(
    "Title from material",
  );
  await page.locator("summary").filter({ hasText: "More session tools" }).click();
  await page.getByRole("link", { name: "Session options", exact: true }).click();
  await expect(page).toHaveURL(`/sessions/${fixture.sessionId}/options`, { timeout: 30_000 });
  await expect(page.getByLabel("Session name (optional)")).toHaveValue("");
  await page.getByLabel("Session name (optional)").fill("My train conversation lesson");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "My train conversation lesson" }),
  ).toBeVisible();
  expect(await getClass(page, fixture.sessionId)).toMatchObject({
    title: "My train conversation lesson",
    titleSource: "manual",
    topics: TOPICS,
  });

  await publishNotes(page, fixture.sessionId);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "My train conversation lesson" }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "More session tools" }).click();
  await page.getByRole("link", { name: "Session options", exact: true }).click();
  await expect(page).toHaveURL(`/sessions/${fixture.sessionId}/options`, { timeout: 30_000 });
  await page.getByRole("button", { name: "Use automatic title", exact: true }).click();
  await expect(page.getByLabel("Session name (optional)")).toHaveValue("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PUBLISHED_TITLE })).toBeVisible();
  expect(await getClass(page, fixture.sessionId)).toMatchObject({
    title: null,
    displayTitle: PUBLISHED_TITLE,
    titleSource: "material",
    topics: TOPICS,
    courseId: fixture.courseId,
    classDate: "2026-09-28",
  });
  await expect(page.getByRole("region", { name: "Topics covered", exact: true })).toContainText(
    "Title from material",
  );
  await expectNoAxeViolations(page);
});

test("each course lists generated topics and dated sessions in the appropriate reading order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await materialFixture(page);
  await publishNotes(page, fixture.sessionId);
  const early = await createClass(page, fixture.courseId, "2026-09-27");
  const late = await createClass(page, fixture.courseId, "2026-10-01", "Speaking practice");
  const other = await createCourse(page, "Spanish evening course");
  const otherClass = await createClass(page, other.id, "2026-09-29", "Spanish greetings");
  expect(await getClass(page, early.id)).toMatchObject({
    title: null,
    titleSource: "date",
    topics: [],
    classDate: "2026-09-27",
  });

  await page.goto(`/courses/${fixture.courseId}`);
  const rows = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.locator("details") });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("summary")).toContainText("Speaking practice");
  await expect(rows.nth(1).locator("summary")).toContainText(PUBLISHED_TITLE);
  await expect(
    rows.nth(1).getByRole("link", { name: "See all 4 topics", exact: true }),
  ).toBeHidden();
  await rows.nth(1).locator("summary").click();
  await expect(rows.nth(1)).toContainText(`Topics: ${TOPIC}`);
  await expect(rows.nth(1)).toContainText("Present simple");
  await expect(rows.nth(1)).toContainText("Station vocabulary");
  await expect(rows.nth(1)).not.toContainText("Polite requests");
  await expect(
    rows.nth(1).getByRole("link", { name: "See all 4 topics", exact: true }),
  ).toHaveAttribute("href", `/sessions/${fixture.sessionId}#topics`);
  await expect(rows.nth(2)).toContainText("2026-09-27");
  await expect(page.getByRole("heading", { name: "Spanish greetings", exact: true })).toHaveCount(
    0,
  );
  await rows.nth(1).getByRole("link", { name: "See all 4 topics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Topics covered", exact: true })).toBeVisible();
  for (const topic of TOPICS) await expect(page.getByText(topic, { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "More session tools" }).click();
  await page.getByRole("link", { name: "Course materials", exact: true }).click();
  await expect(page).toHaveURL(`/courses/${fixture.courseId}/materials`);
  expect(
    await page
      .locator("section[id^='class-']")
      .evaluateAll((sections) => sections.map((section) => section.id)),
  ).toEqual([`class-${early.id}`, `class-${fixture.sessionId}`, `class-${late.id}`]);
  await expect(page.locator(`#title-${fixture.sessionId}`)).toHaveText(PUBLISHED_TITLE);
  await expect(page.locator(`#class-${fixture.sessionId}`)).toContainText(TOPIC);
  await expect(page.locator(`#class-${otherClass.id}`)).toHaveCount(0);
  await page.goto(`/courses/${other.id}/materials`);
  await expect(page.locator(`#class-${otherClass.id}`)).toBeVisible();
  await expect(page.locator(`#class-${fixture.sessionId}`)).toHaveCount(0);
  await expect(page.getByText(TOPIC, { exact: true })).toHaveCount(0);
});

for (const name of ["mobile", "desktop"] as const) {
  test(`automatic session titles and topic overviews fit and are accessible: ${name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORTS[name]);
    const fixture = await materialFixture(page);
    await publishNotes(page, fixture.sessionId);
    for (const path of [
      `/sessions/${fixture.sessionId}`,
      `/courses/${fixture.courseId}`,
      `/courses/${fixture.courseId}/materials`,
    ]) {
      await page.goto(path);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (path === `/sessions/${fixture.sessionId}`) {
        await page.screenshot({
          path: testInfo.outputPath(`learning-session-${name}-class.png`),
          fullPage: true,
        });
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`learning-session-${name}.png`),
      fullPage: true,
    });
  });
}
