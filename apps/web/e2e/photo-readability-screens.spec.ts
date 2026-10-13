import { expect, type Page, test } from "@playwright/test";

/**
 * Evidence screenshots for D72 (artifacts/verification/feat-photo-readability): a photo row in
 * each verdict and the zoom sheet, at 390 and 1440 px, from synthetic boards drawn on a canvas.
 * Runs only when RECALINO_SCREENSHOTS=1, so the default e2e run stays as it was.
 */
test.skip(!process.env.RECALINO_SCREENSHOTS, "Screenshots only on request");
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const OUT = "../../artifacts/verification/feat-photo-readability";
const CASES = ["ok", "blurry", "too_dark", "too_bright", "glare", "low_detail"] as const;

/** Board photos need the material notice; accept it the way the page does. */
async function acceptMaterialNotice(page: Page) {
  const contract = await page.request.get("/api/sources/contract");
  const { contract: value } = (await contract.json()) as { contract: { noticeVersion: string } };
  const accepted = await page.request.post("/api/sources/notice", {
    data: { version: value.noticeVersion, confirmed: true },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
}

async function board(page: Page, kind: (typeof CASES)[number]) {
  const dataUrl = await page.evaluate((kind) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#dadde2";
    context.fillRect(0, 0, 800, 600);
    if (kind !== "low_detail") {
      if (kind === "blurry") context.filter = "blur(4px)";
      context.fillStyle = "#1e2d78";
      context.font = "bold 40px sans-serif";
      context.fillText("Present perfect", 40, 70);
      context.font = "16px sans-serif";
      for (let line = 0; line < 12; line++)
        context.fillText(
          "I have lived here since 2019 · She has never been to Rome",
          40,
          120 + line * 38,
        );
      context.filter = "none";
    }
    if (kind === "too_dark") {
      context.fillStyle = "rgb(0 0 0 / 82%)";
      context.fillRect(0, 0, 800, 600);
    }
    if (kind === "too_bright") {
      context.globalCompositeOperation = "lighter";
      context.fillStyle = "rgb(160 160 160)";
      context.fillRect(0, 0, 800, 600);
    }
    if (kind === "glare") {
      const light = context.createRadialGradient(470, 210, 90, 470, 210, 130);
      light.addColorStop(0, "rgb(255 255 255)");
      light.addColorStop(1, "rgb(255 255 255 / 0%)");
      context.fillStyle = light;
      context.fillRect(0, 0, 800, 600);
    }
    return canvas.toDataURL("image/png");
  }, kind);
  return Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
}

test("captures the photo rows and the zoom sheet at 390 and 1440 px", async ({ page }) => {
  test.setTimeout(180000);
  const signIn = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(signIn.status()).toBe(200);
  const scores: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/recordings/diagnostics")) return;
    const body = request.postDataJSON() as { events: { event: { type: string } }[] };
    for (const { event } of body.events) if (event.type === "photo_quality") scores.push(event);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await acceptMaterialNotice(page);
  await page.goto("/recordings");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  const add = page.getByRole("button", { name: "Add board photo", exact: true });
  await expect(add).toBeEnabled();
  // Chromium's "mid-tier mobile" CPU (4× slowdown) while the photos are judged.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (const kind of CASES) {
    const chooser = page.waitForEvent("filechooser");
    await add.click();
    await (await chooser).setFiles({
      name: `${kind}.png`,
      mimeType: "image/png",
      buffer: await board(page, kind),
    });
  }
  const figures = page.locator("figure");
  await expect(figures).toHaveCount(CASES.length);
  const expected = {
    ok: "Looks sharp",
    blurry: "May be hard to read: blurry. Retake?",
    too_dark: "May be hard to read: too dark. Retake?",
    too_bright: "May be hard to read: washed out. Retake?",
    glare: "May be hard to read: glare on the board. Retake?",
    low_detail: "Hard to see writing in this photo. Move closer or retake?",
  };
  for (const [index, kind] of CASES.entries())
    await expect(figures.nth(index).getByText(expected[kind], { exact: true })).toBeVisible();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [index, kind] of CASES.entries())
      await figures.nth(index).screenshot({ path: `${OUT}/photo-row-${kind}-${width}.png` });
    await page.screenshot({ path: `${OUT}/capture-${width}.png`, fullPage: true });
    await figures
      .nth(1)
      .getByRole("button", { name: /^Board captured around/ })
      .click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.screenshot({ path: `${OUT}/zoom-sheet-${width}.png` });
    await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
    // Owner decision 2026-10-13: removing a photo that exists only on this device asks first.
    await figures.nth(1).getByRole("button", { name: "Remove this photo", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.screenshot({ path: `${OUT}/photo-remove-confirm-${width}.png` });
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep", exact: true }).click();
  }

  const durations = await page.evaluate(() =>
    performance
      .getEntriesByType("measure")
      .filter((entry) => entry.name.startsWith("recalino:photo-quality"))
      .map((entry) => `${entry.name}=${Math.round(entry.duration)}`),
  );
  console.log(`photo-quality ms at 4x CPU slowdown: ${durations.join(" ")}`);
  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  // Stop flushes the diagnostics batch; the scores calibrate the thresholds on browser images.
  await expect.poll(() => scores.length, { timeout: 20000 }).toBe(CASES.length);
  console.log(`photo_quality diagnostics: ${JSON.stringify(scores)}`);
});
