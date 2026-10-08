import { expect, test } from "./helpers";

test("all four profile edits persist locally and keep mixed-language content readable", async ({
  page,
}) => {
  await page.goto("/preview/profile");
  await expect(page.locator("bdi[lang='fa']").first()).toHaveAttribute("dir", "auto");
  await page.getByRole("link", { name: /^First language/ }).click();
  await page.getByRole("combobox", { name: "Search languages", exact: true }).fill("japan");
  await page.getByRole("option", { name: /Japanese/ }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("link", { name: /^First language/ })).toContainText("Japanese");
  await page.getByRole("link", { name: /^Explanations/ }).click();
  const english = page.getByRole("radio", { name: /^English only/ });
  await page.locator("label").filter({ has: english }).click();
  await expect(english).toBeChecked();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("link", { name: /^Level and goal/ }).click();
  await page.getByRole("radio", { name: "B2", exact: true }).check();
  const work = page.getByRole("radio", { name: "Work", exact: true });
  await page.locator("label").filter({ has: work }).click();
  await expect(work).toBeChecked();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("link", { name: /^Time zone/ }).click();
  await page.getByRole("combobox", { name: "Choose a time zone", exact: true }).fill("tokyo");
  await page.getByRole("option", { name: "Asia/Tokyo", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/profile$/);
  await page.reload();
  await expect(page.getByRole("link", { name: /^First language/ })).toContainText("Japanese");
  await expect(page.getByRole("link", { name: /^Explanations/ })).toContainText("English");
  await expect(page.getByRole("link", { name: /^Level and goal/ })).toContainText("B2 / Work");
  await expect(page.getByRole("link", { name: /^Time zone/ })).toContainText("Asia/Tokyo");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("Sign-out demonstration complete. This preview has no authenticated account."),
  ).toBeVisible();
});

test("sample setup gates explanations, permits skipping optional goals, and accepts consent with a pointer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/preview/setup-explanations");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  const english = page.getByRole("radio", { name: /^English only/ });
  await page.locator("label").filter({ has: english }).click();
  await expect(english).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/setup-timezone$/);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/renew-consent$/);
  await expect(
    page.getByRole("button", { name: "Accept and continue", exact: true }),
  ).toBeDisabled();
  const consent = page.getByRole("checkbox", {
    name: "I understand that I must ask the people in my class before I record.",
    exact: true,
  });
  await page.locator("label").filter({ has: consent }).click();
  await expect(consent).toBeChecked();
  await page.getByRole("button", { name: "Accept and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/today$/);
  await page.goto("/preview/profile");
  await expect(page.getByRole("link", { name: /^Level and goal/ })).toContainText(
    "Not set / Not set",
  );
});

test("legal reading and acceptance remain reachable on a short phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/preview/legal");
  const accept = page.getByRole("button", { name: "Accept and continue", exact: true });
  await expect(accept).toBeDisabled();
  await page.getByRole("button", { name: "Privacy Notice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Privacy Notice", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByText("Preview Operator (fictional)", { exact: false }).first(),
  ).toBeVisible();
  const terms = page.getByRole("checkbox", {
    name: "I accept the Terms and Privacy Notice",
    exact: true,
  });
  await page.locator("label").filter({ has: terms }).click();
  await expect(terms).toBeChecked();
  await accept.click();
  await expect(
    page
      .getByText("Current documents accepted in this sample. No acceptance was sent to a server.", {
        exact: true,
      })
      .last(),
  ).toBeVisible();
  await expect(accept).toBeDisabled();
  await page.getByRole("link", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/profile$/);
});

test("destructive data choices explain consequences, focus the safe action, and require confirmation", async ({
  page,
}) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Session name (optional)", { exact: true }).fill("My changed sample");
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await page.goto("/preview/data-controls");
  await expect(
    page.getByRole("button", { name: "Review source deletion", exact: true }),
  ).toBeDisabled();
  const original = page.getByRole("radio", { name: /^Delete original, keep notes/ });
  await page.locator("label").filter({ has: original }).click();
  await expect(original).toBeChecked();
  await page.getByRole("button", { name: "Review source deletion", exact: true }).click();
  const source = page.getByRole("alertdialog", { name: "Remove this sample source?" });
  await expect(source).toContainText("Keep the notes and cards");
  await expect(source.getByRole("button", { name: "Keep my data", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(source).not.toBeVisible();

  const review = page.getByRole("button", { name: "Review deletion", exact: true });
  await expect(review).toBeDisabled();
  const acknowledge = page.getByRole("checkbox", {
    name: "I understand the sample changes will be removed.",
    exact: true,
  });
  await page.locator("label").filter({ has: acknowledge }).click();
  await expect(acknowledge).toBeChecked();
  await review.click();
  const deletion = page.getByRole("alertdialog", { name: "Reset this sample workspace?" });
  await expect(deletion.getByRole("button", { name: "Keep my data", exact: true })).toBeFocused();
  await deletion.getByRole("button", { name: "Keep my data", exact: true }).click();
  await expect(review).toBeFocused();
  await review.click();
  await deletion.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await page.goto("/preview/classes");
  await expect(page.getByRole("heading", { name: "My changed sample", exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Course", { exact: true }).selectOption("ESOL B1");
  await expect(
    page.locator("section[aria-label='Session list'] > ul > li").first().locator("summary"),
  ).toContainText("Present perfect");
});
