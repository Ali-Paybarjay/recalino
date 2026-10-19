import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});
test("capture survives app navigation and offline time, saves final parts and remains owner-scoped", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/today");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await expect
    .poll(async () => page.locator('[aria-label="Active recording time"]').textContent(), {
      timeout: 10000,
    })
    .not.toBe("0:00");
  // The recording page has no navigation while capturing (UX-02); the browser's Back is a client
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
  await page.getByRole("link", { name: "Open recording", exact: true }).click();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expectNoAxeViolations(page);
  const switchAccount = await page.request.post("/dev/auth/session", {
    data: { setup: "complete" },
  });
  expect(switchAccount.status()).toBe(200);
  await page.goto("/recordings");
  await expect(page.getByText("No recordings on this device yet.", { exact: true })).toBeVisible();
});

// UX-02 and UX-11 (frame C2, owner decision 2026-10-19): the session's recording page has the
// learner navigation before Start and after Stop and none while capture runs, Stop is on screen
// without scrolling, and an upload failure stays quiet until Stop. To return to the full focus
// mode, set RECORDING_FOCUS_MODE to "always" and expect no navigation in the first and last steps.
for (const [name, viewport] of [
  ["mobile", { width: 390, height: 664 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test(`${name}: the session recording page shows the navigation only outside capture`, async ({
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
    await page.setViewportSize(viewport);
    const navigation = page.getByRole("navigation");
    const newSession = page.getByRole("link", { name: "New session", exact: true });
    const back = page.getByRole("link", { name: "Back to session", exact: true });

    // Before Start: the learner navigation is there (the sidebar from 768px, else the bottom bar).
    await page.goto(`/sessions/${id}/record`);
    await expect(navigation.first()).toBeVisible();
    if (viewport.width >= 768) await expect(newSession).toBeVisible();
    await expect(back).toBeVisible();

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
    await expect(page.getByText("Retry adding session sources")).toHaveCount(0);
    await expect(navigation).toHaveCount(0);
    await expect(stop).toBeInViewport();

    // After Stop: the navigation and the explicit way back are there again.
    await stop.click();
    await expect(page.getByText("Saved on this device", { exact: true }).first()).toBeVisible();
    await expect(back).toBeVisible();
    await expect(navigation.first()).toBeVisible();
    if (viewport.width >= 768) await expect(newSession).toBeVisible();
  });
}
