import { expect, type Page, test } from "@playwright/test";

/**
 * D72 layers 1 and 2: an on-device readability line under each board photo, a Retake that adds a
 * photo and keeps the first, and a full-size zoom sheet. Synthetic boards drawn on a page canvas
 * (G11); nothing about the photo leaves the device except integer scores in diagnostics.
 */
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

/** Board photos need the material notice; accept it the way the page does. */
async function acceptMaterialNotice(page: Page) {
  const contract = await page.request.get("/api/sources/contract");
  const { contract: value } = (await contract.json()) as { contract: { noticeVersion: string } };
  const accepted = await page.request.post("/api/sources/notice", {
    data: { version: value.noticeVersion, confirmed: true },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
}

async function board(page: Page, blur: number) {
  const dataUrl = await page.evaluate((blur) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    const sharp = document.createElement("canvas");
    sharp.width = 800;
    sharp.height = 600;
    const draw = sharp.getContext("2d");
    if (!draw) throw new Error("No canvas");
    draw.fillStyle = "#dadde2";
    draw.fillRect(0, 0, 800, 600);
    draw.fillStyle = "#1e2d78";
    draw.font = "bold 40px sans-serif";
    draw.fillText("Present perfect", 40, 70);
    draw.font = "16px sans-serif";
    for (let line = 0; line < 12; line++)
      draw.fillText(
        "I have lived here since 2019 · She has never been to Rome",
        40,
        120 + line * 38,
      );
    context.filter = blur ? `blur(${blur}px)` : "none";
    context.drawImage(sharp, 0, 0);
    return canvas.toDataURL("image/png");
  }, blur);
  return Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
}

async function addPhoto(page: Page, trigger: () => Promise<void>, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await trigger();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer });
}

test("judges board photos on the device, keeps every photo and zooms without interrupting capture", async ({
  page,
}) => {
  test.setTimeout(120000);
  const signIn = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(signIn.status(), await signIn.text()).toBe(200);
  const diagnostics: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/recordings/diagnostics"))
      diagnostics.push(request.postDataJSON());
  });
  await acceptMaterialNotice(page);
  await page.goto("/recordings");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  // D107: once its session exists, the page becomes the session's recording page (client
  // navigation; the capture goes on).
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  const addPhotoButton = page.getByRole("button", { name: "Add board photo", exact: true });
  await expect(addPhotoButton).toBeEnabled();

  const sharp = await board(page, 0);
  const blurred = await board(page, 4);
  await addPhoto(page, () => addPhotoButton.click(), "sharp.png", sharp);
  await addPhoto(page, () => addPhotoButton.click(), "blurred.png", blurred);
  // During capture the recording's photos are in one gallery (D107), not one per part.
  await expect(page.getByText("2 board photos saved on this device")).toBeVisible();
  await expect(page.getByText("Looks sharp", { exact: true })).toBeVisible();
  await expect(
    page.getByText("May be hard to read: blurry. Retake?", { exact: true }),
  ).toBeVisible();
  // PRD-REC-02: the verdict lives in the photo row only; nothing pops up during capture.
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // Next.js keeps an empty route announcer with role="alert"; any alert with text is a failure.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();

  // The view reloads after every saved audio chunk (2 s); the photos must not reload with it.
  const thumbnail = page.getByRole("img", { name: /^Board captured around/ }).first();
  const source = await thumbnail.getAttribute("src");
  await page.waitForTimeout(5000);
  await expect(thumbnail).toHaveAttribute("src", source ?? "");

  // Layer 2: the full-size photo opens only when the learner taps it.
  await page
    .getByRole("button", { name: /^Board captured around/ })
    .last()
    .click();
  const sheet = page.locator("dialog[open]");
  await expect(
    sheet.getByText(
      "Can you read the smallest writing? If not, retake while the board is still there.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sheet.locator("img")).toHaveJSProperty("naturalWidth", 800);
  await expect(sheet.getByRole("button", { name: "Remove this photo", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Retake adds a photo and keeps the blurry one (PRD-CORE-05).
  await addPhoto(
    page,
    () => page.getByRole("button", { name: "Retake", exact: true }).click(),
    "retake.png",
    sharp,
  );
  await expect(page.getByText("3 board photos saved on this device")).toBeVisible();
  await expect(page.getByText("Looks sharp", { exact: true })).toHaveCount(2);
  await expect(page.getByText("May be hard to read: blurry. Retake?", { exact: true })).toHaveCount(
    1,
  );

  // Owner decision 2026-10-13: a photo that exists only on this device can be removed after a
  // confirmation; Keep leaves it, and recording carries on.
  const blurryRow = page
    .locator("figure")
    .filter({ hasText: "May be hard to read: blurry. Retake?" });
  await blurryRow.getByRole("button", { name: "Remove this photo", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(
    confirm.getByText("Remove this photo from this device?", { exact: true }),
  ).toBeVisible();
  await expect(confirm.getByText("It has not been uploaded.", { exact: true })).toBeVisible();
  await confirm.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByText("3 board photos saved on this device")).toBeVisible();
  await blurryRow.getByRole("button", { name: "Remove this photo", exact: true }).click();
  await confirm.getByRole("button", { name: "Remove this photo", exact: true }).click();
  await expect(page.getByText("2 board photos saved on this device")).toBeVisible();
  await expect(page.getByText("May be hard to read: blurry. Retake?", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Looks sharp", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  // The panel title and the part's line both say so (D107).
  await expect(page.getByText("Saved on this device", { exact: true }).first()).toBeVisible();
  // After Stop the same photos are in the one gallery under the recorded parts.
  await expect(page.getByText("Looks sharp", { exact: true })).toHaveCount(2);
  await expect(page.getByText("May be hard to read: blurry. Retake?", { exact: true })).toHaveCount(
    0,
  );

  // Diagnostics carry integer scores and the verdict, never pixels. The removed photo's verdict
  // is withdrawn if it was still waiting for its batch (unit-tested); the kept ones arrive.
  await expect
    .poll(
      () =>
        diagnostics
          .flatMap(
            (body) => (body as { events: { event: { type: string; verdict?: string } }[] }).events,
          )
          .filter((item) => item.event.type === "photo_quality" && item.event.verdict === "ok")
          .length,
      { timeout: 70000 },
    )
    .toBe(2);
  expect(JSON.stringify(diagnostics)).not.toContain("data:image");
});
