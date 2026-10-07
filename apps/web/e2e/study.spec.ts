import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

// Chromium supports secure cookies on loopback HTTP; Playwright's Node request client does not.
// Exercise the same authenticated request path as the UI, including a local production build.
async function browserGet(page: Page, path: string) {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, path);
  return { status: () => result.status, json: async () => result.body };
}

test("automatic saved notes, edits, flashcards, review and undo use real owner APIs", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true, automaticStudyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { sessionId } = (await response.json()) as { sessionId: string };
  await page.goto(`/classes/${sessionId}/notes`);
  await expect(
    page.getByRole("heading", { name: "Synthetic notes for local testing" }),
  ).toBeVisible();
  await expect(
    page.getByText("This is local synthetic test content.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to class", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Make flashcards", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Version history", exact: true })).toHaveCount(0);
  const attribution = page.locator("details").first();
  await expect(attribution).toHaveJSProperty("open", false);
  await attribution.locator("summary").click();
  await expect(attribution.getByText("AI expansion", { exact: true })).toBeVisible();
  await attribution.locator("summary").click();
  const preview = await browserGet(page, `/api/classes/${sessionId}/notes`);
  expect(preview.status()).toBe(200);
  expect((await preview.json()).notebook.current.number).toBe(1);
  await expectNoAxeViolations(page);

  await expect(page.getByRole("button", { name: "Save notes", exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Note version 1 ·/)).toBeVisible();
  const beforePreparing = await browserGet(page, `/api/classes/${sessionId}/cards`);
  expect(beforePreparing.status()).toBe(200);
  expect((await beforePreparing.json()).cards[0].status).toBe("active");
  const noteTools = page.getByRole("navigation", { name: "Note tools", exact: true });
  await expect(noteTools.getByRole("link", { name: "Download notes", exact: true })).toBeVisible();
  await expect(noteTools.getByRole("link", { name: "Version history", exact: true })).toHaveCount(
    0,
  );
  await noteTools.getByRole("link", { name: "Flashcards", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/cards`);
  await page.getByRole("link", { name: "Class notes", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/notes`);
  await page.reload();
  await expect(page.getByText(/^Note version 1 ·/)).toBeVisible();
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save notes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await noteTools.getByRole("button", { name: "Edit notes", exact: true }).click();
  await expect(
    noteTools.getByRole("button", { name: "Done editing", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit answer", exact: true }).click();
  await page.getByLabel("Your text", { exact: true }).fill("A trip on a train");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByLabel("Your text", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A trip on a train", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Note version 2 ·/)).toBeVisible();
  await noteTools.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
  await expect(noteTools.getByRole("button", { name: "Edit notes", exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await noteTools.getByRole("link", { name: "Version history", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/notes/versions`, { timeout: 45000 });
  await expect(page.getByRole("heading", { name: "Version 2", exact: true })).toBeVisible();
  await page.goto(
    (await page.getByRole("link", { name: "Read version 1", exact: true }).getAttribute("href")) ??
      "",
  );
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+$/, { timeout: 45000 });
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit notes", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Current notes", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/notes`);
  await noteTools.getByRole("link", { name: "Flashcards", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/cards`);
  await expect(page.getByRole("button", { name: "Prepare cards", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toHaveCount(0);
  const prepared = await browserGet(page, `/api/classes/${sessionId}/cards`);
  expect(prepared.status()).toBe(200);
  const preparedCard = (await prepared.json()).cards[0];
  expect(preparedCard.status).toBe("active");
  expect(preparedCard.back).toBe("A trip on a train");
  const beforeAdding = await browserGet(page, `/api/review?sessionId=${sessionId}`);
  expect(beforeAdding.status()).toBe(200);
  expect((await beforeAdding.json()).cards[0].card.id).toBe(preparedCard.id);
  await expectNoAxeViolations(page);
  const savedCardResponse = await browserGet(page, `/api/cards/${preparedCard.id}`);
  expect(savedCardResponse.status()).toBe(200);
  const savedCard = await savedCardResponse.json();
  expect(savedCard.id).toBe(preparedCard.id);
  expect(savedCard.status).toBe("active");
  const savedCards = await browserGet(page, `/api/classes/${sessionId}/cards`);
  expect(savedCards.status()).toBe(200);
  const listedCard = (await savedCards.json()).cards[0];
  expect(listedCard.id).toBe(preparedCard.id);
  expect(listedCard.status).toBe("active");
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Review this class", exact: true }).click();
  await expect(page).toHaveURL(`/review?sessionId=${sessionId}`, { timeout: 45000 });
  await expect(page.getByRole("button", { name: "Show answer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(page.getByText("A trip on a train", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(page.getByText("Answer saved.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You’re ready for a break" })).toBeVisible();
  await page.getByRole("button", { name: "Undo last answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show answer", exact: true })).toBeVisible();
  const events = await browserGet(page, `/api/review?sessionId=${sessionId}`);
  expect(events.status()).toBe(200);
  const queue = await events.json();
  expect(queue.cards[0].schedule.version).toBe(2);
  await testInfo.attach("study-flow-api-verification", {
    contentType: "application/json",
    body: JSON.stringify({
      syntheticLocalFixture: true,
      automaticallyPublished: true,
      automaticallyActiveCards: true,
      editsSyncedToSameCard: true,
      flashcardsOpenedExplicitly: true,
      editModeRequired: true,
      notesPersistedAfterReload: true,
      cardRead: { id: savedCard.id, status: savedCard.status },
      classCardRead: { id: listedCard.id, status: listedCard.status },
      reviewCardId: queue.cards[0].card.id,
      reviewScheduleVersionAfterUndo: queue.cards[0].schedule.version,
    }),
  });
});
for (const [name, viewport] of Object.entries(VIEWPORTS))
  test(`study pages fit and are accessible: ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    const response = await page.request.post("/dev/auth/session", {
      data: { setup: "complete", studyFixture: true, automaticStudyFixture: true },
    });
    expect(response.status(), await response.text()).toBe(200);
    const { sessionId } = (await response.json()) as { sessionId: string };
    await page.goto(`/classes/${sessionId}/notes`);
    await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save notes", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Version history", exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (name === "mobile")
      await page.screenshot({
        path: testInfo.outputPath("notes-preview-mobile.png"),
        fullPage: true,
      });
    const generated = await browserGet(page, `/api/classes/${sessionId}/cards`);
    expect(generated.status()).toBe(200);
    const cards = await generated.json();
    const cardId = cards.cards[0].id;
    for (const path of [
      `/classes/${sessionId}/notes`,
      `/classes/${sessionId}/cards`,
      "/review",
      "/me/review-settings",
      "/me/learning",
      "/me/data",
      `/cards/${cardId}`,
    ]) {
      await page.goto(path);
      if (path === `/classes/${sessionId}/notes`) {
        const tools = page.getByRole("navigation", { name: "Note tools", exact: true });
        await expect(tools.getByRole("button", { name: "Edit notes", exact: true })).toBeVisible();
        await expect(tools.getByRole("link", { name: "Flashcards", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
        if (name === "mobile")
          await page.screenshot({
            path: testInfo.outputPath("notes-saved-mobile.png"),
            fullPage: true,
          });
      }
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
