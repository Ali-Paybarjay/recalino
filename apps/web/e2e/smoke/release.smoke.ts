import { expect, type Page, test } from "@playwright/test";

// Read-only release smoke test (D66). No sign-in, no form submission, GET requests only.

const HOME_HEADING = "Turn your English class into clear notes and a short daily review.";

/** Collects console errors and uncaught page errors for one page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test("home page renders without console errors", async ({ page }) => {
  const errors = watchErrors(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("synthetic preview renders without console errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/preview");
  await expect(page).toHaveURL(/\/preview\/today$/);
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

for (const path of ["/today", "/sessions", "/recordings", "/review", "/me", "/setup", "/admin"]) {
  test(`protected page ${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/" && url.searchParams.get("next") === path,
    );
    await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("developer UI kit is not served in production", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.locator("#not-found-title")).toBeVisible();
});

for (const path of [
  "/api/classes",
  "/api/quota",
  "/api/learning",
  "/api/notifications",
  "/api/admin",
  "/api/review",
  "/api/review/settings",
  "/api/jobs/run",
]) {
  test(`API ${path} refuses a request without a session`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  });
}

test("health route and static assets load", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  for (const path of [
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/favicon.svg",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
  }
});
