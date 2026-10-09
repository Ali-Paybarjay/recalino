import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { renderStudyCard } from "@recalino/core/study-render";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";

const output = resolve(import.meta.dirname, "../../../artifacts/verification");

function referenceReviewQueue(studySet: string, skipFirst = false) {
  const createdAt = "2026-10-05T12:00:00.000Z";
  const cards = referenceStudyModel()
    .learningItems.map((item, index) => ({
      id: `reference-card-${index}`,
      ownerId: "10000000-0000-4000-8000-000000000002",
      learningItemId: item.id,
      sessionIds: ["10000000-0000-4000-8000-000000000001"],
      template: "basic",
      direction: "forward",
      ...renderStudyCard(item),
      provenance: item.claim,
      status: "active",
      contentVersion: 1,
      important: false,
      qualityConfirmed: true,
      frontMediaId: null,
      backMediaId: null,
      createdAt,
      updatedAt: createdAt,
      contentFormat: "lesson_html",
      studySet: item.study?.set,
    }))
    .filter((card) => card.studySet === studySet && (!skipFirst || card.id !== "reference-card-0"));
  return {
    studySet,
    availableStudySets: ["production", "recognition"],
    cards: cards.map((card) => ({
      card,
      schedule: {
        cardId: card.id,
        version: 0,
        dueAt: createdAt,
        introducedAt: null,
        state: {
          due: createdAt,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          state: 0,
        },
      },
    })),
    dueCount: 0,
    newRemaining: 10,
    buriedSiblings: 0,
    nextDueAt: null,
    studyDay: "2026-10-05",
    timezone: "Europe/London",
    settings: { mode: "simple", desiredRetention: 0.9, dailyNewLimit: 20, timeBudgetMinutes: 10 },
  };
}

async function mockReviewSets(page: import("@playwright/test").Page, skipFirst = () => false) {
  await page.route("**/api/review?*", async (route) => {
    const studySet = new URL(route.request().url()).searchParams.get("studySet");
    await route.fulfill({ json: referenceReviewQueue(studySet ?? "production", skipFirst()) });
  });
}

test("reference notes keep navigation, responsive tables, theme and print inside their frame", async ({
  page,
}) => {
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 420, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/dev/ui/study");
  const frame = page.frameLocator('iframe[title^="Session notes:"]');
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(frame.locator("#core .entry")).toHaveCount(3);
  await expect(frame.locator("#mistakes")).toContainText(
    "اشتباهات گفتاری این جلسه نمایش داده نشده",
  );
  await expect(page.locator('iframe[title^="Session notes:"]')).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.locator('iframe[title^="Session notes:"]')).not.toHaveAttribute(
    "sandbox",
    /allow-same-origin/,
  );
  for (const width of [420, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await frame.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  const links = await frame
    .locator("nav a")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
  for (const href of links) {
    await frame.locator(`nav a[href="${href}"]`).click();
    await expect(frame.locator(`${href} h2`)).toBeVisible();
    expect(page.url()).toContain("/dev/ui/study");
    const positions = await frame.locator(href ?? "#core").evaluate((element) => ({
      sectionTop: element.getBoundingClientRect().top,
      navBottom: document.querySelector("nav")?.getBoundingClientRect().bottom ?? 0,
      navTop: document.querySelector("nav")?.getBoundingClientRect().top ?? -1,
    }));
    expect(positions.navTop).toBeGreaterThanOrEqual(-1);
    expect(positions.navTop).toBeLessThanOrEqual(1);
    expect(positions.sectionTop).toBeGreaterThanOrEqual(positions.navBottom - 2);
    await frame.locator(`${href} .top`).click();
    expect(await frame.locator("body").evaluate(() => window.scrollY)).toBe(0);
  }
  await frame.locator("nav").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: resolve(output, "reference-study-notes-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(22, 24, 27)");
  await page.screenshot({
    path: resolve(output, "reference-study-notes-dark.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(frame.locator("nav")).toBeHidden();
  // Print replaces each hidden-answer toggle group with its key: the gap-fill and D49 check.
  await expect(frame.locator("#gap .key")).toBeVisible();
  await expect(frame.locator("#check .key")).toBeVisible();
  await expect(frame.locator("#gap ol.gaps details").first()).toBeHidden();
  await expect(frame.locator("#check details").first()).toBeHidden();
});

test("production review reveals the reference front, rule and back and keeps supplementary cards separate", async ({
  page,
}) => {
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 420, height: 2400 });
  await page.emulateMedia({ colorScheme: "light" });
  await mockReviewSets(page);
  await page.goto("/dev/ui/study?view=review");
  const face = page.locator(".fc-face");
  await expect(face).toContainText("______");
  await expect(face).not.toContainText("wear and tear");
  expect(await face.locator("[title], [alt]").count()).toBe(0);
  await page.locator(".preview-panel").screenshot({
    path: resolve(output, "reference-study-card-front.png"),
  });
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(face).toContainText("______");
  await expect(face).toContainText("wear and tear");
  await expect(face.locator("hr")).toHaveCount(1);
  await expect(face).toContainText("/ˌweər ən ˈteə/");
  await page.locator(".preview-panel").screenshot({
    path: resolve(output, "reference-study-card-revealed.png"),
  });
  await page.getByRole("button", { name: /Supplementary · recognition/ }).click();
  await expect(face).toContainText("I was about to");
  await expect(face.locator("hr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show answer", exact: true })).toBeVisible();
});

test("Anki text downloads preserve separate sets and custom deck settings", async ({ page }) => {
  await page.goto("/dev/ui/study?view=export");
  await page.getByLabel("Anki deck name").fill("Claude ESOL class");
  await page.getByLabel("Course tag", { exact: true }).fill("cambria");
  for (const [label, suffix, count, set] of [
    ["Download core cards", "", 3, "production"],
    ["Download supplementary cards", "-extra", 7, "recognition"],
  ] as const) {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: new RegExp(label) }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(`class-2026-10-05${suffix}.txt`);
    const path = await download.path();
    expect(path).not.toBeNull();
    const text = await readFile(path ?? "", "utf8");
    expect(text).not.toContain("Rejected synthetic card");
    expect(text).not.toContain("Deleted synthetic card");
    const lines = text.trimEnd().split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "#separator:tab",
      "#html:true",
      "#notetype:Basic",
      "#deck:Claude ESOL class",
      "#tags column:3",
    ]);
    expect(lines.slice(5)).toHaveLength(count);
    for (const line of lines.slice(5)) {
      const columns = line.split("\t");
      expect(columns).toHaveLength(3);
      expect(columns[2]).toContain("cambria");
      expect(columns[2]).toMatch(new RegExp(`${set}$`));
    }
  }
});

test("a failed grade stays on the same card and reuses its event before set switching", async ({
  page,
}) => {
  const submitted: Array<{ cardId: string; eventId: string }> = [];
  let saved = false;
  await mockReviewSets(page, () => saved);
  await page.route("**/api/review/events", async (route) => {
    const body = route.request().postDataJSON();
    submitted.push(body);
    if (submitted.length === 1) {
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "internal", message: "Synthetic save failure. Retry the same answer." },
        },
      });
    } else {
      saved = true;
      await route.fulfill({
        json: {
          eventId: body.eventId,
          cardId: body.cardId,
          version: 1,
          dueAt: "2026-10-06T12:00:00.000Z",
          rating: 3,
          studyDay: "2026-10-05",
        },
      });
    }
  });
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic save failure" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Supplementary · recognition/ })).toBeDisabled();
  await expect(page.locator(".fc-face")).toContainText("wear and tear");
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(page.locator(".fc-face")).toContainText("new office");
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  const nextSet = page.waitForRequest(
    (request) =>
      request.url().includes("/api/review?") && request.url().includes("studySet=recognition"),
  );
  await page.getByRole("button", { name: /Supplementary · recognition/ }).click();
  await nextSet;
  await expect(page.locator(".fc-face")).toContainText("I was about to");
  await expect(page.locator(".fc-face hr")).toHaveCount(0);
});
