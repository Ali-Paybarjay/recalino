import { expect, STORAGE_KEY, test } from "./helpers";

test("source permission, file metadata and password examples stay local", async ({ page }) => {
  await page.goto("/preview/first-upload");
  await expect(page.getByRole("button", { name: "Continue to sources" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I have the right to use the material I add." }).check();
  await page.getByRole("button", { name: "Continue to sources" }).click();
  const files = page.getByLabel("Add sample file names", { exact: true });
  await files.setInputFiles({
    name: "lesson-handout.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Synthetic file metadata test; not a real document."),
  });
  await expect(page.getByText("lesson-handout.pdf", { exact: true })).toBeVisible();
  await expect(
    page.getByText("File names added to this sample. File bytes have not been uploaded."),
  ).toBeVisible();
  await files.setInputFiles({
    name: "unsupported.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("sample"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "not a supported sample file" }),
  ).toBeVisible();

  await page.goto("/preview/source-settings");
  const addedPdf = page.locator("section").filter({
    has: page.getByRole("heading", { name: "lesson-handout.pdf", exact: true }),
  });
  await addedPdf.getByLabel("Sample page count", { exact: true }).fill("1");
  await addedPdf.getByRole("button", { name: "Confirm sample details", exact: true }).click();
  await page.goto("/preview/upload");

  await page.getByRole("button", { name: "Try protected PDF", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue sample password step" })).toBeDisabled();
  const samplePassword = "preview-password-not-persisted";
  await page.getByLabel("PDF password").fill(samplePassword);
  await page.getByRole("button", { name: "Continue sample password step" }).click();
  await expect(page.getByLabel("PDF password")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).not.toContain(
    samplePassword,
  );

  const audio = page.getByRole("listitem").filter({ hasText: "Class recording" });
  await audio.getByRole("button", { name: "Pause upload example" }).click();
  await page.goto("/preview/estimate");
  await expect(
    page.getByRole("button", { name: "Process selected sources", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "selected source needs attention" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Resolve source issues" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Class recording" })
    .getByRole("button", { name: "Resume upload example" })
    .click();
  await page.goto("/preview/estimate");
  await expect(
    page.getByRole("button", { name: "Process selected sources", exact: true }),
  ).toBeEnabled();
});

test("selected ranges determine the estimate, processing deducts once, and a retry is free", async ({
  page,
}) => {
  await page.goto("/preview/source-settings");
  await page.getByLabel("Start minute", { exact: true }).fill("10");
  await page.getByLabel("End minute", { exact: true }).fill("20");
  await page.getByLabel("First page", { exact: true }).fill("2");
  await page.getByLabel("Last page", { exact: true }).fill("3");
  const photo = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Whiteboard photo", exact: true }) });
  await photo.getByRole("checkbox").uncheck();
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Class recording", exact: true }) });
  await audio.getByRole("button", { name: "Reuse this source", exact: true }).click();
  await page.getByRole("link", { name: "Save source choices", exact: true }).click();
  await expect(page.getByText("10 audio minutes", { exact: true })).toBeVisible();
  await expect(page.getByText("2 pages / photos", { exact: true })).toBeVisible();
  await expect(page.getByText("60 audio minutes available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/processing$/);
  await page.goto("/preview/estimate");
  await expect(page.getByText("50 audio minutes available", { exact: true })).toBeVisible();
  await expect(page.getByText("18 pages / photos available", { exact: true })).toBeVisible();

  await page.goto("/preview/processing");
  await page.getByRole("button", { name: "Try a partial result", exact: true }).click();
  await expect(
    page.getByText("Needs retry · this source is excluded from the partial notes"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Read partial notes", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The sample job is partly ready." }),
  ).toContainText("Class recording needs another try.");
  await page.goto("/preview/processing-result");
  await page.getByRole("button", { name: "Retry failed source", exact: true }).click();
  await page.getByRole("button", { name: "Complete sample processing", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/notes$/);
  await expect(page.getByText("AI explanation · sample", { exact: true })).toBeVisible();
  await page.goto("/preview/estimate");
  await expect(page.getByText("50 audio minutes available", { exact: true })).toBeVisible();
  await expect(page.getByText("18 pages / photos available", { exact: true })).toBeVisible();
});

test("an allowance shortfall can be reduced to a useful part without exceeding the sample limit", async ({
  page,
}) => {
  await page.goto("/preview/estimate");
  await page.getByRole("button", { name: "Try insufficient allowance", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "exceeds the available sample allowance" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/shortfall$/);
  await page.getByRole("button", { name: "Choose an available part", exact: true }).click();
  await expect(page.getByText("10 audio minutes", { exact: true })).toBeVisible();
  await expect(page.getByText("3 pages / photos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await page.goto("/preview/estimate");
  await expect(page.getByText("0 audio minutes available", { exact: true })).toBeVisible();
  await expect(page.getByText("0 pages / photos available", { exact: true })).toBeVisible();
});

test("recording controls demonstrate photo, pause, resume and save without capturing media", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/preview/microphone");
  await page.getByRole("button", { name: "Start recording demonstration", exact: true }).click();
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await expect(page.getByText("1 sample photos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recording paused");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("link", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Stop and keep recording", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your recording is ready");
  await page.getByRole("link", { name: "Go to class", exact: true }).click();
  await expect(page.getByText("Sample recording", { exact: true })).toBeVisible();
});

test("recording elapsed time and photos survive pause, resume and stop confirmation", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/preview/microphone");
  await page.getByRole("button", { name: "Start recording demonstration", exact: true }).click();
  const timer = page.locator(".preview-timer");
  const seconds = (text: string) => {
    const [minutes, remainder] = text.split(":").map(Number);
    return (minutes ?? 0) * 60 + (remainder ?? 0);
  };
  const started = seconds((await timer.textContent()) ?? "00:00");
  await page.clock.runFor(65_000);
  await expect
    .poll(async () => seconds((await timer.textContent()) ?? "00:00"))
    .toBeGreaterThanOrEqual(started + 65);
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = seconds((await timer.textContent()) ?? "00:00");
  await page.clock.runFor(120_000);
  expect(seconds((await timer.textContent()) ?? "00:00")).toBe(paused);
  await expect(page.getByText("1 sample photos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  expect(seconds((await timer.textContent()) ?? "00:00")).toBeGreaterThanOrEqual(paused);
  await expect(page.getByText("1 sample photos", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Stop", exact: true }).click();
  const confirmationClock = page.getByText(/^\d+:\d{2} · sample recording$/);
  await page.clock.runFor(30_000);
  const confirmedSeconds = seconds(
    (await confirmationClock.textContent())?.split(" · ")[0] ?? "00:00",
  );
  expect(confirmedSeconds).toBeGreaterThanOrEqual(paused + 30);
  await page.getByRole("button", { name: "Stop and keep recording", exact: true }).click();
  await page.clock.runFor(1_000);
  await expect(page).toHaveURL(/\/preview\/saved$/);
  await page.getByRole("link", { name: "Go to class", exact: true }).click();
  const recording = page.getByRole("listitem").filter({ hasText: "Sample recording" });
  const savedMinutes = Number((await recording.innerText()).match(/([\d.]+) audio minutes/)?.[1]);
  expect(Number.isFinite(savedMinutes)).toBe(true);
  expect(Math.abs(savedMinutes * 60 - confirmedSeconds)).toBeLessThanOrEqual(1);
});

test("uploaded durations and pages require explicit confirmation and a job keeps its confirmed inputs", async ({
  page,
}) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Class name (optional)", { exact: true }).fill("Explicit metadata");
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.goto("/preview/upload");
  await page.getByLabel("Add sample file names", { exact: true }).setInputFiles([
    { name: "my-lesson.wav", mimeType: "audio/wav", buffer: Buffer.from("synthetic metadata") },
    {
      name: "my-handout.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic metadata"),
    },
  ]);
  await expect(page.getByText("Needs details", { exact: true })).toHaveCount(2);
  await page.goto("/preview/estimate");
  await expect(
    page.getByRole("button", { name: "Process selected sources", exact: true }),
  ).toBeDisabled();
  await page.goto("/preview/source-settings");
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "my-lesson.wav", exact: true }) });
  const pdf = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "my-handout.pdf", exact: true }) });
  await expect(audio.getByRole("checkbox")).toBeDisabled();
  await audio.getByLabel("Sample duration (minutes)", { exact: true }).fill("10");
  await audio.getByRole("button", { name: "Confirm sample details", exact: true }).click();
  await pdf.getByLabel("Sample page count", { exact: true }).fill("4");
  await pdf.getByRole("button", { name: "Confirm sample details", exact: true }).click();
  await audio.getByRole("checkbox").check();
  await pdf.getByRole("checkbox").check();
  await page.getByRole("link", { name: "Save source choices", exact: true }).click();
  await expect(page.getByText("10 audio minutes", { exact: true })).toBeVisible();
  await expect(page.getByText("4 pages / photos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await page.getByRole("button", { name: "Try a partial result", exact: true }).click();
  const confirmed = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Confirmed job inputs", exact: true }) });
  const originalInputs = await confirmed.innerText();
  await page.goto("/preview/source-settings");
  await audio.getByLabel("End minute", { exact: true }).fill("2");
  await pdf.getByRole("checkbox").uncheck();
  await page.goto("/preview/processing-result");
  await expect.poll(() => confirmed.innerText()).toBe(originalInputs);
  await page.getByRole("button", { name: "Retry failed source", exact: true }).click();
  await page.goto("/preview/processing-result");
  await expect(
    page.getByRole("button", { name: "Retry failed source", exact: true }),
  ).toBeDisabled();
  await expect(confirmed).toContainText("my-handout.pdf");
  await page.goto("/preview/estimate");
  await expect(page.getByText("50 audio minutes available", { exact: true })).toBeVisible();
  await expect(page.getByText("16 pages / photos available", { exact: true })).toBeVisible();
});
