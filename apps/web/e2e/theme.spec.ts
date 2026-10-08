import { expect, test } from "@playwright/test";

// HANDOFF §2: the theme follows the OS, is set before the first paint and follows later changes.

test("light colour scheme gives the light theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 242)");
});

test("dark colour scheme gives the dark theme before the page finishes loading", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 27, 23)");
});

test("the theme follows a change of the OS setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("reduced motion sets every duration token to zero", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--rc-dur").trim(),
  );
  expect(duration).toMatch(/^0m?s$/);
});

test("no font files and nothing from another host (FR-PLT-011, D31 rule 8)", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(`${request.resourceType()} ${request.url()}`);
  });
  await page.goto("/dev/ui", { waitUntil: "networkidle" });
  const origin = new URL(page.url()).origin;
  expect(requests.filter((line) => line.startsWith("font "))).toEqual([]);
  expect(requests.filter((line) => !line.split(" ")[1]?.startsWith(origin))).toEqual([]);
});
