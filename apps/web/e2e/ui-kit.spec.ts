import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

// Components in every state on the UI test page (M2, T4). Rules from handoff/components.md and
// handoff/accessibility.md.

for (const scheme of ["light", "dark"] as const) {
  for (const [name, viewport] of [
    ["mobile", VIEWPORTS.mobile],
    ["desktop", VIEWPORTS.desktop],
  ] as const) {
    test(`no WCAG 2.2 AA violations: ${scheme}, ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/ui");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expectNoAxeViolations(page);
    });
  }
}

test("an unavailable button stays focusable, says why and does nothing", async ({ page }) => {
  await page.goto("/dev/ui");
  const button = page.getByRole("button", { name: "Continue with Google" });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toHaveAccessibleDescription("Please tick both boxes to continue.");
  await button.focus();
  await expect(button).toBeFocused();
  // Playwright waits for aria-disabled controls to become enabled; force the click to prove it
  // does nothing.
  await button.click({ force: true });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("presses")).toHaveText("0");
  await page.getByRole("button", { name: "Start review" }).first().click();
  await expect(page.getByTestId("presses")).toHaveText("1");
});

test("consent boxes start unticked and toggle with the keyboard", async ({ page }) => {
  await page.goto("/dev/ui");
  const adult = page.getByRole("checkbox", { name: "I am 18 or older" });
  await expect(adult).not.toBeChecked();
  await adult.focus();
  await page.keyboard.press("Space");
  await expect(adult).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Worksheet pages (4)" })).toBeDisabled();
});

test("a switch toggles from its label and from the keyboard", async ({ page }) => {
  await page.goto("/dev/ui");
  const autoAdd = page.getByRole("switch", { name: "Auto add" });
  await expect(autoAdd).toHaveAttribute("aria-checked", "false");
  await page.getByText("Auto add", { exact: true }).click();
  await expect(autoAdd).toHaveAttribute("aria-checked", "true");
  await autoAdd.focus();
  await page.keyboard.press("Space");
  await expect(autoAdd).toHaveAttribute("aria-checked", "false");
});

test("a segmented control moves with the arrow keys", async ({ page }) => {
  await page.goto("/dev/ui");
  const medium = page.getByRole("radio", { name: "Medium" });
  await expect(medium).toBeChecked();
  await medium.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Original", exact: true })).toBeChecked();
});

test("radio cards have no default choice", async ({ page }) => {
  await page.goto("/dev/ui");
  const explain = page.getByRole("radiogroup", { name: "Explanations in" });
  await expect(explain.getByRole("radio")).toHaveCount(2);
  for (const radio of await explain.getByRole("radio").all()) {
    await expect(radio).not.toBeChecked();
  }
  await explain.getByText("English").click();
  await expect(explain.getByRole("radio", { name: "English" })).toBeChecked();
});

test("an inline error is announced and retries", async ({ page }) => {
  await page.goto("/dev/ui");
  const error = page.getByRole("alert").filter({ hasText: "Couldn't load your sessions" });
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("retries")).toHaveText("1");
});

test("a sheet takes focus, keeps it inside and gives it back on Esc", async ({ page }) => {
  await page.goto("/dev/ui");
  const trigger = page.getByRole("button", { name: "Open sheet" });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "New session" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "New session" })).toBeFocused();
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  // The page behind is inert while the sheet is open.
  await trigger.focus();
  expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the close button closes a sheet", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Open sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "New session" });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

test("a destructive confirm starts on the safe action; Esc keeps", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Open delete confirm" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete this session?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    /Files you already downloaded can't be recalled\./,
  );
  await expect(dialog.getByRole("button", { name: "Keep session" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("overlay-result")).toHaveText("kept class");
});

test("losing un-sent audio needs the extra tick", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Open discard confirm" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Discard this recording?" });
  await expect(dialog.getByRole("button", { name: "Keep recording" })).toBeFocused();
  const discard = dialog.getByRole("button", { name: "Discard" });
  await expect(discard).toBeDisabled();
  await dialog.getByText("I understand this can't be undone").click();
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  await expect(discard).toBeEnabled();
  await discard.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("overlay-result")).toHaveText("discarded");
});

test("a snackbar stays 8 seconds, pauses while hovered and offers Undo", async ({ page }) => {
  await page.clock.install();
  await page.goto("/dev/ui");
  const show = page.getByRole("button", { name: "Show snackbar" });
  const snackbar = page.getByRole("status").filter({ hasText: "Card suspended" });

  await show.click();
  await expect(snackbar).toBeVisible();
  await page.clock.runFor(7_500);
  await expect(snackbar).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(snackbar).toBeHidden();

  await show.click();
  await snackbar.hover();
  await page.clock.runFor(20_000);
  await expect(snackbar).toBeVisible();
  await snackbar.getByRole("button", { name: "Undo" }).click();
  await expect(snackbar).toBeHidden();
  await expect(page.getByTestId("overlay-result")).toHaveText("undone");
});

test("an info tip opens on press and closes on a second press, outside press, Escape or Tab", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/dev/ui");
  const button = page.getByRole("button", { name: "About units" });
  const help = page.getByText("Units are like the chapters of your book.");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(help).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(help).toBeVisible();
  // The box stays inside the 16px gutter of a 390px screen.
  const box = await help.locator("..").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(16);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390 - 16);
  await expectNoAxeViolations(page);
  // Pressing inside the box, for example to select text, keeps it open.
  await help.click();
  await expect(help).toBeVisible();
  await button.click();
  await expect(help).toBeHidden();

  await button.click();
  await page.getByRole("heading", { name: "UI kit" }).click();
  await expect(help).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(button).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(help).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(help).toBeHidden();
});
