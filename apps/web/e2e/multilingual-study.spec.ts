import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { renderClassNotesHtml, renderStudyCard } from "@recalino/core/study-render";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../../packages/core/test/multilingual-study-fixture";
import { NOTE_PRONUNCIATION_BRIDGE } from "../src/ui/workspace/class-notes-pronunciation";

const output =
  process.env.RECALINO_VERIFY_OUTPUT ??
  resolve(import.meta.dirname, "../../../artifacts/verification/multilingual-study");
const persianOnly = /تقریب فارسی|کارت‌های اصلی|تله‌ی بزرگ|استهلاک|چیزهایی که معلم/;

async function downloadText(download: import("@playwright/test").Download): Promise<string> {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path ?? "", "utf8");
}

for (const value of MULTILINGUAL_STUDY_CASES) {
  test(`${value.language} notes preserve native prose, English isolation, mobile layout and dark theme`, async ({
    page,
  }) => {
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/dev/ui/study?language=${encodeURIComponent(value.language)}`);
    const frame = page.frameLocator('iframe[title^="Session notes:"]');
    await expect(frame.locator("html")).toHaveAttribute("lang", value.language);
    await expect(frame.locator("html")).toHaveAttribute("dir", value.dir);
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(frame.locator("#core .mean")).toContainText(value.meaning);
    await expect(frame.locator("#core .mean")).toHaveCSS("direction", value.dir);
    await expect(frame.locator("body")).not.toContainText(persianOnly);
    await expect(frame.locator("#core .ex")).toHaveAttribute("dir", "ltr");
    await expect(frame.locator("#core .ex")).toHaveCSS("direction", "ltr");
    await expect(frame.locator("#core .ipa").first()).toHaveAttribute("dir", "ltr");
    await expect(page.locator('iframe[title^="Session notes:"]')).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    await expect(page.locator('iframe[title^="Session notes:"]')).not.toHaveAttribute(
      "sandbox",
      /allow-same-origin/,
    );
    for (const width of [390, 420]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await frame
          .locator("html")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator("html")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    for (const href of await page
      .getByRole("navigation", { name: "Reference views" })
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
      expect(new URL(href ?? "", page.url()).searchParams.get("language")).toBe(value.language);
    }
    await page.screenshot({
      path: resolve(output, `notes-${value.language}-light.png`),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(22, 24, 27)");
    await page.screenshot({
      path: resolve(output, `notes-${value.language}-dark.png`),
      fullPage: true,
    });
  });

  test(`${value.language} production and recognition cards retain their meaning and reveal separately`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const model = multilingualStudyModel(value);
    const createdAt = "2026-10-05T12:00:00.000Z";
    const cards = model.learningItems
      .map((item, index) => ({
        id: `reference-card-${index}`,
        ownerId: "10000000-0000-4000-8000-000000000002",
        learningItemId: item.id,
        sessionIds: ["10000000-0000-4000-8000-000000000001"],
        template: "basic",
        direction: "forward",
        ...renderStudyCard(item, model.language.explanation),
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
      .sort((a, b) => Number(a.studySet !== "production") - Number(b.studySet !== "production"));
    let answered = 0;
    await page.route("**/api/review/events", async (route) => {
      const card = cards[answered++];
      await route.fulfill({
        json: {
          eventId: "20000000-0000-4000-8000-000000000001",
          cardId: card?.id,
          version: 1,
          dueAt: "2026-10-06T12:00:00.000Z",
          rating: 3,
          studyDay: "2026-10-05",
        },
      });
    });
    await page.route("**/api/review?*", async (route) => {
      await route.fulfill({
        json: {
          hasCards: true,
          cards: cards.slice(answered).map((card) => ({
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
          newRemaining: 2,
          buriedSiblings: 0,
          nextDueAt: null,
          studyDay: "2026-10-05",
          timezone: "Europe/London",
          settings: {
            mode: "simple",
            desiredRetention: 0.9,
            dailyNewLimit: 20,
            timeBudgetMinutes: 10,
          },
        },
      });
    });
    await page.goto(`/dev/ui/study?language=${encodeURIComponent(value.language)}&view=review`);
    const face = page.locator(".fc-face");
    await expect(face).toContainText(value.meaning);
    await expect(face).toContainText("______");
    await expect(face).not.toContainText("wear and tear");
    const meaning = face.locator(`div[lang="${value.language}"]`).first();
    await expect(meaning).toHaveAttribute("dir", value.dir);
    await expect(meaning).toHaveCSS("direction", value.dir);
    await page.getByRole("button", { name: "Show answer", exact: true }).click();
    await expect(face).toContainText("wear and tear");
    await expect(face).toContainText(value.note);
    await expect(face.locator("hr")).toHaveCount(1);
    await expect(face).not.toContainText(persianOnly);
    await expect(face.locator('[dir="ltr"]').first()).toHaveCSS("direction", "ltr");
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    // D79: one queue; the recognition card follows the core card without choosing a set.
    await expect(page.getByText("Core · production", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remembered", exact: true }).click();
    await expect(page.getByText("Supplementary · recognition", { exact: true })).toBeVisible();
    await expect(face).toContainText("normal use");
    await expect(face).not.toContainText(value.meaning);
    await expect(face.locator("hr")).toHaveCount(0);
    await page.getByRole("button", { name: "Show answer", exact: true }).click();
    await expect(face).toContainText(value.meaning);
    await expect(face.locator(`div[lang="${value.language}"]`).first()).toHaveAttribute(
      "dir",
      value.dir,
    );
  });

  test(`${value.language} downloaded HTML and both TSV card sets preserve the displayed content`, async ({
    page,
  }) => {
    const model = multilingualStudyModel(value);
    await page.goto(`/dev/ui/study?language=${encodeURIComponent(value.language)}`);
    const htmlDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download synthetic HTML", exact: true }).click();
    const downloaded = await htmlDownload;
    expect(downloaded.suggestedFilename()).toBe(`class-${value.language}.html`);
    const html = await downloadText(downloaded);
    expect(html).toBe(renderClassNotesHtml(model));
    expect(html).toContain(value.meaning);
    expect(html).toContain(`<html lang="${value.language}" dir="${value.dir}"`);
    expect(html).not.toMatch(persianOnly);
    await page
      .getByRole("navigation", { name: "Reference views" })
      .getByRole("link", { name: "Export", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`language=${value.language}.*view=export`));
    await page.getByLabel("Anki deck name").fill("Multilingual synthetic class");
    for (const [set, label] of [
      ["production", "Download core cards"],
      ["recognition", "Download supplementary cards"],
    ] as const) {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: new RegExp(label) }).click();
      const text = await downloadText(await pending);
      expect(text).toContain("#deck:Multilingual synthetic class");
      expect(text).toContain(value.meaning);
      expect(text).toContain(`lang="${value.language}"`);
      expect(text).not.toMatch(persianOnly);
      const rows = text.trimEnd().split("\n").slice(5);
      expect(rows).toHaveLength(1);
      const columns = rows[0]?.split("\t") ?? [];
      const item = model.learningItems.find((entry) => entry.study?.set === set);
      if (!item) throw new Error("Missing synthetic study item");
      const faces = renderStudyCard(item, model.language.explanation);
      expect(columns.slice(0, 2)).toEqual([faces.front, faces.back]);
      expect(columns[2]).toMatch(new RegExp(`${set}$`));
    }
  });
}

test("unlisted and repeated fixture languages retain the guarded Persian reference", async ({
  page,
}) => {
  for (const query of ["language=xx", "language=es&language=ar", "language=%22%3E%3Cscript%3E"]) {
    await page.goto(`/dev/ui/study?${query}`);
    const frame = page.frameLocator('iframe[title^="Session notes:"]');
    await expect(frame.locator("html")).toHaveAttribute("lang", "fa");
    await expect(frame.locator("#core .entry")).toHaveCount(3);
    await expect(
      page.getByRole("link", { name: "Download synthetic HTML", exact: true }),
    ).toHaveCount(0);
    await expect(frame.locator("script")).toHaveCount(1);
    expect(await frame.locator("script").textContent()).toBe(NOTE_PRONUNCIATION_BRIDGE);
    const nonce = await frame.locator("script").getAttribute("nonce");
    expect(nonce).toMatch(/^[a-zA-Z0-9_-]{10,100}$/);
    await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      "content",
      expect.stringContaining(`script-src 'nonce-${nonce}'`),
    );
  }
});
