import { expect, test } from "@playwright/test";

// FR-PLT-010: the web app manifest and the app icons from design round 2.

test("the manifest names the app, uses the theme colours and lists the icons", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await request.get(href ?? "");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Recalino",
    short_name: "Recalino",
    display: "standalone",
    start_url: "/",
    background_color: "#f6f7f2",
    theme_color: "#f6f7f2",
  });
  expect(
    manifest.icons.map(
      (icon: { purpose: string; sizes: string }) => `${icon.purpose} ${icon.sizes}`,
    ),
  ).toEqual(["any 192x192", "any 512x512", "maskable 192x192", "maskable 512x512"]);
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()["content-type"]).toBe("image/png");
  }
});

test("the page links the favicon and the Apple touch icon", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    "href",
    "/icons/favicon.svg",
  );
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(apple).toBe("/icons/apple-touch-icon.png");
  expect((await request.get(apple ?? "")).ok()).toBe(true);
});
