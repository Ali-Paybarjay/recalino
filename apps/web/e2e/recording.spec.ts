import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});
/**
 * D107: a recording of another session from an earlier day, saved on this device (synthetic, no
 * audio). The recording page lists only this session's parts; /recordings without a recording
 * still lists it for recovery and export (D29).
 */
async function seedEarlierRecording(page: Page, userId: string) {
  await page.evaluate(async (owner) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("recalino-recordings-v1", 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("recordings")) {
          database
            .createObjectStore("recordings", { keyPath: ["userId", "id"] })
            .createIndex("owner", "userId");
          database.createObjectStore("chunks", { keyPath: ["userId", "recordingId", "sequence"] });
        }
        if (!database.objectStoreNames.contains("photos"))
          database.createObjectStore("photos", { keyPath: ["userId", "recordingId", "id"] });
        if (!database.objectStoreNames.contains("deletedAccounts"))
          database.createObjectStore("deletedAccounts", { keyPath: "userId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("recordings", "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const id = crypto.randomUUID();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    tx.objectStore("recordings").put({
      id,
      userId: owner,
      sessionId: crypto.randomUUID(),
      captureId: id,
      segment: 1,
      mimeType: "audio/webm",
      status: "saved",
      createdAt: yesterday,
      updatedAt: yesterday,
      completedAt: yesterday,
      activeMs: 754_000,
      chunks: 0,
      bytes: 0,
      creationKey: crypto.randomUUID(),
      sourceAssetId: null,
    });
    await done;
    db.close();
  }, userId);
}
test("capture survives app navigation and offline time, saves final parts and remains owner-scoped", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/today");
  await seedEarlierRecording(page, userId);
  const earlier = page.getByText(/^Part 1 · 12:34/);
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await expect
    .poll(async () => page.locator('[aria-label="Active recording time"]').textContent(), {
      timeout: 10000,
    })
    .not.toBe("0:00");
  // D107: once its session exists, Today's recording page takes the session's address (a
  // history replace without a server request, so Back below still returns to Today), with this
  // recording's parts only, from Part 1.
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await expect(page.getByText(/^Part 1 · \d+:\d\d$/)).toBeVisible();
  await expect(page.getByText("Recording in progress", { exact: true })).toBeVisible();
  await expect(earlier).toHaveCount(0);
  // The recording page has no navigation (UX-02); the browser's Back is a client
  // navigation, so the capture keeps running and the recording bar takes over on the page before.
  await page.goBack();
  await expect(
    page.getByRole("status").filter({ hasText: "Session recording continues" }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByText("Offline · controls are available here", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume recording", exact: true }).click();
  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audio", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^class-.*\.(webm|m4a|ogg)$/);
  await context.setOffline(false);
  // D104/D107: Open recording leads to the session's recording page once the session is known.
  await page.getByRole("link", { name: "Open recording", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await expect(page.getByRole("heading", { name: "Recorded parts", exact: true })).toBeVisible();
  await expect(page.getByText(/^Part 1 · \d+:\d\d$/)).toBeVisible();
  await expect(earlier).toHaveCount(0);
  // After Stop the session stays open (D105, D107): Process this session, then Continue recording.
  await expect(
    page.getByText("This session stays open. Record more, or process it when the class is over.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Process this session", exact: true })).toHaveClass(
    /btn-primary/,
  );
  await expect(page.getByRole("button", { name: "Continue recording", exact: true })).toHaveClass(
    /btn-secondary/,
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expectNoAxeViolations(page);
  // /recordings without a recording in this tab keeps every recording of the device (D29).
  await page.goto("/recordings");
  await expect(
    page.getByRole("heading", { name: "Saved and recoverable recordings", exact: true }),
  ).toBeVisible();
  await expect(earlier).toBeVisible();
  const switchAccount = await page.request.post("/dev/auth/session", {
    data: { setup: "complete" },
  });
  expect(switchAccount.status()).toBe(200);
  await page.goto("/recordings");
  await expect(page.getByText("No recordings on this device yet.", { exact: true })).toBeVisible();
});

// UX-02 and UX-11 (frame C2, owner decision 2026-10-19, D90 as amended): the session's recording
// page is a full focus mode without navigation in any phase, with its own way back outside
// capture; Stop is on screen without scrolling, and an upload failure stays quiet until Stop. With
// RECORDING_FOCUS_MODE "while-capturing" the first and last steps would expect the navigation.
for (const [name, viewport] of [
  ["mobile", { width: 390, height: 664 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test(`${name}: the session recording page has no navigation and a way back outside capture`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
    expect(response.status(), await response.text()).toBe(200);
    const created = await page.request.post("/api/classes", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {},
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    // Every request that adds a recorded part to the session fails, as with a bad connection.
    await page.route(/\/api\/(classes\/[^/]+\/)?sources/, (route) => route.abort());
    await page.route("**/api/recordings", (route) => route.abort());
    await page.setViewportSize(viewport);
    const navigation = page.getByRole("navigation");
    const newSession = page.getByRole("link", { name: "New session", exact: true });
    const back = page.getByRole("link", { name: "Back to session", exact: true });

    // Before Start: no navigation and no New session; the explicit way back is there.
    await page.goto(`/sessions/${id}/record`);
    await expect(back).toBeVisible();
    await expect(navigation).toHaveCount(0);
    await expect(newSession).toHaveCount(0);

    // While capturing: no navigation, no New session, and Stop and save is on screen.
    await page.getByRole("button", { name: "Record a session", exact: true }).click();
    const stop = page.getByRole("button", { name: "Stop and save", exact: true });
    await expect(stop).toBeInViewport();
    await expect(navigation).toHaveCount(0);
    await expect(newSession).toHaveCount(0);
    await expect(back).toHaveCount(0);
    await page.waitForTimeout(4000);
    // Only a real capture failure may speak; Next.js's own route announcer is outside <main>.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Retry adding session material")).toHaveCount(0);
    await expect(navigation).toHaveCount(0);
    await expect(stop).toBeInViewport();

    // After Stop: the explicit way back is there again, still without navigation.
    await stop.click();
    await expect(page.getByText("Saved on this device", { exact: true }).first()).toBeVisible();
    await expect(back).toBeVisible();
    await expect(navigation).toHaveCount(0);
    await expect(newSession).toHaveCount(0);
    // D107: the session stays open. Its part never reached the server here, so Process this
    // session waits, with the sync status saying why; Continue recording stays in the session.
    await expect(page.getByText(/^Part 1 · \d+:\d\d$/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Process this session", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Adding recorded parts to your session", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue recording", exact: true }).click();
    await expect(stop).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`/sessions/${id}/record$`));
    // The new recording's first part continues the numbers (Part 2) and nothing speaks.
    await expect(page.getByText(/^Part 2 · \d+:\d\d$/)).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await stop.click();
    await expect(page.getByText(/^Part 1 · /)).toBeVisible();
    await expect(page.getByText(/^Part 2 · /)).toBeVisible();
  });
}
