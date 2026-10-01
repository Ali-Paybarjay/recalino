import { expect, type Page, test } from "@playwright/test";

// FR-PLT-010 (part): the web app manifest and the app icons of HANDOFF §5c, which make the app
// installable.

async function manifestHref(page: Page): Promise<string> {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  return href ?? "";
}

test("the manifest names the app and uses the theme colours", async ({ page, request }) => {
  const response = await request.get(await manifestHref(page));
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

test("the install icons load at their declared sizes", async ({ page, request }) => {
  const response = await request.get(await manifestHref(page));
  const { icons } = (await response.json()) as {
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(icons.map((icon) => `${icon.purpose} ${icon.sizes}`).sort()).toEqual([
    "any 192x192",
    "any 512x512",
    "maskable 192x192",
    "maskable 512x512",
  ]);
  for (const icon of icons) {
    const file = await request.get(icon.src);
    expect(file.ok()).toBe(true);
    expect(file.headers()["content-type"]).toBe("image/png");
    // A PNG's width and height are the first two fields of its IHDR chunk.
    const png = await file.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
});

test("the page links the favicon and the Apple touch icon", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.sort()).toEqual([
    "/icons/apple-touch-icon.png",
    "/icons/favicon-32.png",
    "/icons/favicon.svg",
  ]);
  for (const href of hrefs) {
    expect((await request.get(href)).ok()).toBe(true);
  }
});
