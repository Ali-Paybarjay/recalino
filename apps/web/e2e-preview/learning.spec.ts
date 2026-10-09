import { readFile } from "node:fs/promises";
import { expect, test, VIEWPORTS } from "./helpers";

test("phone notes put the lesson before navigation and tools", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/preview/notes");
  const lesson = await page
    .getByRole("heading", { name: "In this class", exact: true })
    .boundingBox();
  const tools = await page
    .getByRole("heading", { name: "Keep learning", exact: true })
    .boundingBox();
  expect(lesson).not.toBeNull();
  expect(tools).not.toBeNull();
  expect(lesson?.y ?? Infinity).toBeLessThan(tools?.y ?? 0);
});

test("the six approved card formats have usable answer controls", async ({ page }) => {
  await page.goto("/preview/card-types");
  for (const name of [
    "Question and answer",
    "Vocabulary",
    "Cloze · fill the gap",
    "Grammar point",
    "Error correction",
    "Listening",
  ]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  const answers = page.getByRole("button", { name: "Show answer", exact: true });
  await expect(answers).toHaveCount(5);
  await answers.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide answer", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const listening = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Listen and complete the sentence.", exact: true }),
  });
  await listening.getByRole("button", { name: "Show written example", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(listening.getByText("I have already finished.", { exact: true })).toBeVisible();
});

test("edited notes keep provenance and earlier versions, and export literal user text safely", async ({
  page,
}) => {
  await page.goto("/preview/notes");
  await page.getByRole("link", { name: "Edit notes", exact: true }).click();
  const edited = "I have already caught the bus. <script>window.previewInjected = true</script>";
  await page.getByRole("textbox", { name: "Your explanation", exact: true }).fill(edited);
  await page.getByRole("button", { name: "Save a new version", exact: true }).click();
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  await expect(page.getByText("Edited by you · sample version", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Audio 18:42/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Compare versions", exact: true }).click();
  await expect(page.getByText("Version 2 · Edited by you", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 1 · Original sample notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore as a new version", exact: true }).click();
  await expect(page.getByText("Version 3 · Restored version 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 2 · Edited by you", { exact: true })).toBeVisible();

  await page.goto("/preview/edit-notes");
  await page.getByRole("textbox", { name: "Your explanation", exact: true }).fill(edited);
  await page.getByRole("button", { name: "Save a new version", exact: true }).click();
  await page.getByRole("link", { name: "Export notes", exact: true }).click();
  await page.getByRole("checkbox", { name: "AI explanations · sample", exact: true }).uncheck();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sample HTML", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("recalino-sample-notes.html");
  const path = await download.path();
  expect(path).not.toBeNull();
  const html = await readFile(path ?? "", "utf8");
  expect(html).toContain("&lt;script&gt;window.previewInjected = true&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<h2>AI explanation");
  expect(html).toContain("Class audio, 18:42.");
});

test("transcript correction keeps existing notes until a proposal is accepted", async ({
  page,
}) => {
  await page.goto("/preview/transcript");
  await page
    .getByRole("combobox", { name: "First speaker role", exact: true })
    .selectOption("Teacher");
  await page
    .getByRole("textbox", { name: "Transcript text", exact: true })
    .fill("Teacher: We have already arrived.");
  await page.getByRole("button", { name: "Save corrections", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sample transcript corrections saved." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Transcript text", exact: true })).toHaveValue(
    "Teacher: We have already arrived.",
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Transcript text", exact: true })).toHaveValue(
    "Teacher: We have already arrived.",
  );
  await page.getByRole("link", { name: "Compare sample note update", exact: true }).click();
  await expect(page.getByText("Version 1 · Original sample notes", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Show a sample regeneration proposal", exact: true })
    .click();
  await page.getByRole("link", { name: "Keep current notes", exact: true }).click();
  await expect(page.getByText("From class · sample", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Edited by you · sample version", { exact: true })).toHaveCount(0);
});

test("simple review retries one unsaved answer and preserves exactly four answers after refresh", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/preview/review");
  await page
    .getByRole("checkbox", { name: "Include up to 2 approved new cards", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(
    page
      .getByRole("article")
      .getByText("Something happened earlier than expected.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Demonstrate a save problem on the next answer", exact: true })
    .check();
  await page.getByRole("button", { name: "Remembered", exact: true }).dblclick();
  await expect(
    page.getByRole("alert").filter({ hasText: "This sample answer is not saved" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "This sample answer is not saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry sample save", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/review-card$/);
  await expect(page.getByText("Card 2 of 4 · Sample review", { exact: true })).toBeVisible();

  for (const rating of ["Forgot", "Remembered", "Remembered"]) {
    await page.getByRole("button", { name: "Show answer", exact: true }).click();
    await page.getByRole("button", { name: rating, exact: true }).click();
    await expect(page).toHaveURL(/\/preview\/(?:review-card|review-summary)$/);
  }
  await expect(page).toHaveURL(/\/preview\/review-summary$/);
  await expect(page.getByText("Answers saved", { exact: true }).locator("..")).toContainText("4");
  await expect(page.getByText("Remembered", { exact: true }).locator("..")).toContainText("3");
  await expect(page.getByText("To practise again", { exact: true }).locator("..")).toContainText(
    "1",
  );
  await page.reload();
  await expect(page.getByText("Answers saved", { exact: true }).locator("..")).toContainText("4");
  await page.getByRole("link", { name: "View progress", exact: true }).click();
  await expect(page.getByText("Sample answers saved", { exact: true }).locator("..")).toContainText(
    "4",
  );
  await expect(
    page.getByText("Different cards practised", { exact: true }).locator(".."),
  ).toContainText("4");
});

test("advanced review explains Hard, supports keyboard use and reports remembered answers correctly", async ({
  page,
}) => {
  await page.goto("/preview/review");
  await page
    .getByRole("radio", { name: "Advanced · Again / Hard / Good / Easy", exact: true })
    .check();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  const show = page.getByRole("button", { name: "Show answer", exact: true });
  await show.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "Hard means you remembered, but with difficulty. Again means you did not remember.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Forgot", exact: true })).toHaveCount(0);
  const hard = page.getByRole("button", { name: "Hard", exact: true });
  await hard.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/preview\/review-card$/);
  await page.getByRole("link", { name: "End for now", exact: true }).click();
  await expect(page.getByText("Answers saved", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByText("Remembered", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByText("To practise again", { exact: true }).locator("..")).toContainText(
    "0",
  );
});
