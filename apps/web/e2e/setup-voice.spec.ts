import { expect, test } from "@playwright/test";
import type { VoiceProfileView } from "@recalino/core/voice-contracts";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";
import { microphoneStats, mockMicrophone, resolvePendingMicrophone } from "./voice-capture";

const emptyProfile: VoiceProfileView = {
  enabled: false,
  consentVersion: null,
  enrolled: false,
  sampleDurationMs: null,
  modelVersion: null,
  confirmedLessons: 0,
  engineAvailable: true,
  version: 0,
};

test("optional voice setup shows processing and success before the learner chooses Continue", async ({
  page,
}) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await mockMicrophone(page);
  let profile = { ...emptyProfile };
  const writes: { body: unknown; key: string | undefined }[] = [];
  let releaseSave: (() => void) | undefined;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/me/voice", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (writes.length === 1) {
        return route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Please retry the saved sample." } },
        });
      }
      await saving;
      profile = {
        ...profile,
        version: 1,
        enabled: true,
        consentVersion: "voice-v1",
        enrolled: true,
        sampleDurationMs: 30000,
      };
    }
    await route.fulfill({ json: profile });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup/voice");
  await expect(page.getByRole("heading", { name: "Your voice", exact: true })).toBeVisible();
  await expect(page.getByText("6 of 6")).toBeVisible();
  const consent = page.getByRole("checkbox");
  const record = page.getByRole("button", { name: "Record voice sample", exact: true });
  const later = page.getByRole("button", { name: "Do this later", exact: true });
  await expect(consent).not.toBeChecked();
  await expect(record).toBeDisabled();
  const skipBox = await later.boundingBox();
  expect(skipBox && skipBox.y >= 0 && skipBox.y + skipBox.height <= 844).toBe(true);
  await expect(page.getByRole("button", { name: "Enable without a sample" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to settings" })).toHaveCount(0);
  await expectNoAxeViolations(page);
  expect(await microphoneStats(page)).toEqual({ requests: 0, stopped: 0 });
  await consent.check();
  expect(writes).toEqual([]);
  expect(await microphoneStats(page)).toEqual({ requests: 0, stopped: 0 });
  await page.clock.install();
  await record.click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  expect(await microphoneStats(page)).toEqual({ requests: 1, stopped: 1 });
  expect(writes).toEqual([]);
  const save = page.getByRole("button", { name: "Save voice sample", exact: true });
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Voice processing could not be completed. Try saving again, or record another voice sample.",
  );
  await expect(page).toHaveURL(/\/setup\/voice$/);
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Processing your voice…$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Processing your voice…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(later).toBeDisabled();
  await expect(page).toHaveURL(/\/setup\/voice$/);
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]?.body).toMatchObject({
    consent: true,
    consentVersion: "voice-v1",
    expectedVersion: 0,
    mimeType: "audio/webm",
  });
  releaseSave?.();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^Processing your voice…$/ }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/setup\/voice$/);
  await expect(page.getByLabel("Your voice sample preview")).toHaveCount(0);
  const proceed = page.getByRole("button", { name: "Continue", exact: true });
  await expect(proceed).toBeEnabled();
  await proceed.click();
  await expect(page).toHaveURL(/\/today$/);
});

test("Do this later cancels an active sample without granting or saving voice consent", async ({
  page,
}) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await mockMicrophone(page);
  const writes: string[] = [];
  await page.route("**/api/me/voice", (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    return route.fulfill({ json: emptyProfile });
  });
  await page.goto("/setup/voice");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const later = page.getByRole("button", { name: "Do this later", exact: true });
  await expect(later).toBeEnabled();
  await later.click();
  await expect(page).toHaveURL(/\/today$/);
  expect(await microphoneStats(page)).toEqual({ requests: 1, stopped: 1 });
  expect(writes).toEqual([]);
});

test("Do this later remains available after denied microphone permission", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await mockMicrophone(page, "denied");
  const writes: string[] = [];
  await page.route("**/api/me/voice", (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    return route.fulfill({ json: emptyProfile });
  });
  await page.goto("/setup/voice");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByText(/Microphone access was not allowed/)).toBeVisible();
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  expect(await microphoneStats(page)).toEqual({ requests: 1, stopped: 0 });
  expect(writes).toEqual([]);
});

test("a microphone granted after skipping is stopped and cannot resume the abandoned sample", async ({
  page,
}) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await mockMicrophone(page, "pending");
  const writes: string[] = [];
  await page.route("**/api/me/voice", (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    return route.fulfill({ json: emptyProfile });
  });
  await page.goto("/setup/voice");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByText("Waiting for microphone permission…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await resolvePendingMicrophone(page);
  await expect.poll(() => microphoneStats(page)).toEqual({ requests: 1, stopped: 1 });
  expect(writes).toEqual([]);
});

test("an unavailable engine or voice-settings failure never traps the learner in setup", async ({
  page,
}) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.route("**/api/me/voice", (route) =>
    route.fulfill({ json: { ...emptyProfile, engineAvailable: false } }),
  );
  await page.goto("/setup/voice");
  await expect(page.getByText(/Audio voice matching is not available yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record voice sample" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enable without a sample" })).toHaveCount(0);
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.unroute("**/api/me/voice");
  await page.route("**/api/me/voice", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "unavailable", message: "Your voice settings could not be loaded." } },
    }),
  );
  await page.goto("/setup/voice");
  await expect(
    page.getByText("Your voice settings could not be loaded.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
});

test("a learner who skipped can record a sample later from Settings", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.route("**/api/me/voice", (route) => route.fulfill({ json: emptyProfile }));
  await page.goto("/setup/voice");
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/me");
  await page.getByRole("link", { name: /Your voice/ }).click();
  await expect(page).toHaveURL(/\/me\/voice$/);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Record voice sample", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: "Back to settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Do this later" })).toHaveCount(0);
});

test("optional voice setup still requires sign-in and completed core setup", async ({ page }) => {
  await page.goto("/setup/voice");
  await expect(page).toHaveURL(/\/\?next=%2Fsetup%2Fvoice$/);
  await expect(page.getByRole("button", { name: "Record voice sample" })).toHaveCount(0);
  await signInAsNewLearner(page);
  await page.goto("/setup/voice");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText("1 of 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record voice sample" })).toHaveCount(0);
});
