import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});
test("capture survives app navigation and offline time, saves final parts and remains owner-scoped", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/today");
  await page.getByRole("button", { name: "Record a class", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await expect
    .poll(async () => page.locator('[aria-label="Active recording time"]').textContent(), {
      timeout: 10000,
    })
    .not.toBe("0:00");
  await page.getByRole("link", { name: "Classes", exact: true }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Class recording continues" }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByText("Offline · controls are available here", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume recording", exact: true }).click();
  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audio", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^class-.*\.(webm|m4a|ogg)$/);
  await context.setOffline(false);
  await page.getByRole("link", { name: "Open recording", exact: true }).click();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expectNoAxeViolations(page);
  const switchAccount = await page.request.post("/dev/auth/session", {
    data: { setup: "complete" },
  });
  expect(switchAccount.status()).toBe(200);
  await page.goto("/recordings");
  await expect(page.getByText("No recordings on this device yet.", { exact: true })).toBeVisible();
});
