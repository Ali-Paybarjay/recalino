import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

// Workstream 5 and D65 (owner decision 2026-10-12): every changed screen at 390 and 1440 px,
// with a local synthetic learner; screenshots go to artifacts/verification/feat-session-navigation.
const output = "../../artifacts/verification/feat-session-navigation";

async function studySession(page: Page) {
  const response = await page.request.post("/dev/auth/session", {
    data: { setup: "complete", studyFixture: true },
  });
  expect(response.status(), await response.text()).toBe(200);
  const { sessionId } = (await response.json()) as { sessionId: string };
  const published = await page.request.post(`/api/classes/${sessionId}/notes`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { expectedRevisionId: null, edits: {} },
  });
  expect(published.status(), await published.text()).toBe(201);
  const empty = await page.request.post("/api/classes", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { classDate: "2026-09-01" },
  });
  expect(empty.status(), await empty.text()).toBe(201);
  return { sessionId, emptyId: ((await empty.json()) as { id: string }).id };
}

async function capture(page: Page, name: string, width: number) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
}

for (const width of [390, 1440]) {
  test(`session navigation screens at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    const { sessionId, emptyId } = await studySession(page);

    // Session with notes: one next step first, study links only because content exists.
    await page.goto(`/sessions/${sessionId}`);
    const step = page.getByRole("region", { name: "Session progress", exact: true });
    await expect(step).toBeVisible();
    await expect(step.locator(".btn-primary")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Session notes", exact: true })).toBeVisible();
    const sessionHeading = await step.getByRole("heading").innerText();
    const sessionTitle = await page.getByRole("heading", { level: 1 }).innerText();
    await expect(page.locator("summary").filter({ hasText: "More session tools" })).toBeVisible();
    await expectNoAxeViolations(page);
    await capture(page, "session-with-notes", width);

    // Empty session: no notes or flashcards offered. D71 (owner decision 2026-10-13): it leads
    // with Record a session, then Add or view material, and the material section only explains.
    await page.goto(`/sessions/${emptyId}`);
    await expect(step.getByRole("heading", { name: "Add your session material" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Session notes", exact: true })).toHaveCount(0);
    await expect(step.locator(".btn-primary")).toHaveText("Record a session");
    await expect(step.getByRole("link", { name: "Add or view material", exact: true })).toHaveClass(
      /btn-secondary/,
    );
    await expect(page.getByRole("button", { name: "Record a session", exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole("link", { name: "Add or view material", exact: true })).toHaveCount(
      1,
    );
    const emptyTitle = await page.getByRole("heading", { level: 1 }).innerText();
    await expectNoAxeViolations(page);
    await capture(page, "session-empty", width);

    // One page for material and status; the kept routes show the same page.
    for (const route of ["sources", "processing"]) {
      await page.goto(`/sessions/${sessionId}/${route}`);
      await expect(page.locator("#session-progress")).toBeVisible();
      // Vocabulary A (D86): the page title, the next step and this panel all name the material.
      await expect(
        page
          .locator("#session-material")
          .getByRole("heading", { level: 2, name: "Session material", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Back to session/ })).toHaveCount(1);
      await capture(page, `material-and-status-${route}`, width);
    }
    await expectNoAxeViolations(page);

    // Notes no longer open with voice confirmation; the voice step has its own page.
    await page.goto(`/sessions/${sessionId}/notes`);
    await expect(page.getByText("Voice settings for this session")).toHaveCount(0);
    await capture(page, "notes", width);
    await page.goto(`/sessions/${sessionId}/voice`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Your voice in this session" }),
    ).toBeVisible();
    await capture(page, "voice-step", width);

    // Today: the latest session's step, with Record a session still the only filled primary.
    await page.goto("/today");
    const today = page.getByRole("main");
    await expect(today.locator(".btn-primary:visible")).toHaveCount(1);
    // The same resolver: Today names the same step as the session page, in a card named by the
    // session. D71: the older empty session has no work in progress, so it has no card.
    const latestCard = today.getByRole("region", { name: sessionTitle, exact: true });
    await expect(latestCard.getByRole("heading", { level: 2 })).toHaveText(sessionHeading);
    await expect(today.getByRole("region", { name: emptyTitle, exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await capture(page, "today", width);
  });
}
