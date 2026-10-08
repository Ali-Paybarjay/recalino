import { expect, STORAGE_KEY, test } from "./helpers";

test("sample files accumulate before explicit upload and show progress and completion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/preview/new-class");
  await page.getByLabel("Class name (optional)", { exact: true }).fill("Upload progress sample");
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.goto("/preview/upload");
  await expect(page.getByRole("button", { name: "Add Files", exact: true })).toBeEnabled();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));

  const files = page.getByLabel("Add sample file names", { exact: true });
  const submit = page.getByRole("button", { name: /^(Upload & Process|Uploading…)$/ });
  const sourcePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Your sources", exact: true }),
  });
  await expect(submit).toBeDisabled();
  await files.setInputFiles({
    name: "first-handout.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("sample"),
  });
  await files.setInputFiles({
    name: "second-board.png",
    mimeType: "image/png",
    buffer: Buffer.from("sample"),
  });
  await expect(page.getByText("first-handout.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("second-board.png", { exact: true })).toBeVisible();
  await expect(sourcePanel.getByRole("listitem")).toHaveCount(0);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").sources,
      STORAGE_KEY,
    ),
  ).toEqual([]);
  await expect(submit).toBeEnabled();
  const progress = page.getByRole("progressbar", {
    name: "Upload demonstration progress",
    exact: true,
  });
  const first = sourcePanel.getByRole("listitem").filter({ hasText: "first-handout.pdf" });
  const second = sourcePanel.getByRole("listitem").filter({ hasText: "second-board.png" });
  await expect(progress).toHaveCount(0);
  await page.clock.runFor(1_000);
  await expect(sourcePanel.getByRole("listitem")).toHaveCount(0);
  await submit.click();
  await expect(progress).toBeVisible();
  await expect(progress).toBeInViewport();
  await expect(
    page.getByText("Upload demonstration · 0 of 2 files added", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Simulated progress; no file bytes are uploaded/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add More Files", exact: true })).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);

  await page.clock.runFor(1_000);
  await expect(first).toBeVisible();
  await expect(first.getByText("first-handout.pdf", { exact: true })).toBeInViewport();
  await expect(second).toHaveCount(0);
  await expect(progress).toHaveAttribute("value", "50");
  await expect(
    page.getByText("Upload demonstration · 1 of 2 files added", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add More Files", exact: true })).toBeDisabled();

  await page.clock.runFor(1_000);
  await expect(second).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add More Files", exact: true })).toBeEnabled();
  await expect(page.getByText(/Sample upload successful/)).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add More Files", exact: true }).click();
  await (await chooser).setFiles({
    name: "third-recording.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("sample"),
  });
  await expect(progress).toHaveCount(0);
  await expect(sourcePanel.getByText("third-recording.wav", { exact: true })).toHaveCount(0);
  await submit.click();
  await expect(progress).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(
    sourcePanel.getByRole("listitem").filter({ hasText: "third-recording.wav" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add More Files", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add More Files", exact: true })).toBeEnabled();
  await expect(page.getByText("third-recording.wav", { exact: true })).toBeVisible();
});

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
  await page.getByRole("button", { name: "Upload & Process", exact: true }).click();
  await expect(page.getByText(/Sample upload successful/)).toBeVisible();
  await files.setInputFiles({
    name: "unsupported.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("sample"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "not a supported sample file" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload & Process", exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove selected file: unsupported.exe", exact: true })
    .click();
  await expect(page.getByText("unsupported.exe", { exact: true })).toHaveCount(0);

  await page.goto("/preview/source-settings");
  const addedPdf = page.locator("section").filter({
    has: page.getByRole("heading", { name: "lesson-handout.pdf", exact: true }),
  });
  await expect(addedPdf.getByRole("checkbox")).toBeChecked();
  await expect(addedPdf.getByRole("radio", { name: "Whole file", exact: true })).toBeChecked();
  await expect(addedPdf.getByRole("spinbutton")).toHaveCount(0);
  await expect(addedPdf).toContainText("4 sample pages in this file");
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
  await expect(page.getByLabel("Source role", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Class recording", exact: true }) });
  const pdf = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Present perfect handout.pdf", exact: true }),
  });
  await audio.getByRole("radio", { name: "Part of file", exact: true }).check();
  await page.reload();
  await expect(audio.getByRole("radio", { name: "Part of file", exact: true })).toBeChecked();
  await pdf.getByRole("radio", { name: "Part of file", exact: true }).check();
  await page.getByLabel("Start minute", { exact: true }).fill("10");
  await page.getByLabel("End minute", { exact: true }).fill("20");
  await page.getByLabel("First page", { exact: true }).fill("2");
  await page.getByLabel("Last page", { exact: true }).fill("3");
  const photo = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Whiteboard photo", exact: true }) });
  await photo.getByRole("checkbox").uncheck();
  await audio.getByRole("button", { name: "Reuse this source", exact: true }).click();
  await page.getByRole("link", { name: "Continue to estimate", exact: true }).click();
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

test("whole file restores the full estimate and hides range fields after a part was chosen", async ({
  page,
}) => {
  await page.goto("/preview/source-settings");
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Class recording", exact: true }) });
  const pdf = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Present perfect handout.pdf", exact: true }),
  });
  await audio.getByRole("radio", { name: "Part of file", exact: true }).check();
  await audio.getByLabel("Start minute", { exact: true }).fill("10");
  await audio.getByLabel("End minute", { exact: true }).fill("20");
  await pdf.getByRole("radio", { name: "Part of file", exact: true }).check();
  await pdf.getByLabel("First page", { exact: true }).fill("2");
  await pdf.getByLabel("Last page", { exact: true }).fill("3");
  await audio.getByRole("radio", { name: "Whole file", exact: true }).check();
  await pdf.getByRole("radio", { name: "Whole file", exact: true }).check();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await page.reload();
  await expect(audio.getByRole("radio", { name: "Whole file", exact: true })).toBeChecked();
  await expect(pdf.getByRole("radio", { name: "Whole file", exact: true })).toBeChecked();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await page.getByRole("link", { name: "Continue to estimate", exact: true }).click();
  await expect(page.getByText("48 audio minutes", { exact: true })).toBeVisible();
  await expect(page.getByText("5 pages / photos", { exact: true })).toBeVisible();
});

test("an allowance shortfall can be reduced explicitly without exceeding the sample limit", async ({
  page,
}) => {
  await page.goto("/preview/estimate");
  await page.getByRole("button", { name: "Try insufficient allowance", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "exceeds the available sample allowance" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/shortfall$/);
  await page.getByRole("link", { name: "Choose sources or file portions", exact: true }).click();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Class recording", exact: true }) });
  const pdf = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Present perfect handout.pdf", exact: true }),
  });
  const photo = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Whiteboard photo", exact: true }) });
  await audio.getByRole("radio", { name: "Part of file", exact: true }).check();
  await audio.getByLabel("End minute", { exact: true }).fill("10");
  await pdf.getByRole("radio", { name: "Part of file", exact: true }).check();
  await pdf.getByLabel("Last page", { exact: true }).fill("3");
  await photo.getByRole("checkbox").uncheck();
  await page.getByRole("link", { name: "Continue to estimate", exact: true }).click();
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recording your class");
  expect(seconds((await timer.textContent()) ?? "00:00")).toBeGreaterThanOrEqual(paused);
  await expect(page.getByText("1 sample photos", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Stop", exact: true }).click();
  const confirmationClock = page.getByText(/^\d+:\d{2} · sample recording$/);
  await expect(confirmationClock).toBeVisible();
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

test("demo uploads receive prepared extents automatically and a job keeps its confirmed inputs", async ({
  page,
}) => {
  await page.goto("/preview/new-class");
  await page.getByLabel("Class name (optional)", { exact: true }).fill("Automatic sample metadata");
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
  await page.getByRole("button", { name: "Upload & Process", exact: true }).click();
  await expect(page.getByText(/Sample upload successful/)).toBeVisible();
  await expect(page.getByText("my-lesson.wav", { exact: true })).toBeVisible();
  await expect(page.getByText("my-handout.pdf", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Upload demonstration progress", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Needs details", { exact: true })).toHaveCount(0);
  await page.goto("/preview/estimate");
  await expect(
    page.getByRole("button", { name: "Process selected sources", exact: true }),
  ).toBeEnabled();
  await page.goto("/preview/source-settings");
  const audio = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "my-lesson.wav", exact: true }) });
  const pdf = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "my-handout.pdf", exact: true }) });
  await expect(audio.getByRole("checkbox")).toBeChecked();
  await expect(pdf.getByRole("checkbox")).toBeChecked();
  await expect(audio.getByRole("radio", { name: "Whole file", exact: true })).toBeChecked();
  await expect(pdf.getByRole("radio", { name: "Whole file", exact: true })).toBeChecked();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByLabel("Source role", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/does not classify or measure uploaded contents/)).toBeVisible();
  await page.getByRole("link", { name: "Continue to estimate", exact: true }).click();
  await expect(page.getByText("10 audio minutes", { exact: true })).toBeVisible();
  await expect(page.getByText("4 pages / photos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Process selected sources", exact: true }).click();
  await page.getByRole("button", { name: "Try a partial result", exact: true }).click();
  const confirmed = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Confirmed job inputs", exact: true }) });
  const originalInputs = await confirmed.innerText();
  await page.goto("/preview/source-settings");
  await audio.getByRole("radio", { name: "Part of file", exact: true }).check();
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
