import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

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
