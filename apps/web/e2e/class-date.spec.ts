import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

async function expectDayFirstDate(page: Page) {
  const date = page.getByLabel("Class date", { exact: true });
  const picker = page.locator('input[type="date"]');
  await expect(date).toHaveAttribute("type", "text");
  await expect(date).toHaveAccessibleDescription("Day / Month / Year");
  await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
  await expect(picker).toHaveAttribute("aria-hidden", "true");
  await expect(picker).toHaveAttribute("tabindex", "-1");
  const initialDate = await picker.inputValue();
  expect(initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(date).toHaveValue(initialDate.split("-").reverse().join("/"));
  await expect(page.getByRole("button", { name: "Choose class date", exact: true })).toBeVisible();
  return { date, picker };
}

for (const locale of ["en-US", "en-GB"]) {
  test.describe(`class date in ${locale}`, () => {
    test.use({ locale });

    test("preview uses day/month/year for text and native calendar changes", async ({ page }) => {
      await page.goto("/preview/new-class");
      const { date, picker } = await expectDayFirstDate(page);

      await date.fill("03/04/2026");
      await expect(picker).toHaveValue("2026-04-03");
      await expect(date).toHaveValue("03/04/2026");

      // The calendar button remains keyboard operable and calls the native picker.
      await picker.evaluate((element: HTMLInputElement) => {
        element.showPicker = () => {
          element.dataset.opened = "true";
        };
      });
      await page.getByRole("button", { name: "Choose class date", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(picker).toHaveAttribute("data-opened", "true");

      // Force bypasses the hidden input's pointer actionability, just as a native picker change does.
      await picker.fill("2026-12-05", { force: true });
      await expect(date).toHaveValue("05/12/2026");
      await expect(date).toBeFocused();
      await expectNoAxeViolations(page);

      for (const invalidDate of ["31/02/2026", "01/01/0000"]) {
        await date.fill(invalidDate);
        await expect(date).toHaveAttribute("aria-invalid", "true");
        expect(await date.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(
          false,
        );
        await page.getByRole("button", { name: "Create class", exact: true }).click();
        await expect(date).toBeFocused();
        await expect(page).toHaveURL(/\/preview\/new-class$/);
      }
    });
  });
}

test("class date is validated and saves the same ISO day through create and edit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/classes/new");
  const { date, picker } = await expectDayFirstDate(page);
  await page.getByLabel("Class name (optional)").fill("Day-first date regression");

  const createdRequests: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/classes" && request.method() === "POST") {
      createdRequests.push(request.postDataJSON());
    }
  });
  await date.fill("31/02/2026");
  expect(await date.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await expect(date).toBeFocused();
  await expect(page).toHaveURL(/\/classes\/new$/);
  const unchanged = await page.request.get("/api/classes");
  expect(unchanged.status()).toBe(200);
  expect((await unchanged.json()).total).toBe(0);
  expect(createdRequests).toEqual([]);

  await date.fill("03/04/2026");
  await expect(picker).toHaveValue("2026-04-03");
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/classes" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  const created = await createResponse;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({ classDate: "2026-04-03" });
  const saved = (await created.json()) as { id: string; classDate: string };
  expect(saved.classDate).toBe("2026-04-03");
  expect(createdRequests).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`/classes/${saved.id}$`));

  await page.goto(`/classes/${saved.id}/options`);
  await expect(date).toHaveValue("03/04/2026");
  await expect(picker).toHaveValue("2026-04-03");
  await picker.fill("2026-12-05", { force: true });
  await expect(date).toHaveValue("05/12/2026");
  const editResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/classes/${saved.id}` &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const edited = await editResponse;
  expect(edited.status()).toBe(200);
  expect(edited.request().postDataJSON()).toMatchObject({ classDate: "2026-12-05" });
  await expect(page).toHaveURL(new RegExp(`/classes/${saved.id}$`));

  const persisted = await page.request.get(`/api/classes/${saved.id}`);
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({ classDate: "2026-12-05" });
  await page.goto(`/classes/${saved.id}/options`);
  await expect(date).toHaveValue("05/12/2026");
  await expect(picker).toHaveValue("2026-12-05");
});
