import { expect, test } from "@playwright/test";

/**
 * Real Chromium MediaRecorder (PRD-REC-03, PRD-REC-05). The microphone is replaced by a Web Audio
 * tone whose context the test suspends: the recorder then receives no audio, exactly like the
 * 2026-10-12 capture whose parts declared 77.6 minutes and held 25.5. Synthetic audio only.
 */
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
});
/** Replaces the microphone with a tone in every page it is added to. */
function fakeMicrophone() {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const contexts: AudioContext[] = [];
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints?.audio) return original(constraints);
    const context = new AudioContext();
    const tone = context.createOscillator();
    const output = context.createMediaStreamDestination();
    tone.connect(output);
    tone.start();
    await context.resume();
    contexts.push(context);
    return output.stream;
  };
  Object.assign(window, {
    __silenceMicrophone: () => Promise.all(contexts.map((context) => context.suspend())),
    __restoreMicrophone: () => Promise.all(contexts.map((context) => context.resume())),
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeMicrophone);
});

type SavedPart = {
  segment?: number;
  captureId?: string;
  status?: string;
  bytes?: number;
  activeMs: number;
  measuredBy?: string;
  gaps?: { missingMs: number; offsetMs: number }[];
  completedAt?: string;
};
async function savedParts(page: import("@playwright/test").Page): Promise<SavedPart[]> {
  return page.evaluate(
    () =>
      new Promise<SavedPart[]>((resolve, reject) => {
        const request = indexedDB.open("recalino-recordings-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result
            .transaction("recordings", "readonly")
            .objectStore("recordings")
            .getAll();
          read.onsuccess = () => resolve(read.result as SavedPart[]);
          read.onerror = () => reject(read.error);
        };
      }),
  );
}

test("measures real recorded audio, starts a new part after missing audio, and says so after Stop", async ({
  page,
}) => {
  test.setTimeout(120000);
  const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/recordings");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  // D107: once its session exists, the page becomes the session's recording page (client
  // navigation; the capture goes on).
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await page.waitForTimeout(3000);
  await page.evaluate(() =>
    (window as unknown as { __silenceMicrophone(): Promise<void> }).__silenceMicrophone(),
  );
  // No warning, sound or window appears while recording (PRD-REC-02).
  await page.waitForTimeout(7000);
  await expect(page.getByText(/not recorded/)).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __restoreMicrophone(): Promise<void> }).__restoreMicrophone(),
  );
  // The next timeslice reveals the gap; a new part starts so its timestamps restart.
  await expect.poll(async () => (await savedParts(page)).length, { timeout: 15000 }).toBe(2);
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  // D107: Stop ends this recording, not the session.
  await expect(page.getByRole("button", { name: "Continue recording", exact: true })).toBeVisible();

  const parts = (await savedParts(page)).sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
  expect(parts.map((part) => part.segment)).toEqual([1, 2]);
  for (const part of parts) expect(part.measuredBy).toBe("media");
  // One numbered line per part, Part 1 on top; the missing minutes are on the line they belong to.
  const lines = page.getByText(/^Part [12] · \d+:\d\d/);
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveText(/^Part 1 · /);
  const gaps = parts.flatMap((part) => part.gaps ?? []);
  expect(gaps).toHaveLength(1);
  expect(gaps[0]?.missingMs).toBeGreaterThan(4000);
  // About 3 s before the silence and about 4 s after it, never the ~14 s the clock ran.
  const recorded = parts.reduce((sum, part) => sum + part.activeMs, 0);
  expect(recorded).toBeGreaterThan(4000);
  expect(recorded).toBeLessThan(10000);
  await expect(
    page.getByText(/^Part of this class was not recorded: about \d+ min in total\.$/).first(),
  ).toBeVisible();
  await expect(page.getByText(/^About \d+ min missing from /)).toBeVisible();
  // D65: the changed screen at both reference widths, for the owner's final review.
  for (const [name, width, height] of [
    ["1440", 1440, 900],
    ["390", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `../../artifacts/verification/feat-recording-capture/recordings-after-stop-${name}.png`,
      fullPage: true,
    });
  }
  // The recording bar on other pages carries the short summary only (client navigation keeps it).
  await page.setViewportSize({ width: 1440, height: 900 });
  // The recording page has no navigation (UX-02, D90 as amended): "Back to session" is the way
  // back, since the page became the session's recording page (D107).
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to session", exact: true }).click();
  const bar = page.getByRole("complementary", { name: "Active recording" });
  await expect(bar.getByText(/^Part of this class was not recorded/)).toBeVisible();
  for (const [name, width, height] of [
    ["1440", 1440, 900],
    ["390", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `../../artifacts/verification/feat-recording-capture/recording-bar-after-stop-${name}.png`,
    });
  }
});

test("a capture whose page is lost while paused comes back paused; Resume continues it (D104)", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/recordings");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedParts(page))[0]?.bytes ?? 0, { timeout: 10000 })
    .toBeGreaterThan(0);
  // The tab is discarded while paused: no Stop, no beforeunload, nothing more runs in it.
  await page.close({ runBeforeUnload: false });

  const next = await context.newPage();
  await next.addInitScript(fakeMicrophone);
  await next.goto("/recordings");
  await expect(next.getByRole("button", { name: "Resume recording", exact: true })).toBeVisible();
  // D107: the restored recording's session is known, so its recording page takes over.
  await expect(next).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await expect(
    next.getByText("The microphone was interrupted while paused. Resume to reconnect.").first(),
  ).toBeVisible();
  // Never resumed by itself.
  await expect(next.getByRole("button", { name: "Pause recording", exact: true })).toHaveCount(0);
  const lost = await savedParts(next);
  expect(lost).toHaveLength(1);
  expect(lost[0]?.status).toBe("interrupted");
  expect(lost[0]?.completedAt).toBeUndefined();

  await next.getByRole("button", { name: "Resume recording", exact: true }).click();
  await expect(next.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await next.waitForTimeout(3000);
  await next.getByRole("button", { name: "Stop and save", exact: true }).click();
  await expect(next.getByRole("button", { name: "Continue recording", exact: true })).toBeVisible();
  const parts = (await savedParts(next)).sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
  expect(parts.map((part) => part.segment)).toEqual([1, 2]);
  expect(new Set(parts.map((part) => part.captureId)).size).toBe(1);
  for (const part of parts) expect(part.completedAt).toBeDefined();
});
