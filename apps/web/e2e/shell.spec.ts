import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

// App shell: bottom navigation on mobile, compact labelled sidebar from 768px, and full sidebar
// from 1024px. Labels remain visible so tablet users can identify every destination.

test("mobile: bottom navigation with the current page marked", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/dev/ui/shell");
  await expect(page.locator("aside")).toBeHidden();
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  // The due count is read with the link name; the hidden span adds a word break.
  await expect(nav.getByRole("link", { name: /^Review\s*,\s*12 due$/ })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("tablet: compact sidebar keeps navigation labels visible", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.tablet);
  await page.goto("/dev/ui/shell");
  const sidebar = page.locator("aside");
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBe(176);
  await expect(sidebar.getByRole("link", { name: "New session" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Today" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByText("Today", { exact: true })).toBeInViewport();
  await expect(sidebar.getByText("Allowance")).toBeHidden();
  await expectNoAxeViolations(page);
});

test("desktop: 248px sidebar with wordmark, New class and due count", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/dev/ui/shell");
  const sidebar = page.locator("aside");
  expect((await sidebar.boundingBox())?.width).toBe(248);
  await expect(sidebar.getByText("recalino")).toBeVisible();
  await expect(sidebar.getByText("12 due")).toBeVisible();
  await expect(sidebar.getByText("Allowance")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the first Tab reaches the skip link, which moves focus to the content", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/dev/ui/shell");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#content")).toBeFocused();
});

// UX-08: moving between the four sections keeps the navigation on screen; only the content waits.
// Next prefetches a page's loading state only in a production build (`next start`, as CI runs
// it), so that is where a held-back page can be told apart from a slow navigation.
for (const [name, viewport] of [
  ["desktop", VIEWPORTS.desktop],
  ["mobile", VIEWPORTS.mobile],
] as const) {
  test(`${name}: the navigation stays while the next page loads`, async ({ page }) => {
    test.skip(!process.env.CI, "the loading state is prefetched only by a production build");
    await signInAsNewLearner(page, { setup: "complete" });
    await page.setViewportSize(viewport);
    // Hold back the page itself (not the prefetch of its loading state), like a slow network.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isPrefetch = (headers: Record<string, string>) =>
      Boolean(headers["next-router-prefetch"]);
    await page.route(
      (url) => url.pathname === "/review",
      async (route) => {
        const headers = route.request().headers();
        if (headers.rsc && !isPrefetch(headers)) await held;
        await route.continue();
      },
    );
    const prefetched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/review" && isPrefetch(response.request().headers()),
    );
    await page.goto("/today");
    await prefetched;
    const nav = page.getByRole("navigation", { name: "Your learning space" });
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: /^Review/ }).click();
    // The same navigation is still there and already marks Review; the content area is loading.
    const loading = page.getByRole("status").filter({ hasText: "Loading your learning space" });
    await expect(loading).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Review/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expectNoAxeViolations(page);
    release();
    await expect(page).toHaveURL(/\/review$/);
    await expect(loading).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^Review/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}
