import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

test("AC-FBK-001 learner can submit mixed-direction feedback and follow up in the private thread", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/help");
  await expect(page.getByText("Your questions and feedback will appear here.")).toBeVisible();
  await page.getByRole("link", { name: "New message", exact: true }).click();
  await page.getByLabel("Subject", { exact: true }).fill("پرسش آزمایشی دربارهٔ کلاس");
  await page
    .getByLabel("Your message", { exact: true })
    .fill("How can I share an idea? یک پیشنهاد برای کلاس.");
  await page.getByLabel("Email me when there is a reply", { exact: false }).uncheck();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page).toHaveURL(/\/help\/[a-f0-9-]+\?received=1$/);
  await expect(
    page.getByText("Message received. We will reply in this conversation."),
  ).toBeVisible();
  await expect(page.getByText("Waiting for a reply", { exact: true })).toBeVisible();
  await expect(
    page.getByText("How can I share an idea? یک پیشنهاد برای کلاس.", { exact: true }),
  ).toHaveAttribute("dir", "auto");
  await page.getByLabel("Your reply", { exact: true }).fill("Here are more details.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByText("Here are more details.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Here are more details.", { exact: true })).toHaveCount(1);
});

test("AC-FBK-001 failed submission preserves draft across reload and retains one retry key", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/help/new");
  await page.getByLabel("Subject", { exact: true }).fill("Synthetic saved draft");
  await page
    .getByLabel("Your message", { exact: true })
    .fill("Keep this private draft until submission works.");
  const keys: string[] = [];
  await page.route("**/api/support", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":{"code":"internal"}}',
    });
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your draft is still here" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(
    "Keep this private draft until submission works.",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your draft is still here" }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page.unroute("**/api/support");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page).toHaveURL(/\/help\/[a-f0-9-]+\?received=1$/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-FBK-001 mobile feedback is accessible in ${scheme}`, async ({ page }) => {
    test.setTimeout(60000);
    await signInAsNewLearner(page, { setup: "complete" });
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/help/new");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
