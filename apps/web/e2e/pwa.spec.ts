import { expect, test } from "@playwright/test";

// FR-PLT-010 (part): the web app manifest. The app becomes installable when the icons from design
// round 2 are added.

test("the manifest names the app and uses the theme colours", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await request.get(href ?? "");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    name: "Recalino",
    short_name: "Recalino",
    display: "standalone",
    start_url: "/",
    background_color: "#eef9f3",
    theme_color: "#eef9f3",
  });
});
