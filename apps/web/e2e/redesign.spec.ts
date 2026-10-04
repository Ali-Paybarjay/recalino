import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test(`welcome fits phones and the tablet breakpoint: ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
    }
    // The existing sign-in suite covers phones and desktop; check the two-column breakpoint.
    await page.setViewportSize({ width: 768, height: 900 });
    await expectNoAxeViolations(page);
  });
}

// The Today preview uses the real first-use view without needing a database or a fake account.
// Check what users need: readable layouts, accessible content and a working example link.
for (const scheme of ["light", "dark"] as const) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`Today first-use view stays readable and accessible: ${scheme}, ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/ui/experience");
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Make room for your English." }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Check your learning profile" })).toHaveAttribute(
        "href",
        "/me",
      );
      await expect(page.getByText("Pilot preview", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page);
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`learning preferences remain accessible in a mixed-language profile: ${scheme}, ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/ui/profile");
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Your learning profile" })).toBeVisible();
      await expect(page.getByRole("link", { name: /First language/ })).toHaveAttribute(
        "href",
        "/me/edit/first-language",
      );
      await expect(page.locator("bdi[lang='fa']").first()).toHaveAttribute("dir", "auto");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page);
    });
  }
}

test("the example action can be used with the keyboard and reaches the labelled note", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/dev/ui/experience");
  const example = page.getByRole("link", { name: "See an example" });
  await example.focus();
  await expect(example).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#example-note$/);
  const note = page.getByRole("region", { name: "Small word. Useful difference." });
  await expect(note).toBeInViewport();
  await expect(note.getByText("Example · English vocabulary", { exact: true })).toBeVisible();
  await expect(note.getByText("From class", { exact: true })).toBeVisible();
  await expect(note.getByText("AI explanation", { exact: true })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, viewport] of [
    ["mobile", VIEWPORTS.mobile],
    ["desktop", VIEWPORTS.desktop],
  ] as const) {
    test(`all five setup screens remain readable and accessible: ${scheme}, ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/ui/setup?step=1");
      const screens = [
        "First language",
        "Explanations",
        "Level and goal",
        "Daily review",
        "Recording",
      ];
      const nav = page.getByRole("navigation", { name: "Preview setup screens" });
      for (const [index, screen] of screens.entries()) {
        await nav.getByRole("link", { name: screen, exact: true }).click();
        await expect(page.getByText(`${index + 1} of 5`, { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBeLessThanOrEqual(1);
        await expectNoAxeViolations(page);
      }
    });
  }
}

test("setup keeps the chosen language on Back and requires recording consent", async ({ page }) => {
  // The preview has no account. Mock only the save response to exercise the real client state.
  await page.route("**/api/profile", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      field: "first_language",
      firstLanguage: "fa",
    });
    await route.fulfill({ json: { setupStep: 3, setupComplete: false } });
  });
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/dev/ui/setup?step=1");
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  await search.fill("فار");
  await search.press("Enter");
  await expect(page.getByRole("option", { name: /Persian/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("option", { name: /Persian/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.goto("/dev/ui/setup?step=7");
  const consent = page.getByRole("checkbox", {
    name: "I understand that I must ask the people in my class before I record.",
  });
  const finish = page.getByRole("button", { name: "Finish setup" });
  await expect(consent).not.toBeChecked();
  await expect(finish).toHaveAttribute("aria-disabled", "true");
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await expect(finish).not.toHaveAttribute("aria-disabled");
});

test("arrow-key navigation scrolls the active language into view and keeps search focused", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/dev/ui/setup?step=1");
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  await expect(page.getByRole("option").first()).toBeVisible();
  await search.focus();
  for (let index = 0; index < 8; index += 1) await search.press("ArrowDown");
  await expect(search).toBeFocused();
  const activeId = await search.getAttribute("aria-activedescendant");
  if (!activeId) throw new Error("No active language option");
  const active = page.locator(`[id="${activeId}"]`);
  const list = page.getByRole("listbox");
  const listBox = await list.boundingBox();
  const activeBox = await active.boundingBox();
  if (!listBox || !activeBox) throw new Error("Language list did not render");
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(activeBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
  expect(activeBox.y + activeBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
});
