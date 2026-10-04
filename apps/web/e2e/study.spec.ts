import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

test("published notes, edits, candidates, review and undo use real owner APIs", async ({
  page,
}) => {
  test.setTimeout(120000);
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { sessionId } = (await response.json()) as { sessionId: string };
  await page.goto(`/classes/${sessionId}/notes`);
  await page.getByRole("button", { name: "Publish notes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic notes for local testing" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Edit answer", exact: true }).click();
  await page.getByLabel("Your text", { exact: true }).fill("A trip on a train");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByLabel("Your text", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A trip on a train", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Version history", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Version 2", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Read version 1", exact: true }).click();
  await expect(page.getByText("A rail trip", { exact: true })).toBeVisible();
  await page.goto(`/classes/${sessionId}/cards`);
  await page.getByRole("button", { name: "Prepare cards", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Confirm and add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm and add", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Review this class", exact: true }).click();
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
});
for (const [name, viewport] of Object.entries(VIEWPORTS))
  test(`study pages fit and are accessible: ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    const response = await page.request.post("/dev/auth/session", {
      data: { setup: "complete", studyFixture: true },
    });
    expect(response.status(), await response.text()).toBe(200);
    const { sessionId } = (await response.json()) as { sessionId: string };
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
