import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

test("note preview, saved edits, flashcards, review and undo use real owner APIs", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true },
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
  await expect(page.getByRole("button", { name: "Edit answer", exact: true })).toHaveCount(0);
  const preview = await page.request.get(`/api/classes/${sessionId}/notes`);
  expect(preview.status()).toBe(200);
  expect((await preview.json()).notebook).toBeNull();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Save notes and make flashcards", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/cards`);
  const beforePreparing = await page.request.get(`/api/classes/${sessionId}/cards`);
  expect(beforePreparing.status()).toBe(200);
  expect((await beforePreparing.json()).cards).toEqual([]);
  await page.getByRole("link", { name: "Class notes", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/notes`);
  await page.reload();
  await expect(page.getByText(/^Note version 1 ·/)).toBeVisible();
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save notes and make flashcards", exact: true }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Edit answer", exact: true }).click();
  await page.getByLabel("Your text", { exact: true }).fill("A trip on a train");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByLabel("Your text", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A trip on a train", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Version history", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${sessionId}/notes/versions`, { timeout: 45000 });
  await expect(page.getByRole("heading", { name: "Version 2", exact: true })).toBeVisible();
  await page.goto(
    (await page.getByRole("link", { name: "Read version 1", exact: true }).getAttribute("href")) ??
      "",
  );
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+$/, { timeout: 45000 });
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await page.goto(`/classes/${sessionId}/cards`);
  await page.getByRole("button", { name: "Prepare cards", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toBeVisible();
  const prepared = await page.request.get(`/api/classes/${sessionId}/cards`);
  expect(prepared.status()).toBe(200);
  const preparedCard = (await prepared.json()).cards[0];
  expect(preparedCard.status).toBe("candidate");
  const beforeAdding = await page.request.get(`/api/review?sessionId=${sessionId}`);
  expect(beforeAdding.status()).toBe(200);
  expect((await beforeAdding.json()).cards).toEqual([]);
  await expectNoAxeViolations(page);
  const activation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/api\/cards\/[^/]+\/actions$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Confirm and add", exact: true }).click();
  const activated = await activation;
  expect(activated.status(), await activated.text()).toBe(200);
  const activatedCard = await activated.json();
  expect(activatedCard.id).toBe(preparedCard.id);
  expect(new URL(activated.url()).pathname).toBe(`/api/cards/${preparedCard.id}/actions`);
  expect(activatedCard.status).toBe("active");
  const savedCardResponse = await page.request.get(`/api/cards/${preparedCard.id}`);
  expect(savedCardResponse.status()).toBe(200);
  const savedCard = await savedCardResponse.json();
  expect(savedCard.id).toBe(preparedCard.id);
  expect(savedCard.status).toBe("active");
  const savedCards = await page.request.get(`/api/classes/${sessionId}/cards`);
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
  const events = await page.request.get(`/api/review?sessionId=${sessionId}`);
  expect(events.status()).toBe(200);
  const queue = await events.json();
  expect(queue.cards[0].schedule.version).toBe(2);
  await testInfo.attach("study-flow-api-verification", {
    contentType: "application/json",
    body: JSON.stringify({
      syntheticLocalFixture: true,
      previewVisibleBeforeSave: true,
      notesPersistedAfterReload: true,
      activationResponse: { id: activatedCard.id, status: activatedCard.status },
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
      data: { setup: "complete", studyFixture: true },
    });
    expect(response.status(), await response.text()).toBe(200);
    const { sessionId } = (await response.json()) as { sessionId: string };
    await page.goto(`/classes/${sessionId}/notes`);
    await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save class notes", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save notes and make flashcards", exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (name === "mobile")
      await page.screenshot({
        path: testInfo.outputPath("notes-preview-mobile.png"),
        fullPage: true,
      });
    const published = await page.request.post(`/api/classes/${sessionId}/notes`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: { expectedRevisionId: null },
    });
    expect(published.status()).toBe(201);
    const generated = await page.request.post(`/api/classes/${sessionId}/cards`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {},
    });
    expect(generated.status()).toBe(201);
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
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
