import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PREVIEW_SCREENS } from "../src/ui/preview/screens";
import { expect, expectNoAxeViolations, SAMPLE_BANNER, test, VIEWPORTS } from "./helpers";

const capture = process.env.RECALINO_PREVIEW_SCREENSHOTS === "1";
const screenshotDirectory = resolve(process.cwd(), "../../artifacts/ui-redesign/complete");
const initialHeadings: Readonly<Record<string, string>> = {
  course: "Your courses",
  "processing-result": "No processing result yet",
  "review-card": "A moment to remember",
  "review-answer": "Compare your answer",
  "review-summary": "A little practice is ready when you are.",
};

test("the required design inventory contains all 49 distinct screens", () => {
  expect(PREVIEW_SCREENS).toHaveLength(49);
  expect(new Set(PREVIEW_SCREENS.map((screen) => screen.key)).size).toBe(49);
});

for (const name of ["mobile", "desktop"] as const) {
  for (const screen of PREVIEW_SCREENS) {
    test(`sample screen renders without authentication: ${screen.key}, ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORTS[name]);
      await page.emulateMedia({ colorScheme: "light" });
      const response = await page.goto(`/preview/${screen.key}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset sample", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        initialHeadings[screen.key] ?? screen.title,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      if (capture) {
        await mkdir(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: resolve(screenshotDirectory, `${screen.key}-${name}-light.png`),
          fullPage: true,
          style: "nextjs-portal { display: none !important; }",
        });
      }
    });
  }
}

// These cover navigation, dense sources, reading, focused practice and mixed-language forms.
for (const key of [
  "today",
  "upload",
  "notes",
  "review-answer",
  "edit-language",
  "legal",
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      test(`sample accessibility: ${key}, ${name}, ${scheme}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/preview/${key}`);
        await expect(page.getByRole("button", { name: "Reset sample", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          initialHeadings[key] ?? PREVIEW_SCREENS.find((screen) => screen.key === key)?.title ?? "",
        );
        await expectNoAxeViolations(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        if (capture && scheme === "dark") {
          await mkdir(screenshotDirectory, { recursive: true });
          await page.screenshot({
            path: resolve(screenshotDirectory, `${key}-${name}-${scheme}.png`),
            fullPage: true,
            style: "nextjs-portal { display: none !important; }",
          });
        }
      });
    }
  }
}
