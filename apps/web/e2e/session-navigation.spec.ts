import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

// Workstream 5 (FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12 §7.3): one next step per session state.
for (const width of [390, 1440]) {
  test(`each session state names one next step that can succeed (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto("/dev/ui/session");
    const card = (state: string) =>
      page.locator(`[data-state="${state}"]`).getByRole("region", { name: "Session progress" });

    await expect(
      card("empty").getByRole("heading", { name: "Add your session material" }),
    ).toBeVisible();
    await expect(card("empty").getByRole("link")).toHaveCount(1);
    // D71 (owner decision 2026-10-13): an empty session records first, adds files second.
    await expect(
      card("empty").getByRole("button", { name: "Record a session", exact: true }),
    ).toHaveClass(/btn-primary/);
    await expect(
      card("empty").getByRole("link", { name: "Add or view material", exact: true }),
    ).toHaveClass(/btn-secondary/);

    await expect(
      card("ready-voice").getByRole("link", { name: "Read notes", exact: true }),
    ).toHaveClass(/btn-primary/);
    await expect(
      page.locator('[data-state="ready-voice"]').getByRole("link", { name: "Confirm your voice" }),
    ).toHaveAttribute("href", /\/voice$/);

    const short = card("allowance-short");
    await expect(short.getByRole("link", { name: "Ask for more allowance" })).toHaveClass(
      /btn-primary/,
    );
    await expect(short.getByRole("button", { name: /Retry/ })).toHaveCount(0);

    const audio = card("audio-not-received");
    await expect(audio.getByText(/did not reach Recalino/)).toBeVisible();
    await expect(audio.getByRole("link", { name: "Review material" })).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await expectNoAxeViolations(page);
  });
}

// D107 (owner decision 2026-10-20): a session is processed only when the learner presses Process
// this session, after a summary and allowance sheet; the press names the revision it showed.
for (const width of [390, 1440]) {
  test(`Process this session shows the summary first and sends one request (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const sessionId = "10000000-0000-4000-8000-000000000002";
    const waiting = {
      state: "waiting_sources",
      revision: 3,
      processRequest: "not_requested",
      requestedRevision: null,
      batchId: null,
      run: null,
      snapshot: null,
      lastError: null,
      message: "",
      notesReady: false,
      cardsReady: false,
    };
    const audio = (durationMs: number) => ({
      sourceId: crypto.randomUUID(),
      kind: "audio",
      sha256: "a".repeat(64),
      mimeType: "audio/webm",
      durationMs,
      pageCount: null,
      objectId: null,
      contentVersionId: null,
      captureAnchor: null,
      ranges: [],
      units: [],
      blocks: [],
    });
    const zero = { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 };
    const writes: { body: unknown; key: string | undefined }[] = [];
    let refusal = false;
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: {} }));
    await page.route(`**/api/classes/${sessionId}/estimate`, (route) =>
      route.fulfill({
        json: {
          snapshot: {
            sourcesVersion: 3,
            fingerprint: "f".repeat(64),
            sources: [audio(600_000), audio(192_000)],
          },
          requested: { ...zero, audio: 792 },
          allowance: { remaining: { ...zero, audio: 15_600 } },
          providerConfigured: true,
          models: null,
        },
      }),
    );
    await page.route(`**/api/classes/${sessionId}/learning`, async (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill({ json: waiting });
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (refusal)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "conflict",
              message: "This is already being processed. Please wait a moment.",
              details: { fields: { session: ["capture_in_progress"] } },
            },
          },
        });
      return route.fulfill({
        status: 202,
        json: {
          ...waiting,
          state: "processing",
          processRequest: "requested",
          requestedRevision: 3,
        },
      });
    });
    await page.goto("/dev/ui/session");
    const card = page
      .locator('[data-state="ready-to-process"]')
      .getByRole("region", { name: "Session progress" });
    await expect(card.getByRole("heading", { name: "Ready to process" })).toBeVisible();
    await expect(
      card.getByText("Your notes and flashcards are made when you process this session.", {
        exact: true,
      }),
    ).toBeVisible();
    const reopened = page
      .locator('[data-state="reopened"]')
      .getByRole("region", { name: "Session progress" });
    await expect(
      reopened.getByRole("heading", { name: "New sources since your notes were made" }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("button", { name: "Process this session", exact: true }),
    ).toHaveClass(/btn-primary/);

    // Refused while a recording of the session is open: the message comes after the sheet.
    refusal = true;
    const process = card.getByRole("button", { name: "Process this session", exact: true });
    await process.click();
    const sheet = page.getByRole("dialog", { name: "Process this session?" });
    await expect(sheet.getByText("Class audio", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Confirm and process", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(
      card.getByText("Stop the recording before you process this session.", { exact: true }),
    ).toBeVisible();

    // Accepted: nothing is sent before Confirm and process, then one request with the revision.
    refusal = false;
    await process.click();
    await expect(sheet.getByText("13 min 12 sec · 2 parts", { exact: true })).toBeVisible();
    await expect(
      sheet.getByText("Class audio: 13 min 12 sec needed, 260 min 0 sec left", { exact: true }),
    ).toBeVisible();
    await expect(
      sheet.getByText("Nothing is processed or charged until you confirm.", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: `../../artifacts/verification/feat-recording-ui/process-sheet-${width}.png`,
    });
    expect(writes).toHaveLength(1);
    await sheet.getByRole("button", { name: "Confirm and process", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(
      card.getByRole("heading", { name: "Creating notes and flashcards" }),
    ).toBeVisible();
    expect(writes.map((write) => write.body)).toEqual([
      { action: "process", revision: 3 },
      { action: "process", revision: 3 },
    ]);
    for (const write of writes) expect(write.key).toMatch(/^[\da-f-]{36}$/);
  });
}
