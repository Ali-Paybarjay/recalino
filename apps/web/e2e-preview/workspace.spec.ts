import type { Page } from "@playwright/test";
import {
  expect,
  expectNoAxeViolations,
  SAMPLE_BANNER,
  STORAGE_KEY,
  test,
  VIEWPORTS,
} from "./helpers";

function classRows(page: Page) {
  return page.locator("section[aria-label='Session list'] > ul > li");
}

async function openClassTools(page: Page) {
  await page.locator("summary").filter({ hasText: "Session tools and sources" }).click();
}

async function openListedClass(page: Page, title: string) {
  const row = classRows(page).filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Go to session", exact: true }).click();
}

test("a global review source opens the card's own class after another class is selected", async ({
  page,
}) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Blank review workspace");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blank review workspace");
  await expect(page.getByText("Session recording", { exact: true })).toHaveCount(0);

  await page.goto("/preview/review");
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await page
    .getByRole("article")
    .getByRole("link", { name: /^Audio 18:42\b/ })
    .click();
  await expect(page).toHaveURL(/\/preview\/source$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("From your class");
  await expect(page.getByRole("heading", { name: "Present perfect", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).classes[0]?.title : null;
      }, STORAGE_KEY),
    )
    .toBe("Present perfect");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("From your class");
  await page.goto("/preview/class");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await openClassTools(page);
  await expect(page.getByText("Session recording", { exact: true })).toBeVisible();
  await expect(page.getByText("Present perfect handout.pdf", { exact: true })).toBeVisible();
});

test("a new class begins empty and opening an existing class restores its own material", async ({
  page,
}) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Weekend English");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Weekend English");
  await expect(page.getByText("Session recording", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Present perfect handout.pdf", { exact: true })).toHaveCount(0);
  await page.goto("/preview/notes");
  await expect(page.getByText("AI explanation · sample", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Audio 18:42/ })).toHaveCount(0);
  await page.goto("/preview/classes");
  await page.getByLabel("Course", { exact: true }).selectOption("ESOL B1");
  await openListedClass(page, "Present perfect");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await openClassTools(page);
  await expect(page.getByText("Session recording", { exact: true })).toBeVisible();
  await page.goto("/preview/notes");
  await expect(page.getByText("AI explanation · sample", { exact: true })).toBeVisible();
});

test("saving class organisation without changes preserves its course and unit", async ({
  page,
}) => {
  await page.goto("/preview/organize");
  await expect(page.getByLabel("Move to course")).toHaveValue("ESOL B1");
  await expect(page.getByLabel("Move to unit")).toHaveValue("Everyday English");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(/ESOL B1 · Everyday English/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/ESOL B1 · Everyday English/)).toBeVisible();
});

test("a class can be created, found after refresh, and reset without a backend", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Bus journeys");
  await page.getByRole("combobox", { name: "Course", exact: true }).selectOption("My classes");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/class$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bus journeys");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bus journeys");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).not.toBeNull();

  await page.goto("/preview/classes");
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue("");
  await expect(classRows(page)).toHaveCount(0);
  await page.getByLabel("Course", { exact: true }).selectOption("My classes");
  await expect(classRows(page)).toHaveCount(1);
  await expect(classRows(page).locator("summary")).toContainText("Bus journeys");
  await openListedClass(page, "Bus journeys");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bus journeys");

  const reset = page.getByRole("button", { name: "Reset sample", exact: true });
  await reset.click();
  await expect(page.getByRole("dialog", { name: "Reset sample workspace?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bus journeys");

  await reset.click();
  await page.getByRole("button", { name: "Reset sample workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/today$/);
  await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
  await page.goto("/preview/classes");
  await expect(page.getByRole("heading", { name: "Bus journeys", exact: true })).toHaveCount(0);
  await page.getByLabel("Course", { exact: true }).selectOption("ESOL B1");
  await expect(classRows(page).first().locator("summary")).toContainText("Present perfect");
});

test("courses and units can be created and a class moved, while nonempty deletion stays blocked", async ({
  page,
}) => {
  await page.goto("/preview/organize");
  await page.getByLabel("New course name").fill("Trip English");
  await page.getByRole("button", { name: "Create course", exact: true }).click();
  await page.getByLabel("New unit name").fill("Travel");
  await page.getByRole("button", { name: "Create unit in Trip English", exact: true }).click();
  await page.getByLabel("Move to course").selectOption("Trip English");
  await page.getByLabel("Move to unit").selectOption("Travel");
  await page.getByLabel("Session name", { exact: true }).fill("A trip to London");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A trip to London");
  await expect(page.getByText(/Trip English · Travel/)).toBeVisible();

  await page.goto("/preview/organize");
  await page.getByLabel("Move to course").selectOption("Trip English");
  await page.getByLabel("Move to unit").selectOption("Travel");
  await expect(
    page.getByRole("button", { name: "Delete empty course", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete empty unit", exact: true })).toBeDisabled();

  const remove = page.getByRole("button", { name: "Delete sample session", exact: true });
  await remove.click();
  await expect(page.getByRole("dialog", { name: "Delete this sample session?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(remove).toBeFocused();
  await remove.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete sample session", exact: true })
    .click();
  await expect(page).toHaveURL(/\/preview\/classes$/);
  await expect(page.getByRole("heading", { name: "A trip to London", exact: true })).toHaveCount(0);

  await page.goto("/preview/organize");
  await page.getByLabel("Move to course").selectOption("Trip English");
  await page.getByLabel("Move to unit").selectOption("Travel");
  await expect(page.getByRole("button", { name: "Delete empty unit", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Delete empty unit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete sample unit", exact: true })
    .click();
  await page.goto("/preview/organize");
  await page.getByLabel("Move to course").selectOption("Trip English");
  await expect(
    page.getByLabel("Move to unit").locator("option", { hasText: "Travel" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Delete empty course", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete sample course", exact: true })
    .click();
  await page.goto("/preview/organize");
  await expect(
    page.getByLabel("Move to course").locator("option", { hasText: "Trip English" }),
  ).toHaveCount(0);
});

test("a damaged sample store recovers to a usable workspace", async ({ page }) => {
  await page.goto("/preview/today");
  await page.evaluate((key) => localStorage.setItem(key, "{invalid JSON"), STORAGE_KEY);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your English, one class at a time.",
  );
  await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
  await page.getByLabel("Explore screens", { exact: true }).selectOption("new-class");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New session");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("After storage recovery");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("After storage recovery");
});

test("unavailable browser storage explains the limit while local interactions still work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked for this test", "SecurityError");
      },
    });
  });
  await page.goto("/preview/new-class");
  await expect(
    page.getByText("Sample storage is unavailable. Changes last for this visit only.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Without browser storage");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Without browser storage");
});

test("D39: a class without a title uses its selected date", async ({ page }) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Session date", { exact: true }).fill("03/10/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2026-10-03");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2026-10-03");
  await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
});

test("D39: creating a course inside New class preserves the session and selects the new course", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("جلسهٔ عصر 日本語");
  await page.getByLabel("Session date", { exact: true }).fill("01/10/2026");
  const course = page.getByLabel("Course", { exact: true });
  const unit = page.getByLabel("Unit (optional)", { exact: true });
  await course.selectOption("ESOL B1");
  await unit.selectOption("Everyday English");
  await expect(course.locator("option").last()).toHaveText("Create New Course");
  await expect(page.getByRole("button", { name: "Create course", exact: true })).toHaveCount(0);
  await course.focus();
  await course.selectOption({ label: "Create New Course" });
  const dialog = page.getByRole("dialog", { name: "Create a course", exact: true });
  await expect(dialog.getByText(/Your goal guides explanations/)).toBeVisible();
  await dialog.getByLabel("New course name", { exact: true }).fill("Unsubmitted course");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/preview\/new-class$/);
  await expect(course).toBeFocused();
  await expect(course).toHaveValue("ESOL B1");
  await expect(unit).toHaveValue("Everyday English");
  await expect(page.getByLabel("Session name (optional)", { exact: true })).toHaveValue(
    "جلسهٔ عصر 日本語",
  );
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("01/10/2026");

  await course.selectOption({ label: "Create New Course" });
  await dialog.getByLabel("New course name", { exact: true }).fill("ESOL B1");
  await dialog.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That course already exists.");
  await expect(course).toHaveValue("ESOL B1");
  await expect(unit).toHaveValue("Everyday English");
  await expect(page.getByLabel("Session name (optional)", { exact: true })).toHaveValue(
    "جلسهٔ عصر 日本語",
  );
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("01/10/2026");

  await dialog.getByLabel("New course name", { exact: true }).fill("ESOL evening");
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "Create course", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/preview\/new-class$/);
  await expect(course).toBeFocused();
  await expect(course).toHaveValue("ESOL evening");
  await expect(course.locator("option").last()).toHaveText("Create New Course");
  await expect(page.getByLabel("Session name (optional)", { exact: true })).toHaveValue(
    "جلسهٔ عصر 日本語",
  );
  await expect(page.getByLabel("Session date", { exact: true })).toHaveValue("01/10/2026");
  await expect(unit).toHaveValue("");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("جلسهٔ عصر 日本語");
  await page.goto("/preview/course?course=ESOL%20evening");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ESOL evening");
  await page.locator("footer summary").filter({ hasText: "Course tools" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Course materials" })).toBeVisible();
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("D39: course materials keep each session's current notes, dates and course membership", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const notes = "Travel notes from this session. <script>window.courseInjected = true</script>";
  await page.goto("/preview/new-class?course=ESOL%20B1");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Travel notebook");
  await page.getByLabel("Session date", { exact: true }).fill("29/09/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await page.goto("/preview/edit-notes");
  await page.getByLabel("Your explanation", { exact: true }).fill(notes);
  await page.getByRole("button", { name: "Save a new version", exact: true }).click();
  await expect(page.getByText(notes, { exact: true })).toBeVisible();

  await page.goto("/preview/new-class?course=My%20classes");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("Other course session");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await page.goto("/preview/edit-notes");
  await page.getByLabel("Your explanation", { exact: true }).fill("Other course notes");
  await page.getByRole("button", { name: "Save a new version", exact: true }).click();

  await page.goto("/preview/course?course=ESOL%20B1#course-materials");
  const materials = page.locator("#course-materials");
  await expect(materials.locator("time")).toHaveText(["2026-09-29", "2026-09-30", "2026-10-02"]);
  await expect(materials.getByText(notes, { exact: true })).toBeVisible();
  await expect(
    materials.getByText(/Use the present perfect for a past action connected to now/),
  ).toBeVisible();
  await expect(materials.getByText("Other course notes", { exact: true })).toHaveCount(0);
  await expect(
    materials
      .getByRole("article")
      .nth(1)
      .getByText(/No notes yet/),
  ).toBeVisible();
  expect(await page.evaluate(() => "courseInjected" in window)).toBe(false);

  await materials
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Travel notebook", exact: true }) })
    .getByRole("button", { name: "Session notes", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Travel notebook");
  await expect(page.getByText(notes, { exact: true })).toBeVisible();
  await page.goto("/preview/class");
  await openClassTools(page);
  await page.getByRole("link", { name: "Session options", exact: true }).click();
  await page.getByLabel("Move to course").selectOption("My classes");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.goto("/preview/course?course=ESOL%20B1#course-materials");
  await expect(page.locator("#course-materials").getByText(notes, { exact: true })).toHaveCount(0);
  await page.getByLabel("Course", { exact: true }).selectOption("My classes");
  await expect(page.locator("#course-materials").getByText(notes, { exact: true })).toBeVisible();
});

test("D40: prepared sample material names an automatic session and shows its dated topics in the course", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/preview/new-class?course=ESOL%20B1");
  await page.getByLabel("Session date", { exact: true }).fill("29/09/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2026-09-29");
  await openClassTools(page);
  await expect(page.getByText(/Waiting for material/)).toBeVisible();
  await page.goto("/preview/upload");
  await page.getByLabel("Add sample file names", { exact: true }).setInputFiles({
    name: "unknown-topic.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic example"),
  });
  await page.getByRole("button", { name: "Upload & Process", exact: true }).click();
  await expect(page.getByText(/Sample upload successful/)).toBeVisible();
  await expect(page.getByText("unknown-topic.png", { exact: true })).toBeVisible();
  await page.goto("/preview/estimate");
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await page.getByRole("button", { name: "Complete sample processing", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await page.goto("/preview/class");
  await openClassTools(page);
  const overview = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Session overview", exact: true }) });
  await expect(overview.locator("time")).toHaveText("2026-09-29");
  await expect(overview).toContainText("Title from material");
  await expect(overview.getByRole("listitem")).toHaveText([
    "Present perfect",
    "Already and yet",
    "Past participles",
  ]);
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await page.goto("/preview/course?course=ESOL%20B1#course-materials");
  const materials = page.locator("#course-materials");
  await expect(materials.locator("time")).toHaveText(["2026-09-29", "2026-09-30", "2026-10-02"]);
  const generatedSession = materials.getByRole("article").first();
  await expect(generatedSession.getByRole("heading", { level: 3 })).toHaveText("Present perfect");
  await expect(generatedSession).toContainText(
    "Topics: Present perfect · Already and yet · Past participles",
  );
  await expect(generatedSession).toContainText("Authored sample result · not extracted from files");
  await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
});

test("D40: a custom title survives sample processing and can be cleared to use the material title", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("My evening session");
  await page.getByLabel("Session date", { exact: true }).fill("03/10/2026");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await page.goto("/preview/upload");
  await page.getByLabel("Add sample file names", { exact: true }).setInputFiles({
    name: "sample-board.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic example"),
  });
  await page.getByRole("button", { name: "Upload & Process", exact: true }).click();
  await expect(page.getByText(/Sample upload successful/)).toBeVisible();
  await expect(page.getByText("sample-board.png", { exact: true })).toBeVisible();
  await page.goto("/preview/estimate");
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await page.getByRole("button", { name: "Complete sample processing", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My evening session");
  await page.goto("/preview/organize");
  await expect(page.getByLabel("Session name", { exact: true })).toHaveValue("My evening session");
  await page.getByLabel("Session name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await page.goto("/preview/organize");
  await expect(page.getByLabel("Session name", { exact: true })).toHaveValue("");
});

test("D40: a legacy stored class title remains a manual override", async ({ page }) => {
  await page.goto("/preview/class");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present perfect");
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    saved.classes[0].title = "Legacy custom class";
    for (const lesson of saved.classes) delete lesson.customTitle;
    delete saved.materialMetadata;
    for (const content of Object.values(saved.classWorkspaces)) {
      delete (content as { materialMetadata?: unknown }).materialMetadata;
    }
    localStorage.setItem(key, JSON.stringify(saved));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Legacy custom class");
  await page.goto("/preview/organize");
  await expect(page.getByLabel("Session name", { exact: true })).toHaveValue("Legacy custom class");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Legacy custom class");
});
